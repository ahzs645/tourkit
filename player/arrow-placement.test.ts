import { describe, expect, it } from "vitest";
import { tutorialArrow } from "./arrow-placement";

const viewport = { width: 1200, height: 900 };
const rect = (left: number, top: number, width: number, height: number) => ({ left, top, right: left + width, bottom: top + height });
describe("tutorial arrow placement", () => {
  it("points at the target edge without covering its label or crossing the card", () => {
    const arrow = tutorialArrow(rect(450, 100, 300, 240), rect(200, 200, 150, 40), viewport)!;
    expect(arrow.end).toEqual({ x: 360, y: 220 });
    expect(arrow.start.x).toBeLessThan(450);
    expect(arrow.start.x).toBeGreaterThan(arrow.end.x);
  });
  it("works on each side and keeps a long pointer near the target", () => {
    for (const card of [rect(900, 300, 200, 200), rect(10, 300, 200, 200), rect(450, 10, 200, 150), rect(450, 650, 200, 200)]) {
      const arrow = tutorialArrow(card, rect(500, 350, 100, 100), viewport)!;
      expect(arrow).not.toBeNull();
      expect(Math.hypot(arrow.end.x - arrow.start.x, arrow.end.y - arrow.start.y)).toBeLessThanOrEqual(120.001);
      expect(arrow.end.x < 500 || arrow.end.x > 600 || arrow.end.y < 350 || arrow.end.y > 450).toBe(true);
    }
  });
  it("hides a misleading pointer when boxes overlap, the target is missing or offscreen, or there is no room", () => {
    const card = rect(200, 200, 200, 200);
    for (const target of [rect(250, 250, 20, 20), rect(-200, 220, 50, 50), rect(420, 220, 20, 20), rect(800, 200, 0, 0)]) {
      expect(tutorialArrow(card, target, viewport)).toBeNull();
    }
  });
});

