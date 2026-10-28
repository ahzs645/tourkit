import { describe, expect, it } from "vitest";

import { bestCenteredCardSpot, fittingCardHeight, pickCardPlacement, unionRect, type CardRect } from "./card-placement";

const viewport = { width: 1600, height: 900 };
const card = { width: 360, height: 220 };

function rect(left: number, top: number, width: number, height: number): CardRect {
  return { left, top, right: left + width, bottom: top + height };
}

function box(placement: { left: number; top: number }): CardRect {
  return rect(placement.left, placement.top, card.width, card.height);
}

function overlaps(a: CardRect, b: CardRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

describe("pickCardPlacement", () => {
  it("sits beside a palette item on the right, centred on it, and never covers it", () => {
    const focus = rect(30, 280, 110, 44);
    const avoid = unionRect(focus, focus, 14);
    const placement = pickCardPlacement({ avoid, focus, card, viewport, preferred: "right" });
    expect(placement.position).toBe("right");
    expect(placement.left).toBe(avoid.right + 20);
    // Centred on the item vertically.
    expect(placement.top).toBe(280 + 22 - card.height / 2);
    expect(overlaps(box(placement), avoid)).toBe(false);
  });

  it("hangs below a ribbon control near the top edge, staying on screen", () => {
    const focus = rect(700, 40, 80, 36);
    const avoid = unionRect(focus, focus, 14);
    const placement = pickCardPlacement({ avoid, focus, card, viewport, preferred: "bottom" });
    expect(placement.position).toBe("bottom");
    expect(placement.top).toBe(avoid.bottom + 20);
    expect(placement.left).toBe(740 - card.width / 2);
  });

  it("falls through to the next side when the preferred side has no room", () => {
    // Inspector control on the far right: "left" is the only side with space.
    const focus = rect(1450, 400, 130, 30);
    const avoid = unionRect(focus, focus, 14);
    const placement = pickCardPlacement({ avoid, focus, card, viewport, preferred: "right" });
    expect(placement.position).toBe("left");
    expect(placement.left + card.width).toBe(avoid.left - 20);
  });

  it("keeps the avoided region clear even when the control belongs to a wide region", () => {
    // Home tab inside the full-width ribbon: nothing fits above, so the card
    // goes below the whole ribbon rather than beside the tab.
    const focus = rect(60, 8, 60, 28);
    const avoid = unionRect(rect(0, 0, viewport.width, 100), focus, 14);
    const placement = pickCardPlacement({ avoid, focus, card, viewport, preferred: "bottom" });
    expect(placement.position).toBe("bottom");
    expect(overlaps(box(placement), avoid)).toBe(false);
  });

  it("keeps its current side while that side still fits", () => {
    const focus = rect(600, 400, 80, 30);
    const avoid = unionRect(focus, focus, 14);
    const placement = pickCardPlacement({ avoid, focus, card, viewport, preferred: "right", current: "top" });
    expect(placement.position).toBe("top");
  });

  it("docks in the first corner that keeps the control clear when no side fits", () => {
    const small = { width: 500, height: 400 };
    // A control that spans nearly the whole small viewport.
    const focus = rect(40, 40, 420, 320);
    const avoid = unionRect(focus, focus, 14);
    const placement = pickCardPlacement({ avoid, focus, card, viewport: small });
    expect(["bottom-right", "bottom-left", "top-right", "top-left"]).toContain(placement.position);
    expect(placement.left).toBeGreaterThanOrEqual(12);
    expect(placement.top).toBeGreaterThanOrEqual(12);
  });

  it("prefers a corner that does not cover the control", () => {
    const small = { width: 700, height: 520 };
    // A full-width band just below the middle: left/right have no room, the
    // space above and below is too short for the card, so a corner it is. The
    // bottom corners would cover the band; the top ones stay clear.
    const focus = rect(0, 254, 700, 46);
    const avoid = unionRect(focus, focus, 14);
    const placement = pickCardPlacement({ avoid, focus, card, viewport: small });
    expect(placement.position).toBe("top-right");
    expect(overlaps(box(placement), avoid)).toBe(false);
  });
});

describe("bestCenteredCardSpot", () => {
  const overlapWith = (control: CardRect) => (spot: CardRect) =>
    Math.max(0, Math.min(spot.right, control.right) - Math.max(spot.left, control.left))
    * Math.max(0, Math.min(spot.bottom, control.bottom) - Math.max(spot.top, control.top));

  it("moves a tall centered card beside a control it would still cover at the bottom", () => {
    // Interface vocabulary's Advanced step: a 567px card over the inspector's
    // groups at the left of a 1320 × 860 screen.
    const groups = rect(269, 254, 286, 212);
    const spot = bestCenteredCardSpot(600, 567, 1320, 860, overlapWith(groups));
    expect(spot?.cost).toBe(0);
    expect(spot?.name).toBe("right");
  });

  it("prefers the bottom when that already clears the control", () => {
    const header = rect(400, 40, 300, 40);
    expect(bestCenteredCardSpot(440, 240, 1320, 860, overlapWith(header))?.name).toBe("bottom");
  });

  it("settles for the least overlap when nothing clears the control", () => {
    const everything = rect(0, 0, 1320, 860);
    const spot = bestCenteredCardSpot(600, 567, 1320, 860, overlapWith(everything));
    expect(spot?.cost).toBeGreaterThan(0);
  });
});

describe("fitting a card around a table on a small screen", () => {
  it("shortens the scrollable card to fit below the whole table", () => {
    const input = { avoid: rect(70, 100, 460, 200), focus: rect(120, 280, 15, 15), card: { width: 360, height: 287 }, viewport: { width: 634, height: 538 } };
    const height = fittingCardHeight(input);
    expect(height).toBe(206);
    const placement = pickCardPlacement({ ...input, card: { ...input.card, height } });
    expect(placement.position).toBe("bottom");
    expect(overlaps(rect(placement.left, placement.top, input.card.width, height), input.avoid)).toBe(false);
  });
  it("keeps the full card when a side has enough space", () => {
    expect(fittingCardHeight({ avoid: rect(70, 100, 460, 200), focus: rect(120, 280, 15, 15), card, viewport })).toBe(card.height);
  });
});

