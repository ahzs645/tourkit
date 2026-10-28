"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import clsx from "clsx";
import { MessageSquarePlus, MousePointer2, PenLine, StickyNote, X } from "lucide-react";

import { Button } from "../ui/button";
import { CONTROL_FOCUS } from "../ui/control-styles";
import {
  anchorAtPoint,
  locateAnchor,
  nearestAnchor,
  visibleAnchors,
  REVIEW_OVERLAY_ATTRIBUTE,
  type AnchorHit,
} from "./dom";
import {
  LEGACY_REVIEW_MESSAGE_BUNDLE,
  LEGACY_REVIEW_MESSAGE_READY,
  REVIEW_HANDOFF_PARAM,
  REVIEW_HANDOFF_VALUE,
  REVIEW_MESSAGE_BUNDLE,
  REVIEW_MESSAGE_READY,
  REVIEW_START_VALUE,
} from "./html";
import {
  addReviewItem,
  addReviewReply,
  createReviewBundle,
  currentRound,
  deleteReviewItem,
  hasPerson,
  liveItems,
  parseReviewBundle,
  putReviewSnapshot,
  REVIEW_COLORS,
  reviewItemNumbers,
  setRoundReviewer,
  updateReviewItem,
  type ReviewAnchor,
  type ReviewFeedbackBundle,
  type ReviewItem,
  type ReviewPerson,
} from "./model";
import type { ReviewSurface } from "./surfaces";
import { ReviewFeedbackPanel } from "./ReviewFeedbackPanel";
import { ReviewItemCard } from "./ReviewItemCard";
import { ReviewIdentityDialog, ReviewLoadedDialog } from "./ReviewDialogs";
import { drawingPath } from "./review-storage";
import { useReviewEnvironment } from "./environment";

/**
 * Feedback mode over a host-defined surface; the `surface` supplies its identity,
 * anchors, parts and current page. The reviewer keeps using
 * it (filling in answers, clicking through) and switches tools to pin a
 * comment to an element, place a sticky note, or draw. Each item is anchored
 * to an element, so it shows only while that element is on screen: paging,
 * collapsible sections, show-when rules and tutorial steps all carry the
 * feedback with them.
 */

type Tool = "interact" | "comment" | "sticky" | "draw" | "attach";
type Box = { x: number; y: number; w: number; h: number };
/** Layers that must never take the pointer, even where a page forces `pointer-events: auto` on descendants. */
const NO_POINTER = { pointerEvents: "none" } as const;
/** Longest a page picture may take before an export goes ahead without it. */
const CAPTURE_TIMEOUT_MS = 15_000;
/** Tools that pick a field: they outline what can be picked and what the pointer is on. */
const PICKING: ReadonlySet<Tool> = new Set(["comment", "sticky", "attach"]);

export interface ReviewFeedbackLayerProps {
  /** What is being reviewed (components/review-feedback/surfaces.ts). */
  surface: ReviewSurface;
  /**
   * Cover the whole window and review the whole page (a tutorial running in
   * the workspace or an emulator) instead of wrapping `children`.
   */
  fullscreen?: boolean;
  /** Show the "Give feedback" button; review links open in feedback mode either way. */
  offerFeedback?: boolean;
  children?: ReactNode;
}

function toolsFor(kind: ReviewSurface["kind"]): Array<{ id: Tool; label: string; icon: typeof MousePointer2; hint: string }> {
  const thing = kind === "form" ? "field" : "control";
  return [
    { id: "interact", label: kind === "form" ? "Use form" : kind === "tutorial" ? "Use tutorial" : "Use screen", icon: MousePointer2, hint: kind === "form" ? "Fill in and click the form as usual" : "Click through as usual" },
    { id: "comment", label: "Comment", icon: MessageSquarePlus, hint: `Point at a ${thing} (it is outlined with its name), then click to pin a comment to it` },
    { id: "sticky", label: "Note", icon: StickyNote, hint: `Point at a ${thing}, then click to stick a note on it` },
    { id: "draw", label: "Draw", icon: PenLine, hint: `Drag to draw; the drawing follows the nearest ${thing}` },
  ];
}

export function ReviewFeedbackLayer(props: ReviewFeedbackLayerProps) {
  const { storage } = useReviewEnvironment();
  return <ReviewFeedbackSession key={storage.reviewKey(props.surface)} {...props} />;
}

