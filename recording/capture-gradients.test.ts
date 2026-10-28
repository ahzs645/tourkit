import { describe, expect, it } from "vitest";
import { tutorialCaptureGradient } from "./capture-gradients";

describe("tutorial capture of inset row fills", () => {
  const gradient = "linear-gradient(rgb(255, 255, 255) 0px 1px, rgba(0, 0, 0, 0) 1px calc(100% - 2px), rgb(255, 255, 255) calc(100% - 2px) calc(100% - 1px), rgb(240, 240, 240) calc(100% - 1px) 100%)";
  it("preserves the sharp fill gaps and hairline instead of interpolating stops", () => {
    expect(tutorialCaptureGradient(gradient, 18)).toBe("linear-gradient(rgb(255, 255, 255) 0px, rgb(255, 255, 255) 1px, rgba(0, 0, 0, 0) 1px, rgba(0, 0, 0, 0) 16px, rgb(255, 255, 255) 16px, rgb(255, 255, 255) 17px, rgb(240, 240, 240) 17px, rgb(240, 240, 240) 18px)");
  });
  it("uses each cell's rendered height for wrapped rows", () => {
    expect(tutorialCaptureGradient(gradient, 29)).toContain("rgba(0, 0, 0, 0) 27px");
    expect(tutorialCaptureGradient("linear-gradient(180deg, #fff 0% 10%, transparent calc(50% + 2px) 100%)", 20)).toBe("linear-gradient(#fff 0px, #fff 2px, transparent 12px, transparent 20px)");
  });
  it("leaves group bands, multiple images and unsupported gradients untouched", () => {
    for (const image of ["none", "linear-gradient(90deg, #fff 0%, #000 100%)", "linear-gradient(#fff 0px, #000 10px), url(a.png)", "linear-gradient(#fff, #000)", "linear-gradient(#fff 0px, #000 calc(100% / 2))"]) {
      expect(tutorialCaptureGradient(image, 20)).toBeUndefined();
    }
    expect(tutorialCaptureGradient(gradient, 0)).toBeUndefined();
  });
});

