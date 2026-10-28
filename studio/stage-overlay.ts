import {placeCardOutsideFocus} from "../player/focus-card-placement";
import {tutorialArrow} from "../player/arrow-placement";
import {paddedBox} from "../player/spotlight";
import type { TutorialFocusHighlight } from "../core/schema";
import { drawFocusHighlights, focusAnnotationAvoidRects, resolveFocusHighlights } from "../player/focus-highlights";
import { findTutorialAnchor } from "../player/anchor";

/**
 * Authoring overlay drawn inside the (same-origin) fixture frame: numbered
 * markers on every step's control, a ring around the focused step's control,
 * and optionally the instruction card with its pointer arrow, positioned the
 * way the player would. It is inert (pointer-events: none) and lives in one
 * container element, so it never touches the fixture's own DOM or styles.
 */
export interface StageOverlayStep {
  highlights?: TutorialFocusHighlight[];
  index: number;
  title: string;
  body: string;
  anchorId?: string;
  targetId?: string;
  focused: boolean;
  /** Effective card layout for this step (manifest default + step override). */
  pointer: boolean;
}

export interface StageOverlayOptions {
  /** Ring the focused step's control and label it. */
  highlight: boolean;
  /** Keep a numbered marker on every step's control. */
  markers: boolean;
  /** Show the focused step's card beside its control, with the arrow when the step draws one. */
  card: boolean;
}

export const DEFAULT_STAGE_OVERLAY_OPTIONS: StageOverlayOptions = { highlight: true, markers: true, card: false };

const CONTAINER_ID = "tourkit-stage-overlay";
const RING = "#f59e0b";
const CARD_WIDTH = 280;

function frameDocument(iframe: HTMLIFrameElement | null): Document | null {
  try {
    return iframe?.contentDocument ?? null;
  } catch {
    return null;
  }
}

function findControl(doc: Document, id: string | undefined): HTMLElement | null {
  if (!id) return null;
  return findTutorialAnchor(doc, id);
}

function container(doc: Document): HTMLElement {
  let element = doc.getElementById(CONTAINER_ID);
  if (!element) {
    element = doc.createElement("div");
    element.id = CONTAINER_ID;
    element.setAttribute("aria-hidden", "true");
    element.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483000;font-family:ui-sans-serif,system-ui,sans-serif;";
    doc.body.append(element);
  }
  return element;
}

export function clearStageOverlay(iframe: HTMLIFrameElement | null): void {
  frameDocument(iframe)?.getElementById(CONTAINER_ID)?.remove();
}

