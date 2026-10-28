/**
 * Where an attached instruction card goes. Pure geometry so it can be tested
 * without a DOM: the overlay measures the anchor, the ring, the card, and the
 * viewport every frame and asks this function for a position.
 *
 * The rules come straight from watching learners on wide screens: the card
 * must sit next to the control it describes (not in a far corner), it must
 * never cover that control or the region it belongs to, and it must stay on
 * screen. When no side has room the card falls back to a corner — the first
 * corner that keeps the control clear.
 */

export interface CardRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type CardSide = "right" | "left" | "bottom" | "top";
export type CardCorner = "bottom-right" | "bottom-left" | "top-right" | "top-left";
export type CardPosition = CardSide | CardCorner;

export interface CardPlacementInput {
  /** Region the card must not cover (the anchor plus the ring, already padded). */
  avoid: CardRect;
  /** The ringed control; the card centres on it along the shared axis. */
  focus: CardRect;
  card: { width: number; height: number };
  viewport: { width: number; height: number };
  /** Side the step's author prefers; tried first. */
  preferred?: CardSide | null;
  /** Position from the previous frame; kept while it still fits (no flicker). */
  current?: CardPosition | null;
  /** Space between the avoided region and the card. */
  gap?: number;
  /** Space kept between the card and the viewport edge. */
  margin?: number;
}

export interface CardPlacement {
  position: CardPosition;
  left: number;
  top: number;
}

