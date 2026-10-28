import { describe, expect, it } from "vitest";

import { boxMinus, cutoutPath, isDegenerateStage, paddedBox } from "./spotlight";

const box = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });

describe("spotlight cutouts", () => {
  it("keeps a box that does not touch the cut whole", () => {
    expect(boxMinus(box(0, 0, 10, 10), box(20, 20, 30, 30))).toEqual([box(0, 0, 10, 10)]);
  });

  it("drops a box inside the cut", () => {
    expect(boxMinus(box(12, 12, 18, 18), box(10, 10, 20, 20))).toEqual([]);
  });

  it("returns disjoint pieces outside the cut, so even-odd filling never re-dims an overlap", () => {
    const pieces = boxMinus(box(0, 0, 30, 30), box(10, 10, 20, 20));
    expect(pieces).toHaveLength(4);
    const area = pieces.reduce((sum, piece) => sum + (piece.right - piece.left) * (piece.bottom - piece.top), 0);
    expect(area).toBe(30 * 30 - 10 * 10);
    for (const [index, a] of pieces.entries()) {
      for (const b of pieces.slice(index + 1)) {
        const overlap = a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        expect(overlap).toBe(false);
      }
    }
  });

  it("keeps only the overhang of a box that pokes out of the cut", () => {
    expect(boxMinus(box(15, 5, 25, 15), box(0, 0, 20, 20))).toEqual([box(20, 5, 25, 15)]);
  });

  it("draws closed rectangles and recognises an empty stage", () => {
    expect(cutoutPath([paddedBox({ x: 50, y: 270, width: 270, height: 40 }, 6)])).toBe("M44,264 h282 v52 h-282 z");
    expect(isDegenerateStage({ x: 640, y: 400, width: 0, height: 0 })).toBe(true);
    expect(isDegenerateStage({ x: 0, y: 0, width: 10, height: 10 })).toBe(false);
  });
});