function ReviewFeedbackSession({ surface, fullscreen = false, offerFeedback = true, children }: ReviewFeedbackLayerProps) {
  const { storage, labels } = useReviewEnvironment();
  const { readStoredPerson, readStoredReview, storePerson, storeReview } = storage;
  const rootRef = useRef<HTMLDivElement>(null);
  /** Where pins are looked for: the wrapped preview, or the whole page. */
  const scopeOf = useCallback((root: HTMLElement) => (fullscreen ? root.ownerDocument.body : root), [fullscreen]);
  /** An anchor's box now; an item on nothing sits on the layer itself. */
  const locate = useCallback((root: HTMLElement, anchor: ReviewAnchor) =>
    anchor.attribute ? locateAnchor(scopeOf(root), anchor) : root.getBoundingClientRect(), [scopeOf]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { name: formName, target, parts: fields, shareUrl, anchorAttributes } = surface;
  const storageKey = storage.reviewKey(surface);
  const fieldById = useMemo(() => new Map(fields.map((field) => [field.id, field])), [fields]);
  const tools = useMemo(() => toolsFor(surface.kind), [surface.kind]);

  // A review link (`#review=start`) opens straight into feedback mode.
  const [reviewLink] = useState(() => typeof window !== "undefined" &&
    new URLSearchParams(window.location.hash.replace(/^#/, "")).get(REVIEW_HANDOFF_PARAM) === REVIEW_START_VALUE);
  const [enabled, setEnabled] = useState(reviewLink);
  // This viewer's review in progress and their name come back on reload (per-browser
  // conveniences; the share page keys this layer per form, so these read once per form).
  const [bundle, setBundle] = useState<ReviewFeedbackBundle | null>(() => readStoredReview(storageKey));
  const [tool, setTool] = useState<Tool>("interact");
  const [color, setColor] = useState<string>(REVIEW_COLORS[0]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [me, setMe] = useState<ReviewPerson>(readStoredPerson);
  const [identityOpen, setIdentityOpen] = useState(() => reviewLink && !hasPerson(readStoredPerson()) && !readStoredReview(storageKey));
  const [loaded, setLoaded] = useState<{ bundle: ReviewFeedbackBundle; mismatch: boolean } | null>(null);
  const [drawing, setDrawing] = useState<{ start: [number, number]; local: [number, number]; points: Array<[number, number]> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * Where each item sits now and the box of the field it is tied to, measured
   * from the preview after every change, scroll or re-layout; while a picking
   * tool is on, also every field that can be picked.
   */
  const [layout, setLayout] = useState<{ width: number; height: number; positions: Map<string, [number, number]>; anchors: Map<string, Box>; pickable: Box[] } | null>(null);
  /** The field under the pointer while picking. */
  const [hover, setHover] = useState<(Box & { label: string; near: boolean }) | null>(null);
  /** The item being tied to another field ("Attach to another field"). */
  const [attachingId, setAttachingId] = useState<string | null>(null);

  useEffect(() => {
    if (bundle) storeReview(storageKey, bundle);
  }, [bundle, storageKey, storeReview]);

  const ensureBundle = useCallback((current: ReviewFeedbackBundle | null) =>
    current ?? createReviewBundle({ kind: surface.kind, subjectId: surface.subjectId, formName, target, shareUrl, fields, reviewer: me }), [fields, formName, me, shareUrl, surface.kind, surface.subjectId, target]);

  // "Continue this review" from a feedback HTML: the opener hands the bundle over.
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    if (hash.get(REVIEW_HANDOFF_PARAM) !== REVIEW_HANDOFF_VALUE || !window.opener) return;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.opener || (event.data?.type !== REVIEW_MESSAGE_BUNDLE && event.data?.type !== LEGACY_REVIEW_MESSAGE_BUNDLE)) return;
      try {
        const incoming = parseReviewBundle(event.data.bundle);
        setEnabled(true);
        setLoaded({ bundle: incoming, mismatch: incoming.form.kind !== surface.kind || incoming.form.name !== formName || incoming.form.id !== surface.subjectId });
      } catch (handoffError) {
        setError(handoffError instanceof Error ? handoffError.message : "The review could not be opened.");
      }
    };
    window.addEventListener("message", onMessage);
    window.opener.postMessage({ type: REVIEW_MESSAGE_READY }, "*");
    // A page saved before the rename only answers the old name.
    window.opener.postMessage({ type: LEGACY_REVIEW_MESSAGE_READY }, "*");
    return () => window.removeEventListener("message", onMessage);
  }, [formName, surface.kind, surface.subjectId]);

  // Re-place items whenever they change, or the preview scrolls, resizes or re-renders.
  const picking = PICKING.has(tool);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!enabled || !root) return;
    let frame = 0;
    const measure = () => {
      const rect = root.getBoundingClientRect();
      const positions = new Map<string, [number, number]>();
      const anchors = new Map<string, Box>();
      for (const item of bundle ? liveItems(bundle) : []) {
        if (surface.showsItem && !surface.showsItem(item)) continue;
        const anchor = locate(root, item.anchor);
        if (!anchor) continue;
        positions.set(item.id, [anchor.left - rect.left + item.anchor.dx, anchor.top - rect.top + item.anchor.dy]);
        if (item.anchor.attribute) anchors.set(item.id, { x: anchor.left - rect.left, y: anchor.top - rect.top, w: anchor.width, h: anchor.height });
      }
      const seen = new Set<string>();
      const pickable = picking
        ? visibleAnchors(scopeOf(root), anchorAttributes).flatMap((hit) => {
            const box = { x: hit.rect.left - rect.left, y: hit.rect.top - rect.top, w: hit.rect.width, h: hit.rect.height };
            const key = [box.x, box.y, box.w, box.h].map(Math.round).join(",");
            // Skip duplicates (a wrapper and its control) and whole-page containers.
            if (seen.has(key) || box.w < 4 || box.h < 4 || box.w * box.h > rect.width * rect.height * 0.5) return [];
            seen.add(key);
            return [box];
          })
        : [];
      setLayout({ width: rect.width, height: rect.height, positions, anchors, pickable });
    };
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; measure(); });
    };
    measure();
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    const observer = new MutationObserver(schedule);
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden", "aria-hidden"] });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      observer.disconnect();
    };
    // The surface's view key (a tutorial's step) re-measures when the view changes without the DOM saying so.
  }, [anchorAttributes, bundle, enabled, locate, picking, scopeOf, surface, surface.viewKey]);

  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setTool("interact"); setSelectedId(null); setAttachingId(null); setHover(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);

  /** The anchor and page for an item made at a point on `hit` (or on nothing). */
  const describe = useCallback((hit: AnchorHit | null, clientX: number, clientY: number): { anchor: ReviewAnchor; page: string } => {
    const root = rootRef.current!;
    const place = surface.place(hit ? { attribute: hit.attribute, value: hit.value, element: hit.element } : null);
    if (!hit) {
      const rect = root.getBoundingClientRect();
      return { anchor: { attribute: null, value: null, fieldId: place.partId, fieldLabel: place.label, dx: clientX - rect.left, dy: clientY - rect.top }, page: place.page };
    }
    return {
      anchor: { attribute: hit.attribute, value: hit.value, fieldId: place.partId, fieldLabel: place.label, dx: clientX - hit.rect.left, dy: clientY - hit.rect.top },
      page: place.page,
    };
  }, [surface]);
  const author = hasPerson(me) ? me : undefined;

  // A snapshot of what the reviewer sees, for the HTML and PDF exports.
  const captureTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const capture = useCallback(async (current: ReviewFeedbackBundle, page: string) => {
    const root = rootRef.current;
    if (!root) return current;
    try {
      const { default: html2canvas } = await import("html2canvas-pro");
      const rootRect = root.getBoundingClientRect();
      const placements: Record<string, [number, number]> = {};
      for (const item of liveItems(current)) {
        if (surface.showsItem && !surface.showsItem(item)) continue;
        const rect = locate(root, item.anchor);
        if (rect) placements[item.id] = [rect.left - rootRect.left, rect.top - rootRect.top];
      }
      const view = root.ownerDocument.defaultView!;
      let timer: ReturnType<typeof setTimeout> | undefined;
      // A heavy page (the whole builder behind a tutorial) can take too long to
      // picture; the review is still complete without it.
      const canvas = await Promise.race([
        html2canvas(fullscreen ? root.ownerDocument.body : root, {
          backgroundColor: "#ffffff",
          scale: 1,
          logging: false,
          imageTimeout: 3_000,
          ignoreElements: (element) => element.hasAttribute?.(REVIEW_OVERLAY_ATTRIBUTE) ?? false,
          // The whole page is reviewed: capture what the window shows.
          ...(fullscreen ? { x: view.scrollX, y: view.scrollY, width: view.innerWidth, height: view.innerHeight, windowWidth: view.innerWidth, windowHeight: view.innerHeight } : {}),
        }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Snapshot timed out")), CAPTURE_TIMEOUT_MS); }),
      ]).finally(() => clearTimeout(timer));
      return putReviewSnapshot(current, {
        page,
        round: currentRound(current).number,
        image: canvas.toDataURL("image/jpeg", 0.8),
        width: canvas.width,
        height: canvas.height,
        capturedAt: new Date().toISOString(),
        placements,
      });
    } catch {
      return current;
    }
  }, [fullscreen, locate, surface]);
  const bundleRef = useRef(bundle);
  useEffect(() => { bundleRef.current = bundle; }, [bundle]);
  const scheduleCapture = useCallback((page: string) => {
    if (captureTimer.current) clearTimeout(captureTimer.current);
    captureTimer.current = setTimeout(() => {
      const current = bundleRef.current;
      if (!current) return;
      void capture(current, page).then((next) => {
        if (next === current) return;
        // Keep edits made while the capture ran; take only the new snapshot.
        setBundle((latest) => (latest ? { ...latest, snapshots: next.snapshots } : latest));
      });
    }, 1500);
  }, [capture]);
  useEffect(() => () => { if (captureTimer.current) clearTimeout(captureTimer.current); }, []);

  const commit = (item: Parameters<typeof addReviewItem>[1]) => {
    const result = addReviewItem(ensureBundle(bundle), item);
    setBundle(result.bundle);
    setSelectedId(item.kind === "drawing" ? null : result.item.id);
    scheduleCapture(item.page);
    return result.item;
  };

  /** The field the pointer is on, else the nearest one (and whether it was only near). */
  const pickAt = (root: HTMLElement, clientX: number, clientY: number) => {
    const scope = scopeOf(root);
    const on = anchorAtPoint(scope, clientX, clientY, anchorAttributes);
    if (on) return { hit: on, near: false };
    const near = nearestAnchor(scope, clientX, clientY, tool === "comment" ? 120 : 480, anchorAttributes);
    return { hit: near, near: Boolean(near) };
  };

  /** Tie an existing item to another field, keeping notes and drawings where they are on screen. */
  const reattach = (root: HTMLElement, itemId: string, clientX: number, clientY: number) => {
    const item = bundle?.items.find((entry) => entry.id === itemId);
    const { hit } = pickAt(root, clientX, clientY);
    if (!item || !hit) return;
    const { anchor, page } = describe(hit, clientX, clientY);
    const position = layout?.positions.get(item.id);
    if (item.kind !== "comment" && position) {
      const rootRect = root.getBoundingClientRect();
      anchor.dx = position[0] - (hit.rect.left - rootRect.left);
      anchor.dy = position[1] - (hit.rect.top - rootRect.top);
    }
    update(item.id, { anchor, page });
    setSelectedId(item.id);
  };

  const onSurfaceDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const root = rootRef.current;
    if (!root || tool === "interact") return;
    if (tool === "attach") {
      event.preventDefault();
      if (attachingId) reattach(root, attachingId, event.clientX, event.clientY);
      setAttachingId(null);
      setHover(null);
      setTool("interact");
      return;
    }
    event.preventDefault();
    if (tool === "draw") {
      event.currentTarget.setPointerCapture(event.pointerId);
      const rect = root.getBoundingClientRect();
      setDrawing({ start: [event.clientX, event.clientY], local: [event.clientX - rect.left, event.clientY - rect.top], points: [[0, 0]] });
      return;
    }
    const { hit } = pickAt(root, event.clientX, event.clientY);
    const { anchor, page } = describe(hit, event.clientX, event.clientY);
    commit({ kind: tool === "comment" ? "comment" : "sticky", anchor, page, text: "", color, author });
    setHover(null);
    setTool("interact");
  };
  const onSurfaceMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const root = rootRef.current;
    if (root && picking) {
      const { hit, near } = pickAt(root, event.clientX, event.clientY);
      if (!hit) { setHover(null); return; }
      const rect = root.getBoundingClientRect();
      const label = describe(hit, event.clientX, event.clientY).anchor.fieldLabel || "this part of the page";
      setHover({ x: hit.rect.left - rect.left, y: hit.rect.top - rect.top, w: hit.rect.width, h: hit.rect.height, label, near });
      return;
    }
    if (!drawing) return;
    const point: [number, number] = [event.clientX - drawing.start[0], event.clientY - drawing.start[1]];
    const last = drawing.points[drawing.points.length - 1];
    if (Math.hypot(point[0] - last[0], point[1] - last[1]) < 2) return;
    setDrawing({ ...drawing, points: [...drawing.points, point] });
  };
  const onSurfaceLeave = () => setHover(null);
  const onSurfaceUp = () => {
    const root = rootRef.current;
    if (!drawing || !root) return;
    setDrawing(null);
    if (drawing.points.length < 2) return;
    const [x, y] = drawing.start;
    const { anchor, page } = describe(nearestAnchor(scopeOf(root), x, y, 480, anchorAttributes), x, y);
    commit({ kind: "drawing", anchor, page, text: "", color, points: drawing.points, author });
  };

  const openFile = async (file: File) => {
    try {
      const { readReviewFeedbackFile } = await import("./files");
      const incoming = await readReviewFeedbackFile(file);
      setLoaded({ bundle: incoming, mismatch: incoming.form.kind !== surface.kind || incoming.form.name !== formName || incoming.form.id !== surface.subjectId });
      setError(null);
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "The file could not be opened.");
    }
  };

  const enable = () => {
    setEnabled(true);
    setBundle((current) => ensureBundle(current));
    if (!hasPerson(me) && !readStoredReview(storageKey)) setIdentityOpen(true);
  };

  const numbers = bundle ? reviewItemNumbers(bundle) : new Map<string, string>();
  const round = bundle ? currentRound(bundle).number : 1;
  const placed = enabled && bundle && layout
    ? liveItems(bundle).flatMap((item) => {
        const position = layout.positions.get(item.id);
        return position ? [{ item, x: position[0], y: position[1] }] : [];
      })
    : [];
  const selected = placed.find((entry) => entry.item.id === selectedId) ?? null;
  const update = (id: string, patch: Parameters<typeof updateReviewItem>[2]) => {
    setBundle((current) => (current ? updateReviewItem(current, id, patch) : current));
    const item = bundle?.items.find((entry) => entry.id === id);
    if (item) scheduleCapture(item.page);
  };

  return (
    <>
    {fullscreen ? children : null}
    {/* data-tutorial-surface: a running tutorial lets input through to the feedback tools. */}
    {/* Inline pointer-events: a running tutorial forces `.driver-active * { pointer-events: auto }`. */}
    <div ref={rootRef} className={fullscreen ? "fixed inset-0 z-[8100]" : "relative h-full w-full"} style={fullscreen ? NO_POINTER : undefined} data-review-root="" data-tutorial-surface="">
      {fullscreen ? null : children}
      {enabled ? (
        <div {...{ [REVIEW_OVERLAY_ATTRIBUTE]: "" }} className="absolute inset-0 z-[60] overflow-hidden" style={NO_POINTER}>
          {tool !== "interact" ? (
            <div
              className={clsx("pointer-events-auto absolute inset-0", tool === "draw" ? "cursor-crosshair" : "cursor-cell")}
              onPointerDown={onSurfaceDown}
              onPointerMove={onSurfaceMove}
              onPointerUp={onSurfaceUp}
              onPointerLeave={onSurfaceLeave}
              data-testid="review-capture-surface"
            />
          ) : null}
          {picking && layout ? layout.pickable.map((box, index) => (
            <div key={index} aria-hidden="true" className="absolute rounded-[3px] border border-dashed border-sky-400/60" style={{ ...NO_POINTER, left: box.x - 2, top: box.y - 2, width: box.w + 4, height: box.h + 4 }} />
          )) : null}
          {picking && hover ? (
            <div aria-hidden="true" data-testid="review-pick-box" className={clsx("absolute rounded-[4px] border-2", hover.near ? "border-dashed border-sky-500 bg-sky-500/5" : "border-sky-500 bg-sky-500/10")} style={{ ...NO_POINTER, left: hover.x - 3, top: hover.y - 3, width: hover.w + 6, height: hover.h + 6 }}>
              <span className="absolute -top-6 left-0 max-w-[320px] truncate rounded-md bg-sky-600 px-1.5 py-0.5 text-[11px] font-medium text-white shadow">
                {tool === "comment" ? "Comment on" : tool === "sticky" ? "Note on" : "Attach to"} “{hover.label}”{hover.near ? " (nearest)" : ""}
              </span>
            </div>
          ) : null}
          {selectedId && !picking && layout?.anchors.get(selectedId) ? (() => {
            const box = layout.anchors.get(selectedId)!;
            return <div aria-hidden="true" data-testid="review-tied-box" className="absolute rounded-[4px] border-2 border-dashed border-sky-500" style={{ ...NO_POINTER, left: box.x - 3, top: box.y - 3, width: box.w + 6, height: box.h + 6 }} />;
          })() : null}
          <svg className="absolute inset-0 h-full w-full overflow-visible" style={NO_POINTER}>
            {placed.filter(({ item }) => item.kind === "drawing" && item.points?.length).map(({ item, x, y }) => (
              <path
                key={item.id}
                d={drawingPath(item.points!, x, y)}
                fill="none"
                stroke={item.color}
                strokeWidth={item.id === selectedId ? 5 : 3}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={item.round === round ? 1 : 0.55}
                className="cursor-pointer"
                style={{ pointerEvents: tool === "interact" ? "visibleStroke" : "none" }}
                onClick={() => setSelectedId(item.id)}
              />
            ))}
            {drawing ? (
              <path d={drawingPath(drawing.points, drawing.local[0], drawing.local[1])} fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
            ) : null}
          </svg>
          {placed.filter(({ item }) => item.kind !== "drawing").map(({ item, x, y }) => (
            item.kind === "sticky" ? (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedId(item.id)}
                className={clsx("pointer-events-auto absolute w-40 rounded-sm border border-amber-500 bg-amber-200 p-1.5 text-left text-[11px] leading-snug text-amber-950 shadow-md", item.round !== round && "opacity-70", item.id === selectedId && "ring-2 ring-sky-500", CONTROL_FOCUS)}
                style={{ left: x, top: y }}
                data-review-item={item.id}
              >
                <span className="font-semibold">{numbers.get(item.id)} </span>
                {item.text || <span className="italic opacity-70">Empty note</span>}
              </button>
            ) : (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedId(item.id)}
                aria-label={`Comment ${numbers.get(item.id)}${item.anchor.fieldLabel ? ` on ${item.anchor.fieldLabel}` : ""}`}
                className={clsx("pointer-events-auto absolute flex h-6 min-w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white px-1 text-[10px] font-bold text-white shadow-md", item.status === "resolved" && "opacity-50", item.round !== round && "opacity-75", item.id === selectedId && "ring-2 ring-sky-500", CONTROL_FOCUS)}
                style={{ left: x, top: y, background: item.color }}
                data-review-item={item.id}
              >
                {numbers.get(item.id)}
              </button>
            )
          ))}

        </div>
      ) : null}

          {selected && bundle && !panelOpen ? (
            <div {...{ [REVIEW_OVERLAY_ATTRIBUTE]: "" }} className="absolute inset-0 z-[80]" style={NO_POINTER}>
            <ReviewItemCard
              key={selected.item.id}
              item={selected.item}
              number={numbers.get(selected.item.id) ?? ""}
              x={selected.x}
              y={selected.y}
              bounds={layout}
              currentRound={round}
              author={author}
              partLabel={labels(surface.kind).one}
              onChange={(patch) => update(selected.item.id, patch)}
              onReply={(text) => setBundle((current) => (current ? addReplyTo(current, selected.item, text, author) : current))}
              onDelete={() => { setBundle((current) => (current ? deleteReviewItem(current, selected.item.id) : current)); setSelectedId(null); }}
              onReattach={() => { setAttachingId(selected.item.id); setTool("attach"); }}
              onClose={() => setSelectedId(null)}
            />
            </div>
          ) : null}

      {/* Toolbar: on top of the preview, outside the snapshot. */}
      <div {...{ [REVIEW_OVERLAY_ATTRIBUTE]: "" }} className="absolute inset-x-0 bottom-3 z-[70] flex justify-center px-4" style={NO_POINTER}>
        {enabled ? (
          tool === "attach" ? (
            <div className="pointer-events-auto flex items-center gap-2 rounded-xl border border-sky-300 bg-white/95 px-3 py-2 text-sm shadow-lg dark:border-sky-700 dark:bg-slate-900/95" role="status">
              Click the {labels(surface.kind).one} this belongs to.
              <Button size="sm" variant="ghost" onClick={() => { setTool("interact"); setAttachingId(null); setHover(null); }}>Cancel</Button>
            </div>
          ) : (
          <div className="pointer-events-auto flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-white/95 p-1.5 shadow-lg backdrop-blur-sm dark:border-slate-700 dark:bg-slate-900/95" role="toolbar" aria-label="Feedback tools">
            {tools.map(({ id, label, icon: Icon, hint }) => (
              <button
                key={id}
                type="button"
                title={hint}
                aria-pressed={tool === id}
                onClick={() => setTool(id)}
                className={clsx("inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium", tool === id ? "bg-sky-600 text-white" : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800", CONTROL_FOCUS)}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {label}
              </button>
            ))}
            <span className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" aria-hidden="true" />
            {REVIEW_COLORS.map((swatch) => (
              <button
                key={swatch}
                type="button"
                aria-label={`Colour ${swatch}`}
                aria-pressed={color === swatch}
                onClick={() => setColor(swatch)}
                className={clsx("h-5 w-5 rounded-full border-2", color === swatch ? "border-slate-900 dark:border-white" : "border-transparent", CONTROL_FOCUS)}
                style={{ background: swatch }}
              />
            ))}
            <span className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" aria-hidden="true" />
            <Button size="sm" variant={panelOpen ? "primary" : "secondary"} onClick={() => setPanelOpen((open) => !open)}>
              Feedback ({bundle ? liveItems(bundle).length : 0}) · Round {round}
            </Button>
            <Button size="sm" variant="ghost" iconOnly aria-label="Close feedback mode" leftIcon={<X className="h-4 w-4" />} onClick={() => { setEnabled(false); setTool("interact"); setSelectedId(null); }} />
          </div>
          )
        ) : offerFeedback ? (
          <Button className="pointer-events-auto shadow-lg" variant="primary" leftIcon={<MessageSquarePlus className="h-4 w-4" />} onClick={enable} data-testid="review-enable">
            Give feedback
          </Button>
        ) : null}
      </div>

      {enabled && panelOpen && bundle ? (
        <ReviewFeedbackPanel
          bundle={bundle}
          numbers={numbers}
          me={me}
          error={error}
          fields={fieldById}
          onSelect={(item) => {
            setSelectedId(item.id);
            const rootElement = rootRef.current;
            if (rootElement && item.anchor.attribute && item.anchor.value !== null) {
              scopeOf(rootElement).querySelector(`[${item.anchor.attribute}="${CSS.escape(item.anchor.value)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
            }
          }}
          onBundleChange={setBundle}
          onEditIdentity={() => setIdentityOpen(true)}
          onOpenFile={() => fileInputRef.current?.click()}
          onBeforeExport={async () => {
            const page = selected?.item.page ?? placed[0]?.item.page;
            const next = page ? await capture(bundle, page) : bundle;
            setBundle(next);
            return next;
          }}
          onClose={() => setPanelOpen(false)}
        />
      ) : null}

      <input
        ref={fileInputRef}
        type="file"
        accept=".html,.htm,.zip,.json"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void openFile(file);
        }}
      />
      <ReviewIdentityDialog
        open={identityOpen}
        person={me}
        onClose={() => setIdentityOpen(false)}
        onSave={(person) => {
          setMe(person);
          storePerson(person);
          setBundle((current) => setRoundReviewer(ensureBundle(current), person));
          setIdentityOpen(false);
        }}
      />
      <ReviewLoadedDialog
        loaded={loaded}
        hasCurrent={Boolean(bundle && liveItems(bundle).length)}
        onClose={() => setLoaded(null)}
        onApply={(next) => {
          setBundle(next);
          setEnabled(true);
          setPanelOpen(true);
          setLoaded(null);
        }}
        current={bundle}
        me={me}
      />
    </div>
    </>
  );
}

function addReplyTo(bundle: ReviewFeedbackBundle, item: ReviewItem, text: string, author?: ReviewPerson) {
  return text.trim() ? addReviewReply(bundle, item.id, text.trim(), author) : bundle;
}