const SIDES: readonly CardSide[] = ["right", "left", "bottom", "top"];
const CORNERS: readonly CardCorner[] = ["bottom-right", "bottom-left", "top-right", "top-left"];

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function intersects(a: CardRect, b: CardRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function isSide(position: CardPosition): position is CardSide {
  return position === "right" || position === "left" || position === "bottom" || position === "top";
}

export function isCardCorner(position: CardPosition): position is CardCorner {
  return !isSide(position);
}

/** Card box for a side placement, or null when that side has no room. */
function sidePlacement(side: CardSide, input: Required<Omit<CardPlacementInput, "preferred" | "current">>): CardPlacement | null {
  const { avoid, focus, card, viewport, gap, margin } = input;
  const focusCenterX = (focus.left + focus.right) / 2;
  const focusCenterY = (focus.top + focus.bottom) / 2;
  const maxLeft = viewport.width - card.width - margin;
  const maxTop = viewport.height - card.height - margin;
  let left: number;
  let top: number;
  switch (side) {
    case "right":
      left = avoid.right + gap;
      top = clamp(focusCenterY - card.height / 2, margin, maxTop);
      if (left + card.width > viewport.width - margin) return null;
      break;
    case "left":
      left = avoid.left - gap - card.width;
      top = clamp(focusCenterY - card.height / 2, margin, maxTop);
      if (left < margin) return null;
      break;
    case "bottom":
      top = avoid.bottom + gap;
      left = clamp(focusCenterX - card.width / 2, margin, maxLeft);
      if (top + card.height > viewport.height - margin) return null;
      break;
    case "top":
      top = avoid.top - gap - card.height;
      left = clamp(focusCenterX - card.width / 2, margin, maxLeft);
      if (top < margin) return null;
      break;
  }
  const box = { left, top, right: left + card.width, bottom: top + card.height };
  // Clamping along the shared axis can slide a tall card back over the
  // control; a side only counts when the card clears the avoided region.
  if (intersects(box, avoid)) return null;
  return { position: side, left, top };
}

function cornerPlacement(corner: CardCorner, input: Required<Omit<CardPlacementInput, "preferred" | "current">>): CardPlacement {
  const { card, viewport, margin } = input;
  const left = corner.endsWith("right") ? viewport.width - card.width - margin : margin;
  const top = corner.startsWith("bottom") ? viewport.height - card.height - margin : margin;
  return { position: corner, left, top };
}

/** Shorten a card only when no full-height side clears the working region. */
export function fittingCardHeight(input: CardPlacementInput): number {
  const gap = input.gap ?? 20;
  const margin = input.margin ?? 12;
  const resolved = { ...input, gap, margin } as Required<Omit<CardPlacementInput, "preferred" | "current">>;
  if (SIDES.some(side => sidePlacement(side, resolved))) return input.card.height;
  // A shorter, scrollable card above/below the table preserves its labels and
  // rows. Leave enough card height for the heading and reachable controls.
  const available = Math.max(input.avoid.top - gap - margin,
    input.viewport.height - margin - input.avoid.bottom - gap);
  return available >= Math.min(140, input.card.height)
    ? Math.min(input.card.height, Math.floor(available))
    : input.card.height;
}

/**
 * Picks the card position. Sides are tried in order — the current side while
 * it still fits, then the author's preference, then right, left, bottom, top
 * — and the first with room wins. With no side available the card docks in a
 * corner, preferring one that does not cover the control.
 */
export function pickCardPlacement(input: CardPlacementInput): CardPlacement {
  const gap = input.gap ?? 20;
  const margin = input.margin ?? 12;
  const resolved = { ...input, gap, margin } as Required<Omit<CardPlacementInput, "preferred" | "current">>;

  const order: CardSide[] = [];
  const push = (side: CardSide | null | undefined) => {
    if (side && !order.includes(side)) order.push(side);
  };
  if (input.current && isSide(input.current)) push(input.current);
  push(input.preferred);
  for (const side of SIDES) push(side);

  for (const side of order) {
    const placement = sidePlacement(side, resolved);
    if (placement) return placement;
  }

  const corners: CardCorner[] = [];
  if (input.current && isCardCorner(input.current)) corners.push(input.current);
  for (const corner of CORNERS) if (!corners.includes(corner)) corners.push(corner);
  const boxed = corners.map((corner) => cornerPlacement(corner, resolved));
  const clear = boxed.find((placement) => !intersects(
    { left: placement.left, top: placement.top, right: placement.left + input.card.width, bottom: placement.top + input.card.height },
    input.avoid,
  ));
  return clear ?? boxed[0];
}

/** Smallest rectangle containing both inputs, grown by `pad` on every side. */
export function unionRect(a: CardRect, b: CardRect, pad = 0): CardRect {
  return {
    left: Math.min(a.left, b.left) - pad,
    top: Math.min(a.top, b.top) - pad,
    right: Math.max(a.right, b.right) + pad,
    bottom: Math.max(a.bottom, b.bottom) + pad,
  };
}

/**
 * Where a centered card goes when the middle of the screen would cover the
 * step's control: the cheapest of a fixed set of spots, in order of
 * preference, by the caller's overlap cost.
 */
export function bestCenteredCardSpot(
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
  cost: (box: CardRect) => number,
): { name: string; left: number; top: number; cost: number } | null {
  const margin = 24;
  const middleX = (viewportWidth - width) / 2;
  const middleY = (viewportHeight - height) / 2;
  const right = viewportWidth - width - margin;
  const bottom = viewportHeight - height - margin;
  const spots = [
    { name: "bottom", left: middleX, top: bottom },
    { name: "top", left: middleX, top: margin },
    { name: "right", left: right, top: middleY },
    { name: "left", left: margin, top: middleY },
    { name: "bottom-right", left: right, top: bottom },
    { name: "bottom-left", left: margin, top: bottom },
    { name: "top-right", left: right, top: margin },
    { name: "top-left", left: margin, top: margin },
  ];
  let best: { name: string; left: number; top: number; cost: number } | null = null;
  for (const spot of spots) {
    const left = Math.max(8, spot.left);
    const top = Math.max(8, spot.top);
    const spotCost = cost({ left, top, right: left + width, bottom: top + height });
    if (!best || spotCost < best.cost) best = { name: spot.name, left, top, cost: spotCost };
    if (spotCost === 0) break;
  }
  return best;
}

