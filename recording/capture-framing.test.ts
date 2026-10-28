import { describe, expect, it } from "vitest";
import { tutorialFrameOutputSize, tutorialFrameRect } from "./capture-framing";

const screen = { width: 3840, height: 2160 };

describe("tutorialFrameRect", () => {
  it("keeps the whole capture for whole-screen framing or a step without a control", () => {
    const focus = { x: 100, y: 100, width: 80, height: 40 };
    expect(tutorialFrameRect(screen, focus, "screen", 2)).toEqual({ x: 0, y: 0, ...screen });
    expect(tutorialFrameRect(screen, undefined, "step", 2)).toEqual({ x: 0, y: 0, ...screen });
  });

  it("zooms to a small control with readable context, centred and inside the capture", () => {
    const frame = tutorialFrameRect(screen, { x: 1800, y: 1000, width: 80, height: 40 }, "step", 2);
    expect(frame.width).toBeGreaterThanOrEqual(1600);
    expect(frame.height).toBeGreaterThanOrEqual(1000);
    expect(frame.width / frame.height).toBeGreaterThanOrEqual(4 / 3 - 0.01);
    expect(frame.x + frame.width / 2).toBeCloseTo(1840, 0);
    expect(frame.y + frame.height / 2).toBeCloseTo(1020, 0);
  });

  it("slides the crop inward at the edges instead of cutting the control off", () => {
    const frame = tutorialFrameRect(screen, { x: 3800, y: 2140, width: 30, height: 16 }, "step", 2);
    expect(frame.x + frame.width).toBe(3840);
    expect(frame.y + frame.height).toBe(2160);
    expect(frame.x).toBeLessThanOrEqual(3800);
  });

  it("shows the whole screen when the control already fills most of it", () => {
    expect(tutorialFrameRect(screen, { x: 40, y: 40, width: 3700, height: 2000 }, "step", 2)).toEqual({ x: 0, y: 0, ...screen });
  });
});

describe("tutorialFrameOutputSize", () => {
  it("caps whole screens and crops at their own limits, keeping proportions", () => {
    expect(tutorialFrameOutputSize({ x: 0, y: 0, width: 3840, height: 2160 }, true)).toEqual({ width: 2560, height: 1440 });
    expect(tutorialFrameOutputSize({ x: 0, y: 0, width: 1600, height: 1000 }, false)).toEqual({ width: 1600, height: 1000 });
  });
});

