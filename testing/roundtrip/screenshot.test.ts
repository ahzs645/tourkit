import { describe, expect, it } from "vitest";
import { publishedScreenshot, readingScreenshot, screenshotIsStale, stampTutorialScreenshot, TutorialScreenshotSchema, tutorialScreenshotFingerprint } from "../../core/screenshot";
import { createTutorialRecordingDraft, insertDraftStep } from "../../recording/draft";
import { serializeTutorialRecordingDraft, deserializeTutorialRecordingDraft } from "../../recording/serialization";

const pixels = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=";
const image = { dataUrl: pixels, width: 1, height: 1, alt: "Training screen" };

describe("screenshot editing and provenance", () => {
  it("validates both the edited and original PNG and requires complete original dimensions", () => {
    expect(TutorialScreenshotSchema.safeParse({ ...image, sourceDataUrl: pixels }).success).toBe(false);
    expect(TutorialScreenshotSchema.safeParse({ ...image, sourceWidth: 1, sourceHeight: 1 }).success).toBe(false);
    expect(TutorialScreenshotSchema.safeParse({ ...image, sourceDataUrl: pixels, sourceWidth: 2, sourceHeight: 1 }).success).toBe(false);
    expect(TutorialScreenshotSchema.safeParse({ ...image, sourceDataUrl: pixels, sourceWidth: 1, sourceHeight: 1 }).success).toBe(true);
    expect(TutorialScreenshotSchema.safeParse({ ...image, provenance: { engine: "import", capturedAt: "not a date" } }).success).toBe(false);
  });

  it("preserves originals and metadata in editable draft round trips", async () => {
    const edited = stampTutorialScreenshot({ ...image, caption: "A caption", sourceDataUrl: pixels, sourceWidth: 1, sourceHeight: 1 }, {
      engine: "import", capturedAt: "2026-10-02T18:00:00.000Z", reviewedAt: "2026-10-02T18:01:00.000Z", stepFingerprint: "s1-fingerprint",
    });
    const draft = insertDraftStep(createTutorialRecordingDraft({ title: "Editable images" }), null);
    draft.steps[0].screenshot = edited;
    const restored = await deserializeTutorialRecordingDraft(await serializeTutorialRecordingDraft(draft));
    expect(restored.steps[0].screenshot).toEqual(edited);
  });

  it("never carries original pixels in a published/reading screenshot", () => {
    const edited = { ...image, caption: "Public caption", sourceDataUrl: pixels, sourceWidth: 1, sourceHeight: 1 };
    for (const transform of [readingScreenshot, publishedScreenshot]) {
      expect(transform(edited)).toEqual({ ...image, caption: "Public caption" });
      expect(edited.sourceDataUrl).toBe(pixels);
    }
  });

  it("detects step/action/context changes without depending on JSON object key order", () => {
    const fingerprint = tutorialScreenshotFingerprint({ action: { id: "open", args: { b: 2, a: 1 } }, earlierActions: ["home"], title: "Chart" });
    expect(tutorialScreenshotFingerprint({ title: "Chart", earlierActions: ["home"], action: { args: { a: 1, b: 2 }, id: "open" }, absent: undefined })).toBe(fingerprint);
    const stamped = stampTutorialScreenshot(image, { engine: "dom", capturedAt: "2026-10-02T18:00:00.000Z", stepFingerprint: fingerprint });
    expect(screenshotIsStale(stamped, fingerprint)).toBe(false);
    expect(screenshotIsStale(stamped, tutorialScreenshotFingerprint({ earlierActions: ["different"] }))).toBe(true);
    expect(screenshotIsStale(image, fingerprint)).toBe(false);
    expect(screenshotIsStale(stamped)).toBe(false);
  });
});

