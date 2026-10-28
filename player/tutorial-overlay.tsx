"use client";
import {placeCardOutsideFocus} from "./focus-card-placement";

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { driver, type Driver } from "driver.js";
import { autoUpdate } from "@floating-ui/dom";
import "driver.js/dist/driver.css";
import { ArrowDownToLine, ChevronLeft, ChevronRight, Pause, Play, Square } from "lucide-react";

import { findTutorialAnchor, openListOf, resolveRingElement, topmostApplicationDialog, visibleBoxOf } from "./anchor";
import { DEFAULT_TUTORIAL_DOM_POLICY, type TutorialDomPolicy } from "./dom-policy";
import { additionalFocusCutouts, drawFocusHighlights, focusAnnotationAvoidRects, resolveFocusHighlights } from "./focus-highlights";
import { tutorialArrow } from "./arrow-placement";
import type { TutorialHighlightStyle } from "../core/highlight";
import { bestCenteredCardSpot, type CardPosition, type CardSide } from "./card-placement";
import { positionTutorialCard } from "./floating-placement";
import { tutorialPlacementRegion } from "./placement-region";
import { boxMinus, cutoutPath, isDegenerateStage, paddedBox, stageOverlayPath, type StageRect } from "./spotlight";
import { TUTORIAL_SURFACE_CSS, TUTORIAL_SURFACE_PROPS } from "./surface";
import { useLatestRef } from "../shared/use-latest-ref";
import { isTutorialAnchorFullyVisible, visibleClientRect } from "./visibility";
import type { TutorialCardLayout } from "../core/schema";
import type {
  TutorialInteraction,
  TutorialMode,
  TutorialPlayerStatus,
  TutorialSpotlightStyle,
  TutorialStep,
} from "./types";

interface TutorialOverlayProps {
  domPolicy?: TutorialDomPolicy;
  highlightStyle?: TutorialHighlightStyle;
  anchor: HTMLElement;
  step: TutorialStep;
  stepIndex: number;
  stepCount: number;
  tutorialTitle: string;
  mode: TutorialMode;
  spotlightStyle: TutorialSpotlightStyle;
  /** Card placement, size, and whether an arrow points at the anchor. */
  cardLayout?: TutorialCardLayout;
  /** `guided` confines pointer input to the ringed control. */
  interaction?: TutorialInteraction;
  /** Anchor id of the control that gets the ring; null rings the anchor itself. */
  targetId?: string | null;
  status: TutorialPlayerStatus;
  /** The anchor is temporarily unavailable because of a dialog or scrolling. */
  suspended: boolean;
  suspensionReason: "dialog" | "anchor-out-of-view" | "context" | null;
  onRestoreView?: () => void | Promise<void>;
  error?: string | null;
  /** Withhold the advance control until the learner completes the step. */
  gateAdvance: boolean;
  /**
   * The learner navigated back to a step they already finished: the card
   * offers Next instead of waiting for an outcome the workspace already holds.
   */
  revisiting?: boolean;
  /** The outcome held at entry; allow manual continuation instead of grading it again. */
  alreadyDone?: boolean;
  /** Final practice step reached its outcome; Finish ends the tutorial. */
  readyToFinish?: boolean;
  /** How long a gated step waits before revealing the "Done when …" hint. */
  hintDelayMs?: number;
  /** Highlight/popover transfer animation between steps; 0 renders synchronously. */
  transitionMs?: number;
  autoplayDurationMs: number | null;
  autoplayProgressActive: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onTogglePause: () => void;
  onStop: () => void;
  onNarrationComplete: () => void;
}

/**
 * driver.js owns the overlay, the spotlight cutout, and scrolling the anchor
 * into view. The instruction card is positioned by this component, not by
 * driver's popover: by default it attaches beside the highlighted control
 * (see card-placement.ts) so the instruction and the ring read as one thing
 * on a wide screen, and it never covers the control or the region the step
 * describes. Steps can still dock the card in the corner or centre it.
 *
 * Two of driver's defaults are deliberately reversed below: practice mode
 * grades outcomes, so every route through the UI must stay clickable — not
 * only the spotlighted element — and clicks must pass through the dimmed
 * area to the real controls underneath, as the previous overlay allowed.
 */
const OVERLAY_CSS = `
.driver-active * { pointer-events: auto; }
.driver-active .driver-overlay { pointer-events: none !important; }
.driver-active .tourkit-pointer,
.driver-active .tourkit-pointer * { pointer-events: none !important; }
/* The cutout path carries an inline pointer-events: auto; !important beats it
   so clicks pass through the dim to the real controls underneath. */
.driver-active .driver-overlay path { pointer-events: none !important; }
.driver-overlay { z-index: 7900 !important; }

/* driver freezes the highlighted element's scrollable parent to keep its
   stage aligned, which locks panels like the palette mid-tutorial. The stage
   refreshes on scroll anyway, so scrolling stays allowed. */
.driver-active-element-parent-no-scroll { overflow: auto !important; }

/* Popups the learner opens outrank tutorial chrome: a step that asks for a
   menu choice must never cover that menu with its own card. Dialogs suspend
   the tutorial when they cover an outside anchor; modal-contained tutorial
   anchors remain active above their dialog. */
.driver-active > [role="menu"],
.driver-active > [data-radix-popper-content-wrapper] { z-index: 8100 !important; }


@keyframes tourkit-glow {
  0%, 100% { box-shadow: 0 0 0 4px rgba(250, 204, 21, .3), 0 0 18px rgba(250, 204, 21, .55); }
  50% { box-shadow: 0 0 0 8px rgba(250, 204, 21, .16), 0 0 34px rgba(250, 204, 21, .8); }
}
@keyframes tourkit-read-progress { from { width: 0%; } to { width: 100%; } }

@media (prefers-reduced-motion: reduce) {
  .tourkit-ring { animation: none !important; transition: opacity 0ms !important; }
  .tourkit-surface, .tourkit-surface * { animation-iteration-count: 1 !important; transition: none !important; }
}
`;

const buttonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: 34,
  height: 34,
  border: "1px solid var(--tourkit-line)",
  borderRadius: 8,
  background: "var(--tourkit-bg)",
  color: "var(--tourkit-ink)",
  cursor: "pointer",
};

/**
 * Layers that only exist because an allowed control opened them: the menu
 * behind the side panel options, a select's listbox, a dialog the step asked for.
 * Guided steps let pointer input through to these — the outcome frequently
 * lives inside one — and to the tutorial's own card.
 */
const TRANSIENT_LAYER_SELECTOR =
  '[data-tutorial-surface], [role="menu"], [role="listbox"], [role="dialog"], [data-radix-popper-content-wrapper]';

/**
 * Pointer events a guided step intercepts in the capture phase. Wheel, scroll
 * and hover are deliberately absent: a learner must still be able to look
 * around.
 */
const GUARDED_POINTER_EVENTS = [
  "pointerdown",
  "pointerup",
  "mousedown",
  "mouseup",
  "click",
  "dblclick",
  "contextmenu",
] as const;

