import { describe, expect, it, vi } from "vitest";
import { drawScreenshotAnnotations, originalTutorialScreenshot, screenshotRectangle } from "./screenshot-editor-helpers";

describe("screenshot edit geometry and privacy", () => {
  it("normalizes reverse drags, clamps crops to the image and keeps a nonempty region", () => {
    expect(screenshotRectangle({ x: 100, y: 80 }, { x: 20, y: 10 }, 200, 100)).toEqual({ x: 20, y: 10, width: 80, height: 70 });
    expect(screenshotRectangle({ x: -10, y: -10 }, { x: 600, y: 400 }, 200, 100)).toEqual({ x: 0, y: 0, width: 200, height: 100 });
    expect(screenshotRectangle({ x: 400, y: 300 }, { x: 400, y: 300 }, 200, 100)).toEqual({ x: 199, y: 99, width: 1, height: 1 });
  });

  it("draws solid redaction after labels so no label reintroduces information in the masked region", () => {
    const operations: { operation: string; alpha: number; fill: string; args: unknown[] }[] = [];
    const context = { globalAlpha: .1, globalCompositeOperation: "multiply", fillStyle: "white", save: vi.fn(), restore: vi.fn(),
      strokeText: vi.fn(), fillText(...args: unknown[]) { operations.push({ operation: "text", alpha: this.globalAlpha, fill: this.fillStyle, args }); },
      fillRect(...args: unknown[]) { operations.push({ operation: "redact", alpha: this.globalAlpha, fill: this.fillStyle, args }); } };
    drawScreenshotAnnotations(context as unknown as CanvasRenderingContext2D, [
      { kind: "redact", rect: { x: 10.4, y: 20.4, width: 80, height: 30 } },
      { kind: "text", start: { x: 20, y: 25 }, text: "Hidden text" },
    ], 1);
    expect(operations.map((item) => item.operation)).toEqual(["text", "redact"]);
    expect(operations[1]).toMatchObject({ alpha: 1, fill: "#000000", args: [10, 20, 81, 31] });
    expect(context.globalCompositeOperation).toBe("source-over");
  });

  it("restores the original pixels and dimensions and clears prior review", () => {
    const image = { dataUrl: "edited", width: 20, height: 10, alt: "Chart", caption: "Caption", sourceDataUrl: "original", sourceWidth: 200, sourceHeight: 100,
      provenance: { engine: "import" as const, capturedAt: "2026-10-02T18:00:00.000Z", reviewedAt: "2026-10-02T18:01:00.000Z" } };
    expect(originalTutorialScreenshot(image)).toEqual({ dataUrl: "original", width: 200, height: 100, alt: "Chart", caption: "Caption",
      provenance: { engine: "import", capturedAt: "2026-10-02T18:00:00.000Z", reviewedAt: undefined } });
    expect(image.dataUrl).toBe("edited");
  });
});