/** Redraws the overlay from scratch; cheap enough to run on an interval. */
export function syncStageOverlay(
  iframe: HTMLIFrameElement | null,
  steps: readonly StageOverlayStep[],
  options: StageOverlayOptions,
): { markers: number; focusedFound: boolean } {
  const doc = frameDocument(iframe);
  if (!doc?.body) return { markers: 0, focusedFound: false };
  if (!options.highlight && !options.markers && !options.card) {
    doc.getElementById(CONTAINER_ID)?.remove();
    return { markers: 0, focusedFound: false };
  }
  const root = container(doc);
  root.replaceChildren();
  let markers = 0;
  let focusedFound = false;

  if (options.markers) {
    // One badge per control; several steps on the same control stack their numbers.
    const byControl = new Map<HTMLElement, StageOverlayStep[]>();
    for (const step of steps) {
      const control = findControl(doc, step.targetId ?? step.anchorId);
      if (!control) continue;
      byControl.set(control, [...(byControl.get(control) ?? []), step]);
    }
    for (const [control, group] of byControl) {
      const rect = control.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      const badge = doc.createElement("div");
      badge.dataset.studioMarker = group.map((step) => step.index + 1).join(",");
      const focused = group.some((step) => step.focused);
      badge.textContent = group.map((step) => step.index + 1).join("·");
      badge.style.cssText =
        `position:fixed;left:${Math.max(0, rect.left - 9)}px;top:${Math.max(0, rect.top - 9)}px;` +
        "min-width:18px;height:18px;padding:0 5px;border-radius:9px;font-size:11px;font-weight:700;line-height:18px;text-align:center;" +
        `color:#fff;background:${focused ? RING : "#0f172a"};box-shadow:0 1px 3px rgba(0,0,0,.4);`;
      root.append(badge);
      markers += 1;
    }
  }

  const focused = steps.find((step) => step.focused);
  if (focused && options.highlight) {
    focusedFound = drawFocusHighlights(doc, root, focused.highlights) > 0;
  }
  if (focused && (options.highlight || options.card)) {
    const anchor = findControl(doc, focused.anchorId);
    const target = findControl(doc, focused.targetId) ?? anchor;
    if (target) {
      focusedFound = true;
      const rect = target.getBoundingClientRect();
      if (options.highlight) {
        if (anchor && anchor !== target) {
          const region = anchor.getBoundingClientRect();
          const box = doc.createElement("div");
          box.dataset.studioRegion = "";
          box.style.cssText =
            `position:fixed;left:${region.left - 4}px;top:${region.top - 4}px;width:${region.width + 8}px;height:${region.height + 8}px;` +
            `border:2px dashed ${RING};border-radius:8px;opacity:.7;`;
          root.append(box);
        }
        const ring = doc.createElement("div");
        ring.dataset.studioRing = "";
        ring.style.cssText =
          `position:fixed;left:${rect.left - 4}px;top:${rect.top - 4}px;width:${rect.width + 8}px;height:${rect.height + 8}px;` +
          `border:3px solid ${RING};border-radius:8px;box-shadow:0 0 0 4px rgba(245,158,11,.25);`;
        root.append(ring);
        const label = doc.createElement("div");
        label.textContent = `Step ${focused.index + 1} · ${focused.targetId ?? focused.anchorId ?? ""}`;
        label.style.cssText =
          `position:fixed;left:${rect.left - 4}px;top:${Math.max(0, rect.top - 26)}px;padding:2px 6px;border-radius:4px;` +
          `font-size:11px;font-weight:600;color:#1f2937;background:${RING};white-space:nowrap;`;
        root.append(label);
      }
      if (options.card) {
        const view = { width: doc.documentElement.clientWidth, height: doc.documentElement.clientHeight };
        const below = rect.bottom + 12;
        const fitsBelow = below + 120 < view.height;
        const cardTop = fitsBelow ? below : Math.max(8, rect.top - 12 - 120);
        const cardLeft = Math.min(Math.max(8, rect.left), Math.max(8, view.width - CARD_WIDTH - 8));
        const card = doc.createElement("div");
        card.dataset.studioCard = "";
        card.style.cssText =
          `position:fixed;left:${cardLeft}px;top:${cardTop}px;width:${CARD_WIDTH}px;padding:12px 14px;border-radius:12px;` +
          "background:#fff;color:#0f172a;box-shadow:0 12px 32px rgba(15,23,42,.28);border:1px solid rgba(15,23,42,.12);";
        const heading = doc.createElement("div");
        heading.textContent = focused.title || "Tutorial step";
        heading.style.cssText = "font-size:14px;font-weight:700;margin-bottom:4px;";
        const body = doc.createElement("div");
        body.textContent = focused.body || "";
        body.style.cssText = "font-size:12px;line-height:1.5;color:#334155;max-height:72px;overflow:hidden;";
        card.append(heading, body);
        root.append(card);
        if(focused.highlights?.length){
          const placement=placeCardOutsideFocus(card.getBoundingClientRect(),view,focusAnnotationAvoidRects(resolveFocusHighlights(doc,focused.highlights)),[paddedBox(rect,8)]);
          if(placement){card.style.left=`${placement.left}px`;card.style.top=`${placement.top}px`}
        }
        if (focused.pointer) {
          // Arrow from the card's near edge to the control's near edge.
          const cardRect = focused.highlights?.length?card.getBoundingClientRect():{ left: cardLeft, top: cardTop, right: cardLeft + CARD_WIDTH, bottom: cardTop + 120 };
          const authoredArrow=focused.highlights?.length?tutorialArrow(cardRect,rect,view):null;
          const from = authoredArrow?.start??(fitsBelow
            ? { x: Math.min(Math.max(rect.left + rect.width / 2, cardRect.left + 16), cardRect.right - 16), y: cardRect.top }
            : { x: Math.min(Math.max(rect.left + rect.width / 2, cardRect.left + 16), cardRect.right - 16), y: cardRect.bottom });
          const to = authoredArrow?.end??(fitsBelow
            ? { x: rect.left + rect.width / 2, y: rect.bottom + 4 }
            : { x: rect.left + rect.width / 2, y: rect.top - 4 });
          const svgNs = "http://www.w3.org/2000/svg";
          const svg = doc.createElementNS(svgNs, "svg");
          svg.setAttribute("data-studio-arrow", "");
          svg.setAttribute("width", String(view.width));
          svg.setAttribute("height", String(view.height));
          svg.style.cssText = "position:fixed;left:0;top:0;overflow:visible;";
          const defs = doc.createElementNS(svgNs, "defs");
          const marker = doc.createElementNS(svgNs, "marker");
          marker.setAttribute("id", "tourkit-arrowhead");
          marker.setAttribute("markerWidth", "8");
          marker.setAttribute("markerHeight", "8");
          marker.setAttribute("refX", "6");
          marker.setAttribute("refY", "4");
          marker.setAttribute("orient", "auto");
          const head = doc.createElementNS(svgNs, "path");
          head.setAttribute("d", "M0,0 L8,4 L0,8 z");
          head.setAttribute("fill", RING);
          marker.append(head);
          defs.append(marker);
          const line = doc.createElementNS(svgNs, "line");
          line.setAttribute("x1", String(from.x));
          line.setAttribute("y1", String(from.y));
          line.setAttribute("x2", String(to.x));
          line.setAttribute("y2", String(to.y));
          line.setAttribute("stroke", RING);
          line.setAttribute("stroke-width", "3");
          line.setAttribute("stroke-linecap", "round");
          line.setAttribute("marker-end", "url(#tourkit-arrowhead)");
          svg.append(defs, line);
          root.append(svg);
        }
      }
    }
  }
  return { markers, focusedFound };
}

const OPTIONS_KEY = "tourkit:studio-overlay";

export function readStageOverlayOptions(): StageOverlayOptions {
  if (typeof window === "undefined") return DEFAULT_STAGE_OVERLAY_OPTIONS;
  try {
    const stored = window.localStorage.getItem(OPTIONS_KEY);
    if (!stored) return DEFAULT_STAGE_OVERLAY_OPTIONS;
    const parsed = JSON.parse(stored) as Partial<StageOverlayOptions>;
    return {
      highlight: parsed.highlight ?? DEFAULT_STAGE_OVERLAY_OPTIONS.highlight,
      markers: parsed.markers ?? DEFAULT_STAGE_OVERLAY_OPTIONS.markers,
      card: parsed.card ?? DEFAULT_STAGE_OVERLAY_OPTIONS.card,
    };
  } catch {
    return DEFAULT_STAGE_OVERLAY_OPTIONS;
  }
}

export function writeStageOverlayOptions(options: StageOverlayOptions): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(OPTIONS_KEY, JSON.stringify(options));
  } catch {
    // Storage may be unavailable; the options simply reset next time.
  }
}