/**
 * ⌘/Ctrl shortcuts a guided step lets through: the browser's own and the
 * clipboard's. Every other modifier chord belongs to the application — ⌘K
 * opens the command palette — and would drop a surface over the tour exactly
 * the way a stray click does.
 */
const BROWSER_SHORTCUT_KEYS = new Set([
  "a", "c", "f", "p", "r", "v", "x", "y", "z", "+", "-", "=", "0",
]);

/**
 * Keys that always reach the page, whatever has focus: moving around and
 * getting out. Guided input steering must never leave a keyboard-only learner
 * unable to navigate or to stop the tutorial.
 */
const UNGUARDED_KEYS = new Set([
  "Tab",
  "Escape",
  "Shift",
  "Control",
  "Alt",
  "Meta",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "PageUp",
  "PageDown",
  "Home",
  "End",
]);

/** How long the "only the highlighted control" note stays up after a blocked click. */
const BLOCKED_HINT_MS = 4_000;

/**
 * How long a gated practice step waits before revealing its "Done when …"
 * hint. Learners who are moving never see it; learners who linger get the
 * outcome criterion as the nudge — the card's only stuck-help.
 */
const HINT_DELAY_MS = 12_000;
/** driver.js pads its cutout by this much; the extra holes match it. */
const STAGE_PADDING = 6;
const STAGE_RADIUS = 10;

/**
 * driver.refresh(), minus the two cases where re-measuring moves the box to
 * the wrong place: mid-glide (the transition measures the new element on its
 * own, and a refresh would snap the stage back to the previous element), and
 * while driver still holds a previous anchor the view has removed (a detached
 * element measures 0 × 0 at the top-left corner).
 */
const DRIVER_STAMPED_ATTRIBUTES = ["aria-haspopup", "aria-expanded", "aria-controls"] as const;

/**
 * driver.highlight(), keeping the application's own disclosure state. driver
 * stamps the element it highlights with aria-haspopup / aria-expanded /
 * aria-controls for a popover this player never opens, and strips all three
 * from the element it leaves. Left in place, the stamp lies: a closed
 * menu launcher read as expanded, so the emulator's menu action skipped
 * opening it and found no item (and a screen reader heard the same lie); on
 * a launcher whose list really was open, the stamp replaced the list's id and
 * the open-list spotlight (openListOf) lost it. Every value is put back
 * exactly as the application had it, including its absence.
 */
function highlightKeepingAria(instance: Driver, element: HTMLElement | undefined): void {
  const previous = instance.getState("__activeElement") as HTMLElement | undefined;
  const saved = [...new Set([previous, element])]
    .filter((node): node is HTMLElement => Boolean(node))
    .map((node) => ({
      node,
      values: DRIVER_STAMPED_ATTRIBUTES.map((name) => [name, node.getAttribute(name)] as const),
    }));
  // Driver removes old highlight classes through document queries. A replaced
  // anchor is detached and cannot be found by that cleanup.
  if (previous && previous !== element && !previous.isConnected) previous.classList.remove("driver-active-element");
  instance.highlight({ element });
  for (const { node, values } of saved) {
    for (const [name, value] of values) {
      if (value === null) node.removeAttribute(name);
      else node.setAttribute(name, value);
    }
  }
}

function refreshStage(instance: Driver | null): void {
  if (!instance || instance.getState("__transitionCallback")) return;
  const active = instance.getState("__activeElement") as HTMLElement | undefined;
  if (active && !active.isConnected) return;
  // Attached but hidden for the moment (display: none while a list
  // re-renders) measures the same 0 × 0 corner box; wait for it to return.
  if (active && active.id !== "driver-dummy-element" && hasNoBox(active)) return;
  instance.refresh();
}

/**
 * Rendered nowhere (display: none on it or an ancestor, as a closing surface
 * or a re-rendering list does): no layout boxes at all, so it would measure
 * 0 × 0 at the top-left corner.
 */
function hasNoBox(element: HTMLElement): boolean {
  return element.getClientRects().length === 0;
}

