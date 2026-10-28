import { describe, expect, it } from "vitest";
import { stepsNeedingScreenshots } from "../components/tutorial-export-runner";
import { createTutorialRecordingDraft, insertDraftStep, tutorialManifestToRecordingDraft, tutorialRecordingDraftToManifest } from "../recording/draft";
import { deserializeTutorialRecordingDraft, serializeTutorialRecordingDraft } from "../recording/serialization";
import type { TutorialScreenshot } from "../core/screenshot";
import { tutorialDocument } from "./document";
import { exportTutorial } from "./index";

const screenshot: TutorialScreenshot = {
  dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=",
  width: 1, height: 1, alt: "Synthetic interface",
};

function source() {
  let draft = insertDraftStep(createTutorialRecordingDraft({ title: "Mixed guide" }), null);
  draft.steps[0].action = { id: "builder.addField", match: "subset" };
  draft.steps[0].screenshot = screenshot;
  draft = insertDraftStep(draft, draft.steps[0].id);
  draft.steps[1].title = "An explanation";
  draft.steps[1].instruction = "Read this explanation before continuing.";
  draft.steps[1].screenshotMode = "none";
  return { draft };
}

describe("intentional text-only tutorial steps", () => {
  it("exports mixed images and static explanations without silently losing an expected image", async () => {
    const input = source();
    for (const format of ["html", "markdown"] as const) {
      const text = await (await exportTutorial(input, format)).blob.text();
      expect(text).toContain(screenshot.dataUrl);
      expect(text).toContain(input.draft.steps[1].instruction);
    }
    input.draft.steps[1].screenshotMode = "auto";
    await expect(exportTutorial(input, "html")).rejects.toThrow("1 steps have no screenshot");
  });

  it("omits an intentionally excluded saved image from draft and manifest guides without deleting it", () => {
    const input = source();
    input.draft.steps[1].screenshot = screenshot;
    input.draft.steps[1].action = { id: "builder.selectField", match: "subset" };
    for (const source of [input, { manifest: tutorialRecordingDraftToManifest(input.draft) }]) {
      expect(tutorialDocument(source).chapters[0].steps.map((step) => step.screenshot)).toEqual([screenshot, undefined]);
    }
    expect(input.draft.steps[1].screenshot).toEqual(screenshot);
  });

  it("preserves screenshot intent through editable and playable formats", async () => {
    const input = source();
    input.draft.steps[1].action = { id: "builder.selectField", match: "subset" };
    const imported = await deserializeTutorialRecordingDraft(await serializeTutorialRecordingDraft(input.draft));
    expect(imported.steps[1].screenshotMode).toBe("none");
    const manifest = tutorialRecordingDraftToManifest(imported);
    expect(manifest.chapters[0].steps[1].screenshotMode).toBe("none");
    expect(tutorialManifestToRecordingDraft(manifest).steps[1].screenshotMode).toBe("none");
    expect(manifest.chapters[0].steps[0].screenshotMode).toBeUndefined();
  });

  it("counts only expected images and keeps source manifest playback validation strict", () => {
    const input = source();
    expect(stepsNeedingScreenshots(input)).toBe(0);
    input.draft.steps[0].screenshot = undefined;
    expect(stepsNeedingScreenshots(input)).toBe(1);
    expect(stepsNeedingScreenshots(input, { [input.draft.steps[0].id]: screenshot })).toBe(0);
    expect(() => tutorialRecordingDraftToManifest(input.draft)).toThrow("must define a semantic action");
  });
});

