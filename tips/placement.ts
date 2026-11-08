export type TipPlacement = "top" | "bottom" | "left" | "right";

export interface TipPosition {
  top: number;
  left: number;
  /** Offset of the tail along the card edge facing the anchor, in pixels. */
  tail: number;
}

export interface TipAnchorRect {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

const GAP = 12;
const MARGIN = 12;
/** Where the tail sits on an unclamped card: this far from the card's leading edge. */
const TAIL_INSET = 28;
const TAIL_MIN = 16;

/**
 * Place a card of `card` size beside `anchor`, kept inside the viewport.
 * The tail still points at the anchor's centre after the card is clamped.
 */
export function placeTip(
  anchor: TipAnchorRect,
  card: { width: number; height: number },
  placement: TipPlacement,
  viewport: { width: number; height: number } = { width: window.innerWidth, height: window.innerHeight },
): TipPosition {
  let top: number;
  let left: number;
  if (placement === "right") {
    left = anchor.right + GAP;
    top = anchor.top + anchor.height / 2 - TAIL_INSET;
  } else if (placement === "left") {
    left = anchor.left - GAP - card.width;
    top = anchor.top + anchor.height / 2 - TAIL_INSET;
  } else if (placement === "bottom") {
    top = anchor.bottom + GAP;
    left = anchor.left + anchor.width / 2 - TAIL_INSET;
  } else {
    top = anchor.top - GAP - card.height;
    left = anchor.left + anchor.width / 2 - TAIL_INSET;
  }
  left = Math.max(MARGIN, Math.min(left, viewport.width - card.width - MARGIN));
  top = Math.max(MARGIN, Math.min(top, viewport.height - card.height - MARGIN));
  const tail = placement === "left" || placement === "right"
    ? Math.max(TAIL_MIN, Math.min(anchor.top + anchor.height / 2 - top, card.height - TAIL_MIN))
    : Math.max(TAIL_MIN, Math.min(anchor.left + anchor.width / 2 - left, card.width - TAIL_MIN));
  return { top, left, tail };
}

/** Rendered, inside the viewport, and not hidden (for example in a closed off-canvas drawer). */
export function isTipAnchorOnScreen(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= window.innerWidth || rect.top >= window.innerHeight) return false;
  const style = window.getComputedStyle(element);
  return style.visibility !== "hidden" && style.display !== "none";
}