export function TutorialOverlay({
  domPolicy = DEFAULT_TUTORIAL_DOM_POLICY,
  highlightStyle,
  anchor,
  step,
  stepIndex,
  stepCount,
  tutorialTitle,
  mode,
  spotlightStyle,
  cardLayout = { placement: "attached", size: "default", pointer: true },
  interaction = "free",
  targetId = null,
  status,
  suspended,
  suspensionReason,
  error,
  gateAdvance,
  autoplayDurationMs,
  autoplayProgressActive,
  onPrevious,
  onNext,
  onTogglePause,
  onStop,
  onNarrationComplete,
  revisiting = false,
  alreadyDone = false,
  onRestoreView,
  readyToFinish = false,
  hintDelayMs = HINT_DELAY_MS,
  transitionMs = 0,
}: TutorialOverlayProps) {
  const domPolicyRef = useLatestRef(domPolicy);
  const onStopRef = useLatestRef(onStop);
  const driverRef = useRef<Driver | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const narrationCompletedRef = useRef(false);
  const pausedByTutorialRef = useRef(false);
  const descriptionId = useId();
  const statusId = useId();
  const arrowId = useId();
  const glow = spotlightStyle === "glow";
  const dialogSuspended = suspensionReason === "dialog";
  // The outcome criterion is the card's only stuck-help: hidden while the
  // learner is moving, revealed after they linger on a gated step.
  const [hintOffered, setHintOffered] = useState(false);
  // Bumped by a click a guided step turned away, so the card can say why
  // nothing happened instead of letting the workspace feel broken.
  const [blockedNonce, setBlockedNonce] = useState(0);
  const [hintKey, setHintKey] = useState(step.id);
  if (hintKey !== step.id) {
    setHintKey(step.id);
    setHintOffered(false);
    setBlockedNonce(0);
  }
  useEffect(() => {
    if (suspended || !gateAdvance || !step.check?.description) return;
    const timer = window.setTimeout(() => setHintOffered(true), hintDelayMs);
    return () => window.clearTimeout(timer);
  }, [gateAdvance, hintDelayMs, step.check?.description, step.id, suspended]);

  useEffect(() => {
    if (blockedNonce === 0) return;
    const timer = window.setTimeout(() => setBlockedNonce(0), BLOCKED_HINT_MS);
    return () => window.clearTimeout(timer);
  }, [blockedNonce]);

  // A guided tour names regions instead of building anything: there is no
  // second route to its outcome, and a stray click on unrelated chrome can
  // bury the tour under a modal whose backdrop then swallows the very control
  // being ringed. So pointer input is confined to that control (plus the
  // menus, listboxes and dialogs it opens, and the tutorial's own card), and
  // application keyboard shortcuts — ⌘K opens the command palette from
  // anywhere, including from the tutorial card itself — are held back with it.
  // Free tutorials — everything that builds a form — keep the whole workspace
  // live, because practice grades the outcome and every route to it counts.
  const guided = interaction === "guided";
  useEffect(() => {
    if (!guided || suspended) return;
    const document = anchor.ownerDocument;
    const allows = (node: EventTarget | null): boolean => {
      const element = node instanceof Element
        ? node
        : node instanceof Node ? node.parentElement : null;
      // Events with no element behind them (the window itself) are not clicks
      // on application chrome and are left alone.
      if (!element) return true;
      if (element.closest(TRANSIENT_LAYER_SELECTOR)) return true;
      const base = (targetId ? findTutorialAnchor(document, targetId, domPolicy) : null) ?? anchor;
      // an open drop-down's list is part of the control it hangs off
      return base.contains(element) || Boolean(openListOf(base)?.contains(element));
    };
    const block = (event: Event) => {
      if (allows(event.target)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      // One nudge per gesture: the press is what the learner meant.
      if (event.type === "pointerdown" || event.type === "mousedown") {
        setBlockedNonce((nonce) => nonce + 1);
      }
    };
    // Capture on the document runs before the application's own document
    // listeners (the palette's ⌘K handler among them) and before the event
    // reaches the control, so stopping it here stops it everywhere.
    const blockKey = (event: KeyboardEvent) => {
      if (UNGUARDED_KEYS.has(event.key)) return;
      const chord = event.metaKey || event.ctrlKey;
      // A chord is a global shortcut wherever focus happens to be; a plain
      // Enter or Space only activates whatever the learner has focused.
      const blocked = chord
        ? !BROWSER_SHORTCUT_KEYS.has(event.key.toLowerCase())
        : (event.key === "Enter" || event.key === " ") && !allows(event.target);
      if (!blocked) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setBlockedNonce((nonce) => nonce + 1);
    };
    for (const type of GUARDED_POINTER_EVENTS) {
      document.addEventListener(type, block, true);
    }
    document.addEventListener("keydown", blockKey, true);
    return () => {
      for (const type of GUARDED_POINTER_EVENTS) {
        document.removeEventListener(type, block, true);
      }
      document.removeEventListener("keydown", blockKey, true);
    };
  }, [anchor, domPolicy, guided, suspended, targetId]);

  useEffect(() => {
    const instance = driver({
      animate: transitionMs > 0,
      duration: transitionMs > 0 ? transitionMs : undefined,
      smoothScroll: true,
      allowClose: false,
      allowKeyboardControl: false,
      disableActiveInteraction: false,
      // Try it always leaves the interface visible, including imported lessons
      // with authored dim steps. Watch retains the authored spotlight style.
      overlayColor: "black",
      overlayOpacity: mode === "practice" || glow ? 0 : 0.7,
      stagePadding: STAGE_PADDING,
      stageRadius: STAGE_RADIUS,
      showButtons: [],
    });
    driverRef.current = instance;
    return () => {
      driverRef.current = null;
      instance.destroy();
    };
  }, [glow, mode, transitionMs]);

  // An anchorless step taken inside a modal (a recorded step with no control
  // to ring, or a card that explains the dialog) lights the dialog itself:
  // lighting nothing would dim the very window the learner has to work in.
  const [anchorlessDialog, setAnchorlessDialog] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const document = anchor.ownerDocument;
    if (anchor !== document.body) {
      setAnchorlessDialog(null);
      return;
    }
    const update = () => setAnchorlessDialog(topmostApplicationDialog(document, { domPolicy }));
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["open", "aria-modal", "data-state"] });
    return () => observer.disconnect();
  }, [anchor, domPolicy]);

  // The spotlight's hole follows a drop-down's open list the way the ring
  // does (resolveRingElement): a list drawn outside the control's box would
  // otherwise sit under the dim, beside a lit but closed field.
  const [openList, setOpenList] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const document = anchor.ownerDocument;
    // an anchorless step has no control to drop a list from; the highlight
    // below ignores openList for it
    if (anchor === document.body) return;
    // A control can say it is expanded a frame before its list is placed on
    // the page (a popup portalled and positioned after it opens): look again
    // on the next few frames rather than miss the list.
    let frame = 0;
    let retries = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      const target = targetId ? findTutorialAnchor(document, targetId, domPolicy) : null;
      const base = target ?? anchor;
      // A step anchored on a menu launcher with the item as its target (File
      // ▸ Close): once the menu is open the item exists, but it is the
      // launcher that dropped the list. Light that whole list while it holds
      // the item, not the closed launcher.
      const anchorList = target ? openListOf(anchor) : null;
      const next = openListOf(base) ?? (anchorList && target && anchorList.contains(target) ? anchorList : null);
      setOpenList((previous) => (previous === next ? previous : next));
      const pending = !next && base.querySelector('[aria-expanded="true"][aria-controls]') !== null;
      if (pending && retries < 10) {
        retries += 1;
        frame = requestAnimationFrame(update);
      }
    };
    update();
    const observer = new MutationObserver(() => {
      retries = 0;
      update();
    });
    observer.observe(document.body, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: ["aria-expanded", "aria-controls"],
    });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [anchor, domPolicy, targetId]);

  useEffect(() => {
    const instance = driverRef.current;
    if (!instance) return;
    // Destroy driver's stage while an unrelated modal owns the screen. This
    // removes the active-element stacking class as well as the SVG cutout, so
    // the covered control itself cannot be lifted through the dialog.
    if (dialogSuspended) {
      instance.destroy();
      return;
    }
    // No popover: the docked card and the ring replace it entirely.
    const element = anchor === anchor.ownerDocument.body
      ? anchorlessDialog ?? undefined
      : openList ?? visibleBoxOf(anchor);
    // A step's own action can remove its control before the next step has
    // found its own (Watch runs the action first). Highlighting the removed
    // element glides the box to its 0 × 0 spot in the top-left corner and
    // back out again; hold the box where it is until a live element arrives.
    if (element && (!element.isConnected || hasNoBox(element))) return;
    // driver glides its box from the last stage rectangle to the new element.
    // An anchorless step leaves a zero-size stage at the screen centre, and
    // growing the next box out of that point reads as a box flying in from
    // nowhere: start such a step's box where it lands instead. The stage
    // object is driver's own state, read afresh on every animation frame.
    const stage = instance.getState("__activeStagePosition") as StageRect | undefined;
    if (element && stage && isDegenerateStage(stage)) {
      const rect = element.getBoundingClientRect();
      Object.assign(stage, { x: rect.x, y: rect.y, width: rect.width, height: rect.height });
    }
    // The reverse: a step with nothing to light parks driver's box as a
    // point in the middle of the screen. Gliding there shrinks the last box
    // into the centre; put the stage there first so it simply closes.
    if (!element && stage) {
      Object.assign(stage, { x: window.innerWidth / 2, y: window.innerHeight / 2, width: 0, height: 0 });
    }
    highlightKeepingAria(instance, element);
    // driver has no option to disable its Tab focus trap, which would confine
    // keyboard users to the card and the spotlighted element. Practice mode
    // accepts any route to the outcome, so the whole workspace must stay
    // reachable; detach only driver's keydown (Tab) handler and keep its
    // resize/scroll/keyup wiring intact. `__events` is part of driver's
    // exported State type.
    const events = instance.getState("__events") as
      | { onKeydown?: (event: KeyboardEvent) => void; onScroll?: () => void; onResize?: () => void }
      | undefined;
    if (events?.onKeydown) window.removeEventListener("keydown", events.onKeydown);
    // driver re-measures its active element on every window scroll and
    // resize. After a step's action swaps the view, that element is the
    // previous anchor, detached: it measures 0 × 0 at the top-left, the stage
    // snaps there, and the next box glides in from the corner instead of from
    // the spot that was lit. The sync loop below watches the same scrolling
    // and resizing (autoUpdate) and refreshes through refreshStage, which
    // skips a detached element.
    if (events?.onScroll) window.removeEventListener("scroll", events.onScroll);
    if (events?.onResize) window.removeEventListener("resize", events.onResize);
  }, [anchor, anchorlessDialog, dialogSuspended, glow, openList, step.id]);

  // driver cuts one hole, around the anchor region. A step whose ring is on a
  // target outside that region (the Content Area step rings Measures in the
  // tree) would leave the control to press in the dark, so the parts of the
  // ring's box outside driver's hole are cut too. Rewritten after every path
  // driver writes (highlight, refresh, each glide frame), from driver's live
  // stage rectangle, so the extra holes follow the animation.
  useEffect(() => {
    if (!step.highlights?.length || suspended) return;
    const doc = anchor.ownerDocument;
    const root = doc.createElement("div");
    root.dataset.tutorialFocusLayer = step.id;
    root.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:7940;";
    root.setAttribute("aria-hidden", "true");
    doc.body.append(root);
    const draw = () => { root.replaceChildren(); drawFocusHighlights(doc, root, step.highlights, domPolicy); };
    draw();
    const timer = window.setInterval(draw, 120);
    doc.addEventListener("scroll", draw, true); doc.defaultView?.addEventListener("resize", draw);
    return () => { window.clearInterval(timer); doc.removeEventListener("scroll", draw, true); doc.defaultView?.removeEventListener("resize", draw); root.remove(); };
  }, [anchor, domPolicy, step.id, step.highlights, suspended]);

  const lastGoodStageRef = useRef<StageRect | null>(null);
  useEffect(() => {
    if (glow || dialogSuspended) return;
    const document = anchor.ownerDocument;
    let written: string | null = null;
    let base = "";
    const patch = () => {
      const instance = driverRef.current;
      const path = document.querySelector<SVGPathElement>(".driver-overlay path");
      if (!instance || !path) return;
      const current = path.getAttribute("d") ?? "";
      if (current !== written) base = current;
      const ring = resolveRingElement(anchor, targetId, domPolicy);
      const stage = instance.getState("__activeStagePosition") as StageRect | undefined;
      let lit = anchor === document.body || isDegenerateStage(stage) ? null : stage!;
      // driver cuts around the lit element's whole box. A table row wider
      // than its scrolling pane would then be lit across the window chrome
      // the pane hides it behind; once the glide has settled, cut around the
      // part the panes show instead.
      const litElement = instance.getState("__activeElement") as HTMLElement | undefined;
      let prefix = base;
      // driver ends a glide by measuring its target again. A target React
      // replaced mid-glide measures 0 × 0 at the top-left corner, and the
      // hole sat there until the next step (then glided out of the corner).
      // Keep the last hole that belonged to a live element instead.
      if (stage && litElement && litElement.id !== "driver-dummy-element") {
        if (!isDegenerateStage(stage) && litElement.isConnected) {
          lastGoodStageRef.current = { x: stage.x, y: stage.y, width: stage.width, height: stage.height };
        } else if (lastGoodStageRef.current && !instance.getState("__transitionCallback")) {
          // Detached, or still attached but with no box for the moment (a
          // palette tile hidden while its list re-renders): either way it
          // measures 0 × 0 in the corner. Not mid-glide: driver still names
          // the element it is leaving until the glide ends, and restoring
          // here would pin every frame to the old box.
          Object.assign(stage, lastGoodStageRef.current);
          lit = { ...lastGoodStageRef.current };
          prefix = stageOverlayPath(lit, STAGE_PADDING, STAGE_RADIUS, { width: window.innerWidth, height: window.innerHeight });
        }
      }
      if (lit && litElement?.isConnected && !instance.getState("__transitionCallback")) {
        const whole = litElement.getBoundingClientRect();
        const shown = visibleClientRect(litElement);
        if (shown.width < whole.width - 0.5 || shown.height < whole.height - 0.5) {
          lit = { x: shown.x, y: shown.y, width: shown.width, height: shown.height };
          prefix = stageOverlayPath(lit, STAGE_PADDING, STAGE_RADIUS, { width: window.innerWidth, height: window.innerHeight });
        }
      }
      let holes: ReturnType<typeof boxMinus> = [];
      const rect = visibleClientRect(ring);
      if (ring !== anchor && ring !== document.body && ring.isConnected && rect.width >= 1 && rect.height >= 1) {
        const ringBox = paddedBox(rect, STAGE_PADDING);
        holes = lit ? boxMinus(ringBox, paddedBox(lit, STAGE_PADDING)) : [ringBox];
      }
      const occupied = [...(lit ? [paddedBox(lit, STAGE_PADDING)] : []), ...holes];
      holes.push(...additionalFocusCutouts(resolveFocusHighlights(document, step.highlights, domPolicy).map((item) => item.rect), occupied, STAGE_PADDING));
      const next = holes.length ? `${prefix}\n    ${cutoutPath(holes)}` : prefix;
      written = next;
      if (next !== current) path.setAttribute("d", next);
    };
    patch();
    // Path rewrites anywhere below body, and the overlay SVG itself, which
    // driver appends to body with its path already drawn.
    const onPath = new MutationObserver((records) => {
      if (records.some((record) => (record.target as Element).getAttribute("d") !== written)) patch();
    });
    onPath.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["d"] });
    const onOverlay = new MutationObserver(patch);
    onOverlay.observe(document.body, { childList: true });
    const timer = step.highlights?.length ? window.setInterval(patch, 120) : undefined;
    return () => {
      if (timer !== undefined) window.clearInterval(timer);
      onPath.disconnect();
      onOverlay.disconnect();
    };
  }, [anchor, domPolicy, targetId, glow, dialogSuspended, openList, step.id, step.highlights]);

  // The accent ring floats above the page instead of styling the anchor
  // itself: a box-shadow on the element paints below its later siblings and
  // is clipped by scrollable ancestors, which shredded the glow inside the
  // palette. Floating UI observes nested scrolling, resizing and layout
  // shifts so the card and its accents update together without an idle loop.
  const ringRef = useRef<HTMLDivElement | null>(null);
  const regionRef = useRef<HTMLDivElement | null>(null);
  const pointerRef = useRef<SVGSVGElement | null>(null);
  const cardPositionRef = useRef<CardPosition | null>(null);
  const anchorIsBody = anchor === anchor.ownerDocument.body;
  const centered = cardLayout.placement === "center";
  // Attached placement needs a control to attach to; anchorless steps (a
  // modal that closes on its own action) dock the card instead.
  const attached = cardLayout.placement === "attached" && !anchorIsBody;
  const docked = !centered && !attached;
  const showBox = highlightStyle !== "arrow";
  const showPointer = !anchorIsBody && (highlightStyle ? highlightStyle !== "box" : cardLayout.pointer && !docked);
  const preferredSide: CardSide | null = step.anchor
    && step.anchor.placement !== "auto"
    && step.anchor.placement !== "center"
    ? step.anchor.placement
    : null;
  useEffect(() => {
    cardPositionRef.current = null;
    // A centered card that moved aside for the last step's control starts
    // the next step back in the middle; the sync below moves it again if
    // this step's control is there.
    const card = cardRef.current;
    if (card) {
      // Floating placement can shorten an attached card. A later reading
      // card needs its own available height and must start at its heading.
      card.style.maxHeight = "calc(100vh - 32px)";
      card.scrollTop = 0;
    }
    if(card?.dataset.focusAvoidance==='true'){
      delete card.dataset.focusAvoidance;delete card.dataset.cardPosition;
      if(centered){card.style.left='50%';card.style.top='50%';card.style.right='auto';card.style.bottom='auto';card.style.transform='translate(-50%, -50%)'}
      else if(docked){card.style.left='auto';card.style.top='auto';card.style.right='16px';card.style.bottom='16px';card.style.transform='none'}
      else{card.style.right='auto';card.style.bottom='auto';card.style.transform='none'}
    }
    if (card && centered && card.dataset.cardPosition && card.dataset.cardPosition !== "center") {
      delete card.dataset.cardPosition;
      card.style.left = "50%";
      card.style.top = "50%";
      card.style.bottom = "";
      card.style.transform = "translate(-50%, -50%)";
    }
  }, [step.id, attached, centered, docked]);
  useEffect(() => {
    let frame = 0;
    let disposed = false;
    let revision = 0;
    const sync = async () => {
      const request = ++revision;
      const ring = ringRef.current;
      const card = cardRef.current;
      // Both boxes are cut to what their scrolling panes show, so a row
      // wider than its pane is not outlined across the chrome hiding it.
      const anchorBox = visibleBoxOf(anchor);
      const rect = visibleClientRect(anchorBox);
      // The ring marks the control to press: the step's target when it names
      // one (Home inside the ribbon), otherwise the anchor region itself. An
      // anchorless step rings the dialog it is lighting, and nothing otherwise.
      const ringElement = anchorIsBody && !targetId && anchorlessDialog ? anchorlessDialog : resolveRingElement(anchor, targetId, domPolicy);
      const ringRect = visibleClientRect(ringElement);
      const placementRect = visibleClientRect(tutorialPlacementRegion(ringElement));
      // autoUpdate sees the host window's style change during a drag, but
      // driver.js only refreshes its cutout on scroll and resize. Keep the
      // dimmed opening on the same live rectangle as our floating ring.
      if (!dialogSuspended && anchor.isConnected && ringElement.isConnected) {
        refreshStage(driverRef.current);
      }
      // A centered card moves out of the way when it would cover the control
      // it is describing: to the first spot on screen that leaves the ringed
      // control clear (and the described region too, when it can). A tall
      // card at the bottom can still cover a control in the middle of the
      // screen, where a guided step then turns the learner's clicks away.
      // The docked card never moves.
      if (card && centered) {
        const cardRect = card.getBoundingClientRect();
        const cost = (box: { left: number; top: number; right: number; bottom: number }) => {
          if (anchorIsBody) return 0;
          const overlap = (other: DOMRect) => other.width > 0 && other.height > 0
            ? Math.max(0, Math.min(box.right, other.right + 8) - Math.max(box.left, other.left - 8))
              * Math.max(0, Math.min(box.bottom, other.bottom + 8) - Math.max(box.top, other.top - 8))
            : 0;
          return overlap(ringRect) * 1000 + overlap(rect) + overlap(placementRect);
        };
        const current = cost(cardRect);
        // Only move away from an overlap; moving back would oscillate when
        // the control sits exactly where the centered card lands.
        if (current > 0 && cardRect.width > 0) {
          const spot = bestCenteredCardSpot(cardRect.width, cardRect.height, window.innerWidth, window.innerHeight, cost);
          if (spot && spot.cost < current) {
            card.dataset.cardPosition = spot.name;
            card.style.left = `${Math.round(spot.left)}px`;
            card.style.top = `${Math.round(spot.top)}px`;
            card.style.bottom = "auto";
            card.style.transform = "none";
          }
        } else if (!card.dataset.cardPosition) {
          card.dataset.cardPosition = "center";
        }
      }
      let referenceHidden = false;
      // Floating UI flips sides and shifts along viewport edges. Retain a
      // side while it fits, including when the learner scrolls horizontally.
      if (card && attached) {
        const measurable = rect.width > 0 && rect.height > 0;
        if (measurable) {
          const placement = await positionTutorialCard(anchorBox, ringElement, card,
            preferredSide, cardPositionRef.current, showPointer && highlightStyle ? 72 : 20);
          if (disposed || request !== revision) return;
          referenceHidden = placement.referenceHidden;
          cardPositionRef.current = placement.position;
          card.dataset.cardPosition = placement.position;
          card.style.left = `${Math.round(placement.left)}px`;
          card.style.top = `${Math.round(placement.top)}px`;
        } else if (!card.dataset.cardPosition) {
          // Layout-free DOMs report no geometry; keep the card readable.
          card.dataset.cardPosition = "bottom-right";
          card.style.left = "auto";
          card.style.right = "16px";
          card.style.top = "auto";
          card.style.bottom = "16px";
        }
        card.style.opacity = "1";
      }
      if(card&&step.highlights?.length&&!suspended){
        const annotations=focusAnnotationAvoidRects(resolveFocusHighlights(anchor.ownerDocument,step.highlights,domPolicy));
        const primary=!anchorIsBody&&ringRect.width>0&&ringRect.height>0?[paddedBox(ringRect,8)]:[];
        const clear=placeCardOutsideFocus(card.getBoundingClientRect(),{width:window.innerWidth,height:window.innerHeight},annotations,primary);
        if(clear){card.dataset.focusAvoidance='true';card.dataset.cardPosition='focus-avoid';card.style.left=`${Math.round(clear.left)}px`;card.style.top=`${Math.round(clear.top)}px`;card.style.right='auto';card.style.bottom='auto';card.style.transform='none'}
      }
      const pointer = pointerRef.current;
      if (pointer && card) {
        const line = pointer.querySelector("line");
        const cardRect = card.getBoundingClientRect();
        const visibleAnchor = !anchorIsBody && ringRect.width > 0 && ringRect.height > 0 && !suspended && !referenceHidden;
        if (line && visibleAnchor) {
          const geometry = tutorialArrow(cardRect, ringRect, { width: window.innerWidth, height: window.innerHeight });
          if (geometry && ringElement.isConnected) {
            line.setAttribute("x1", String(geometry.start.x));
            line.setAttribute("y1", String(geometry.start.y));
            line.setAttribute("x2", String(geometry.end.x));
            line.setAttribute("y2", String(geometry.end.y));
            pointer.style.opacity = "1";
          } else {
            pointer.style.opacity = "0";
          }
        } else {
          pointer.style.opacity = "0";
        }
      }
      const fitsViewport = (box: DOMRect) => box.width > 0
        && box.height > 0
        && box.bottom > 0
        && box.right > 0
        && box.top < window.innerHeight
        && box.left < window.innerWidth;
      if (ring) {
        // A covered, detached, or off-screen element must not leave a ghost
        // ring at its old position while the tutorial is suspended.
        if (!suspended && !referenceHidden && ringElement.isConnected && ringElement !== anchor.ownerDocument.body && fitsViewport(ringRect)) {
          // Clamp to the viewport so an anchor hugging a screen edge (the
          // ribbon tabs at the top, for instance) gets a ring that hugs the
          // edge too, instead of bleeding off-page and looking cut.
          const pad = 6;
          const inset = 2;
          const left = Math.max(inset, ringRect.left - pad);
          const top = Math.max(inset, ringRect.top - pad);
          const right = Math.min(window.innerWidth - inset, ringRect.right + pad);
          const bottom = Math.min(window.innerHeight - inset, ringRect.bottom + pad);
          ring.style.opacity = "1";
          ring.style.left = `${left}px`;
          ring.style.top = `${top}px`;
          ring.style.width = `${Math.max(0, right - left)}px`;
          ring.style.height = `${Math.max(0, bottom - top)}px`;
        } else {
          ring.style.opacity = "0";
        }
      }
      const region = regionRef.current;
      if (region) {
        // When the step rings one control inside a wider region (Home inside
        // the Ribbon), outline the region too so the vocabulary the card
        // teaches — "this whole strip is the Ribbon" — has a visible edge.
        const distinct = ringElement !== anchor && !anchorIsBody;
        if (distinct && !suspended && anchor.isConnected && fitsViewport(rect)) {
          const pad = 4;
          const inset = 1;
          const left = Math.max(inset, rect.left - pad);
          const top = Math.max(inset, rect.top - pad);
          const right = Math.min(window.innerWidth - inset, rect.right + pad);
          const bottom = Math.min(window.innerHeight - inset, rect.bottom + pad);
          region.style.opacity = "1";
          region.style.left = `${left}px`;
          region.style.top = `${top}px`;
          region.style.width = `${Math.max(0, right - left)}px`;
          region.style.height = `${Math.max(0, bottom - top)}px`;
        } else {
          region.style.opacity = "0";
        }
      }
    };
    const schedule = () => {
      ++revision;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { void sync(); });
    };
    const card = cardRef.current;
    if (!card) return;
    let observedTarget: HTMLElement | null = null;
    let cleanupTarget = () => {};
    const options = {
      elementResize: typeof ResizeObserver !== "undefined",
      layoutShift: typeof IntersectionObserver !== "undefined",
    };
    const bindTarget = () => {
      const target = resolveRingElement(anchor, targetId, domPolicy);
      if (target === observedTarget) return;
      cleanupTarget();
      observedTarget = target;
      cleanupTarget = target === anchor ? () => {} : autoUpdate(target, card, schedule, options);
    };
    bindTarget();
    const cleanupAnchor = autoUpdate(anchor, card, schedule, options);
    // Menus can transfer the target id to a new DOM node. Ignore our own
    // position/style writes to avoid creating a mutation → layout loop.
    const mutations = new MutationObserver((records) => {
      if (!records.some(({ target }) => !(target instanceof Element)
        || !target.closest('[data-testid="tutorial-overlay"], .driver-overlay'))) return;
      bindTarget();
      schedule();
    });
    mutations.observe(anchor.ownerDocument.body, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: ["data-tutorial-id", "data-tutorial-aliases", "hidden", "style", "class", "aria-expanded"],
    });
    return () => {
      disposed = true;
      ++revision;
      cancelAnimationFrame(frame);
      mutations.disconnect();
      cleanupTarget();
      cleanupAnchor();
    };
  }, [anchor, anchorIsBody, anchorlessDialog, attached, centered, domPolicy, preferredSide, suspended, targetId, highlightStyle, showPointer, step.id, step.highlights, dialogSuspended]);

  // Bring a control that starts outside its scroll pane into view when the
  // step opens, instead of asking the learner to find it. Only once per step:
  // afterwards the learner owns the scroll position, and the card offers a
  // button to bring the control back if they lose it.
  const scrollAnchorIntoView = useCallback((behavior: ScrollBehavior = "smooth") => {
    const ringElement = resolveRingElement(anchor, targetId, domPolicy);
    if (typeof ringElement.scrollIntoView !== "function") return;
    ringElement.scrollIntoView({ block: "center", inline: "nearest", behavior });
  }, [anchor, domPolicy, targetId]);
  useEffect(() => {
    if (anchorIsBody || suspensionReason === "dialog") return;
    if (isTutorialAnchorFullyVisible(anchor)) return;
    // Instant, not smooth. A smooth scroll animates over several frames, and
    // any re-render of the pane during those frames cancels it part-way — the
    // control ends up partly visible, which still counts as out of view, and
    // the step sits there telling the learner to scroll to something the
    // player was already scrolling to. Measured on an emulated day book: a
    // smooth scroll stopped at scrollLeft 249 where 300 was needed, leaving
    // the ringed cell's right edge 51px past the pane. The learner-initiated
    // "Bring it into view" button below keeps the smooth default, because
    // nothing is racing it there.
    scrollAnchorIntoView("auto");
    // Only the first frame of a step auto-scrolls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.id, anchor]);

  // Pressing the card (Next, Back, Pause) is not a click on the application:
  // it must not close the menu or list the lesson has open. Menus close on a
  // document mousedown / pointerdown outside them, and the card is part of
  // the document, so its presses stop here. (Watch's Next closed a
  // context menu the previous step had opened, and the next step's action
  // then found no item to choose.)
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const keep = (event: Event) => event.stopPropagation();
    card.addEventListener("mousedown", keep);
    card.addEventListener("pointerdown", keep);
    return () => {
      card.removeEventListener("mousedown", keep);
      card.removeEventListener("pointerdown", keep);
    };
  }, []);

  // Focus belongs to entering/leaving a step. Snapshot updates can supply a
  // fresh host callback while the learner is typing; only Escape needs it.
  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    cardRef.current?.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Let the open application dialog handle Escape without also stopping
      // the tutorial. Tutorial surfaces themselves are excluded by the resolver.
      if (event.defaultPrevented || topmostApplicationDialog(anchor.ownerDocument, { includeFloatingWindows: false, domPolicy: domPolicyRef.current })) return;
      event.preventDefault();
      onStopRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
    };
  }, [anchor.ownerDocument, domPolicyRef, onStopRef, step.id]);

  const paused = status === "paused";
  const playbackPaused = paused || suspended;
  const busy = status === "executing" || status === "locating";
  // Practice needs no coaching line: the highlight and the "Done when …"
  // description say what to do, and the next step appearing says it worked.
  // Watch keeps one line explaining the automatic pacing.
  const statusMessage = suspensionReason === "context"
    ? `This step belongs to ${step.context?.label ?? "another view"}. Return there to continue.`
    : suspensionReason === "dialog"
    ? "Tutorial paused while this dialog is open. Close it to continue."
    : suspensionReason === "anchor-out-of-view"
      ? "The highlighted control is out of view. Scroll to it, or select Bring it into view."
      : mode === "autoplay"
        ? (busy ? "Preparing this step…" : "Read at your pace — this continues automatically, or select Next when you are ready.")
        : null;

  useEffect(() => {
    narrationCompletedRef.current = false;
    pausedByTutorialRef.current = false;
  }, [step.id]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playbackPaused && !audio.paused) {
      pausedByTutorialRef.current = true;
      audio.pause();
      return;
    }
    if (!playbackPaused && pausedByTutorialRef.current) {
      pausedByTutorialRef.current = false;
      void audio.play().catch(() => undefined);
    }
  }, [playbackPaused]);

  const completeNarration = useCallback(() => {
    if (narrationCompletedRef.current) return;
    narrationCompletedRef.current = true;
    onNarrationComplete();
  }, [onNarrationComplete]);
  // Export presentation can choose a yellow box, red pointer, or both.
  // An unconfigured application player retains its authored blue pointer.
  const accent = "#ca8a04";
  const accentBorder = "#facc15";
  const pointerColor = highlightStyle ? "#dc2626" : "#38bdf8";

  if (typeof document === "undefined") return null;

  const spotlightRing = showBox && (
    <div
      ref={ringRef}
      aria-hidden
      data-testid="tutorial-spotlight"
      className="tourkit-ring"
      style={{
        position: "fixed",
        zIndex: 7950,
        left: 0,
        top: 0,
        width: 0,
        height: 0,
        opacity: 0,
        border: `3px solid ${accentBorder}`,
        borderRadius: 10,
        background: mode === "autoplay" && glow ? "rgba(254, 240, 138, 0.12)" : "transparent",
        boxShadow: "0 0 0 4px rgba(250, 204, 21, .3), 0 0 24px rgba(250, 204, 21, .7)",
        animation: "tourkit-glow 1.4s ease-in-out infinite",
        pointerEvents: "none",
        transition: "opacity 180ms ease",
      }}
    />
  );

  const large = cardLayout.size === "large";
  const cardPlacementStyle: CSSProperties = centered
    ? {
        left: "50%",
        top: "50%",
        transform: "translate(-50%, -50%)",
        width: large ? "min(600px, calc(100vw - 48px))" : "min(440px, calc(100vw - 48px))",
      }
    : attached
      ? {
          // Positioned by Floating UI once the card has been measured;
          // invisible until then so it never flashes in the corner first.
          left: 0,
          top: 0,
          opacity: 0,
          width: large ? "min(480px, calc(100vw - 32px))" : "min(360px, calc(100vw - 32px))",
          transition: "opacity 120ms ease",
        }
      : {
          right: 16,
          bottom: 16,
          width: large ? "min(480px, calc(100vw - 32px))" : "min(360px, calc(100vw - 32px))",
        };
  const regionOutline = (
    <div
      ref={regionRef}
      aria-hidden
      data-testid="tutorial-region"
      style={{
        position: "fixed",
        zIndex: 7940,
        left: 0,
        top: 0,
        width: 0,
        height: 0,
        opacity: 0,
        border: `2px dashed ${pointerColor}`,
        borderRadius: 12,
        pointerEvents: "none",
        transition: "opacity 180ms ease",
      }}
    />
  );
  const pointerArrow = showPointer ? (
    <svg
      ref={pointerRef}
      aria-hidden
      data-testid="tutorial-pointer"
      className="tourkit-pointer"
      style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh", zIndex: 7960, pointerEvents: "none", opacity: 0, transition: "opacity 180ms ease" }}
    >
      <defs>
        <marker id={arrowId} markerWidth="14" markerHeight="12" refX="12" refY="6" orient="auto" markerUnits="userSpaceOnUse">
          <path d="M0,0 L12,6 L0,12 z" fill={pointerColor} />
        </marker>
      </defs>
      <line x1="0" y1="0" x2="0" y2="0" stroke={pointerColor} strokeWidth={highlightStyle ? 4 : 3} strokeLinecap="round" markerEnd={`url(#${arrowId})`} style={{ filter: "drop-shadow(0 1px 2px rgba(15, 23, 42, 0.45))" }} />
    </svg>
  ) : null;

  return createPortal(
    <div
      data-testid="tutorial-overlay"
      data-spotlight-style={spotlightStyle}
      data-card-placement={cardLayout.placement}
      data-card-size={cardLayout.size}
      data-status={status}
      data-suspended={suspended ? "true" : "false"}
      data-suspension-reason={suspensionReason ?? ""}
      data-action-id={step.action?.id}
    >
      <style>{TUTORIAL_SURFACE_CSS + OVERLAY_CSS}</style>
      {showBox && regionOutline}
      {spotlightRing}
      {pointerArrow}
      <section
        ref={cardRef}
        role="dialog"
        aria-modal={false}
        aria-label={`${tutorialTitle}: tutorial step ${stepIndex + 1}`}
        aria-describedby={suspended ? statusId : statusMessage ? `${descriptionId} ${statusId}` : descriptionId}
        aria-live="polite"
        tabIndex={-1}
        {...TUTORIAL_SURFACE_PROPS}
        // Names the card for review feedback ("the wording on this step").
        data-tutorial-step={step.id}
        style={{
          position: "fixed",
          ...cardPlacementStyle,
          zIndex: 8000,
          maxHeight: "calc(100vh - 32px)",
          overflowY: "auto",
          overflowX: "hidden",
          padding: large ? 24 : 18,
          border: "1px solid var(--tourkit-line-soft)",
          borderRadius: 14,
          background: "var(--tourkit-bg)",
          color: "var(--tourkit-ink)",
          boxShadow: "0 20px 55px rgba(15, 23, 42, 0.32)",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          outline: "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: accent, letterSpacing: ".03em", textTransform: "uppercase" }}>
            {mode === "practice" ? "Practice" : "Watch"}
            {step.overlay.showProgress ? ` · ${stepIndex + 1} of ${stepCount}` : ""}
          </span>
          <button type="button" onClick={onStop} aria-label="Stop tutorial" title="Stop tutorial" style={buttonStyle}>
            <Square size={14} fill="currentColor" />
          </button>
        </div>
        <h2 style={{ display: suspended ? "none" : undefined, margin: large ? "14px 0 0" : "10px 0 0", fontSize: large ? 29 : 22, lineHeight: 1.25, letterSpacing: "-.01em" }}>{step.overlay.title}</h2>
        <p id={descriptionId} style={{ display: suspended ? "none" : undefined, margin: large ? "12px 0 0" : "9px 0 0", color: "var(--tourkit-ink-2)", fontSize: large ? 18 : 15, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{step.overlay.body}</p>
        {!suspended && step.narration ? (
          <audio
            key={`${step.id}:${step.narration.src}:${step.narration.startMs}`}
            ref={audioRef}
            aria-label="Tutorial narration"
            controls
            autoPlay
            preload="auto"
            src={step.narration.src}
            onLoadedMetadata={(event) => {
              const audio = event.currentTarget;
              audio.currentTime = step.narration!.startMs / 1_000;
              void audio.play().catch(() => undefined);
            }}
            onTimeUpdate={(event) => {
              const audio = event.currentTarget;
              if (audio.currentTime * 1_000 < step.narration!.endMs) return;
              audio.pause();
              completeNarration();
            }}
            onEnded={completeNarration}
            onError={completeNarration}
            style={{ display: "block", width: "100%", height: 34, marginTop: 12 }}
          />
        ) : null}
        {statusMessage ? (
          <p id={statusId} data-testid="tutorial-status" style={{ margin: "12px 0 0", color: "var(--tourkit-ink-3)", fontSize: 12, lineHeight: 1.45 }}>
            {statusMessage}
          </p>
        ) : null}
        {suspensionReason === "context" && onRestoreView ? (
          <button type="button" data-testid="tutorial-return-to-view" onClick={() => void onRestoreView()} style={{ ...buttonStyle, marginTop: 10 }}>Return to this step’s view</button>
        ) : null}
        {suspensionReason === "anchor-out-of-view" ? (
          <button
            type="button"
            data-testid="tutorial-scroll-to-anchor"
            onClick={() => scrollAnchorIntoView()}
            style={{ ...buttonStyle, marginTop: 10, padding: "0 12px", gap: 6, fontSize: 13, fontWeight: 600 }}
          >
            <ArrowDownToLine size={15} />
            Bring it into view
          </button>
        ) : null}
        {!suspended && gateAdvance && hintOffered && step.check?.description ? (
          <p
            data-testid="tutorial-check-hint"
            style={{ margin: "14px 0 0", color: "var(--tourkit-ink)", fontSize: 12, fontWeight: 600, lineHeight: 1.45 }}
          >
            Done when {step.check.description}
          </p>
        ) : null}
        {!suspended && guided && blockedNonce > 0 ? (
          <p
            data-testid="tutorial-blocked-hint"
            role="status"
            style={{ margin: "14px 0 0", color: accent, fontSize: 12, fontWeight: 600, lineHeight: 1.45 }}
          >
            Only the highlighted control is active during this tour.
          </p>
        ) : null}
        {!suspended && mode === "autoplay" && autoplayDurationMs && autoplayProgressActive ? (
          <div style={{ marginTop: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, color: "var(--tourkit-ink-3)", fontSize: 10, fontWeight: 650 }}>
              <span>{playbackPaused ? "Auto-advance paused" : "Time to read"}</span>
              <span>{Math.max(1, Math.ceil(autoplayDurationMs / 1_000))}s</span>
            </div>
            <div
              data-testid="tutorial-read-progress"
              aria-label="Time before the tutorial continues"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              style={{ height: 4, borderRadius: 999, background: "var(--tourkit-track)", overflow: "hidden" }}
            >
              <div
                style={{
                  height: "100%",
                  width: 0,
                  background: accent,
                  animationName: "tourkit-read-progress",
                  animationDuration: `${autoplayDurationMs}ms`,
                  animationTimingFunction: "linear",
                  animationFillMode: "forwards",
                  animationPlayState: playbackPaused ? "paused" : "running",
                }}
              />
            </div>
          </div>
        ) : null}
        {suspended ? null : mode === "practice" ? (
          // Action steps advance when the outcome lands. Reading steps and
          // outcomes already present at entry wait for explicit Next. Back lets a learner
          // re-read an earlier step; a step reached that way is a revisit —
          // the workspace already holds its outcome, so it is not graded again
          // and Next carries on. The final step waits for Finish so the
          // learner can look at the result before the celebration.
          (stepIndex > 0 || revisiting || alreadyDone || step.completion === "continue" || readyToFinish) ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 12 }}>
              <button
                type="button"
                onClick={onPrevious}
                disabled={stepIndex === 0 || busy}
                aria-label="Previous tutorial step"
                style={{ ...buttonStyle, padding: "0 10px", gap: 4, fontSize: 13, opacity: stepIndex === 0 || busy ? 0.45 : 1 }}
              >
                <ChevronLeft size={16} />
                Back
              </button>
              {(readyToFinish || (stepIndex === stepCount - 1 && (revisiting || alreadyDone || step.completion === "continue"))) ? (
                <button
                  type="button"
                  onClick={onNext}
                  aria-label="Finish tutorial"
                  data-testid="tutorial-finish"
                  disabled={busy}
                  style={{ ...buttonStyle, minWidth: 96, padding: "0 14px", gap: 4, fontSize: 13, fontWeight: 600, borderColor: accent, background: accent, color: "white" }}
                >
                  Finish
                </button>
              ) : revisiting || alreadyDone || step.completion === "continue" ? (
                <button
                  type="button"
                  onClick={onNext}
                  aria-label="Next tutorial step"
                  disabled={busy}
                  style={{ ...buttonStyle, minWidth: 76, padding: "0 12px", gap: 4, fontSize: 13, fontWeight: 600, borderColor: accent, background: accent, color: "white" }}
                >
                  Next
                  <ChevronRight size={16} />
                </button>
              ) : null}
            </div>
          ) : null
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 10 }}>
            <button type="button" onClick={onPrevious} disabled={stepIndex === 0 || busy || suspended} aria-label="Previous tutorial step" style={{ ...buttonStyle, opacity: stepIndex === 0 || busy || suspended ? 0.45 : 1 }}>
              <ChevronLeft size={18} />
            </button>
            <button type="button" onClick={onTogglePause} disabled={busy || suspended || Boolean(error)} aria-label={paused ? "Resume tutorial" : "Pause tutorial"} style={{ ...buttonStyle, minWidth: 92, gap: 6, opacity: busy || suspended || error ? 0.45 : 1 }}>
              {paused ? <Play size={16} fill="currentColor" /> : <Pause size={16} fill="currentColor" />}
              {paused ? "Resume" : "Pause"}
            </button>
            <button type="button" onClick={onNext} disabled={busy || suspended} aria-label={stepIndex === stepCount - 1 ? "Finish tutorial" : "Next tutorial step"} style={{ ...buttonStyle, minWidth: 76, gap: 4, borderColor: accent, background: accent, color: "white", opacity: busy || suspended ? 0.45 : 1 }}>
              {stepIndex === stepCount - 1 ? "Finish" : "Next"}
              {stepIndex < stepCount - 1 ? <ChevronRight size={18} /> : null}
            </button>
          </div>
        )}
      </section>
    </div>,
    document.body,
  );
}


