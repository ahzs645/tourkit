const CLIPPING_OVERFLOW = /^(auto|scroll|hidden|clip)$/;
const EDGE_TOLERANCE_PX = 1;
/** The most a control may be trimmed by its space's edge and still count as on screen. */
const EDGE_TRIM_PX = 8;

/**
 * Whether an anchor's extent on one axis is available to the learner inside
 * the space that holds it (the viewport, or a clipping ancestor).
 *
 * The ordinary answer is containment: the whole anchor sits inside the space.
 * An anchor *larger* than the space can never satisfy that — a region anchor
 * around a stack of inspector groups outgrows the panel the moment one group
 * is expanded — so it instead has to fill at least half of that space, which
 * is what looking at part of a long region looks like. Scrolled down to its
 * last sliver, it stops filling the space and the player asks for it back.
 */
function isExtentVisible(start: number, end: number, boundStart: number, boundEnd: number): boolean {
  const bound = boundEnd - boundStart;
  if (end - start > bound + EDGE_TOLERANCE_PX) {
    const visible = Math.min(end, boundEnd) - Math.max(start, boundStart);
    return visible >= bound / 2;
  }
  // A few pixels shaved off by the space's edge (a button that pokes out
  // of its dialog's frame) still leave the control there to press; it is
  // scrolled away, not trimmed, that the player has to ask about.
  const trim = Math.max(EDGE_TOLERANCE_PX, Math.min(EDGE_TRIM_PX, (end - start) * 0.1));
  return start >= boundStart - trim && end <= boundEnd + trim;
}

interface ClipBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

type Positioning = "flow" | "absolute" | "fixed";

function positioningOf(position: string): Positioning {
  return position === "absolute" ? "absolute" : position === "fixed" ? "fixed" : "flow";
}

/**
 * The ancestors that cut an element off, innermost first, with the axes they
 * clip. Follows CSS containing blocks: a scroll container does not clip an
 * absolutely positioned descendant whose positioned ancestor sits outside it
 * (an emulator's blood-pressure dialog, drawn in a modal layer inside the
 * encounter window's scrolling tab page but positioned against the window),
 * and nothing but the viewport clips a fixed one.
 */
function* clippingAncestors(element: HTMLElement): Generator<{ rect: DOMRect; clipsX: boolean; clipsY: boolean }> {
  let positioning = positioningOf(getComputedStyle(element).position);
  let parent = element.parentElement;
  while (parent && parent !== element.ownerDocument.body) {
    if (positioning === "fixed") return;
    const style = getComputedStyle(parent);
    // An unset position reads as "" in some DOMs; it is static.
    const escaped = positioning === "absolute" && (style.position === "static" || style.position === "");
    if (!escaped) {
      const clipsX = CLIPPING_OVERFLOW.test(style.overflowX);
      const clipsY = CLIPPING_OVERFLOW.test(style.overflowY);
      if (clipsX || clipsY) {
        const rect = parent.getBoundingClientRect();
        // Ignore unmeasurable ancestors for the same layout-free DOM reason.
        if (rect.width > 0 && rect.height > 0) yield { rect, clipsX, clipsY };
      }
      // Past its containing block, the chain continues by that block's rules.
      positioning = positioningOf(style.position);
    }
    parent = parent.parentElement;
  }
}

/**
 * Whether the whole tutorial anchor is actually available to the learner.
 * Viewport checks alone are insufficient: builder panes clip their children
 * inside nested overflow containers, so an element can have an on-screen DOM
 * rect while sitting underneath the pane header.
 */
export function isTutorialAnchorFullyVisible(anchor: HTMLElement): boolean {
  if (!anchor.isConnected) return false;
  const rect = anchor.getBoundingClientRect();
  // Layout-free DOMs (including the unit-test environment) report 0×0 for
  // otherwise usable elements. Anchor connectivity handles that case.
  if (rect.width <= 0 || rect.height <= 0) return true;

  // What the clipping ancestors let through. A table row wider than its
  // scrolling pane runs past the window's edge in layout, but the pane cuts
  // it off first: the window only ever shows the part inside the pane. Each
  // ancestor is judged on what the inner ones let through — an emulated desktop
  // scrolls too, and the full row runs past its edge.
  const shown: ClipBox = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
  for (const { rect: clip, clipsX, clipsY } of clippingAncestors(anchor)) {
    if (
      (clipsX && !isExtentVisible(shown.left, shown.right, clip.left, clip.right))
      || (clipsY && !isExtentVisible(shown.top, shown.bottom, clip.top, clip.bottom))
    ) return false;
    if (clipsX) {
      shown.left = Math.max(shown.left, clip.left);
      shown.right = Math.min(shown.right, clip.right);
    }
    if (clipsY) {
      shown.top = Math.max(shown.top, clip.top);
      shown.bottom = Math.min(shown.bottom, clip.bottom);
    }
  }

  return isExtentVisible(shown.top, shown.bottom, 0, window.innerHeight)
    && isExtentVisible(shown.left, shown.right, 0, window.innerWidth);
}

/**
 * The part of an element its scrolling panes actually show: its rect cut to
 * every clipping ancestor. The ring and the dim's hole are drawn around this,
 * so a row wider than its pane is not outlined across the window chrome
 * the pane hides it behind. Falls back to the element's own rect when nothing
 * of it is showing, or when it has no layout.
 */
export function visibleClientRect(element: HTMLElement, strictClipping = false): DOMRect {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return rect;
  const shown: ClipBox = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
  for (const { rect: clip, clipsX, clipsY } of clippingAncestors(element)) {
    if (clipsX) {
      shown.left = Math.max(shown.left, clip.left);
      shown.right = Math.min(shown.right, clip.right);
    }
    if (clipsY) {
      shown.top = Math.max(shown.top, clip.top);
      shown.bottom = Math.min(shown.bottom, clip.bottom);
    }
  }
  if (shown.right - shown.left < 1 || shown.bottom - shown.top < 1) return strictClipping ? new DOMRect(shown.left, shown.top, 0, 0) : rect;
  return new DOMRect(shown.left, shown.top, shown.right - shown.left, shown.bottom - shown.top);
}

