import { expect, it } from "vitest";
import { createTutorialRecordingDraft, insertDraftStep } from "./draft";
import { tutorialScreenshotReplaySteps } from "./screenshot-replay";
import type { TutorialScreenshot } from "../core/screenshot";
import type { TutorialRecordingStep } from "./types";

it("requires no interactive replay for a guide made entirely of static text-only explanations", () => {
  const draft = insertDraftStep(createTutorialRecordingDraft(), null);
  draft.steps[0].screenshotMode = "none";
  expect(tutorialScreenshotReplaySteps(draft.steps)).toEqual([]);
  expect(draft.steps).toHaveLength(1);
});

it("keeps actions and outcome checks even on text-only steps for later screenshot state", () => {
  const draft = insertDraftStep(createTutorialRecordingDraft(), null);
  draft.steps[0].screenshotMode = "none";
  draft.steps[0].action = { id: "builder.addField", resultAlias: "field", match: "subset" };
  const checkStep: TutorialRecordingStep = { ...draft.steps[0], id: "check", action: undefined,
    check: { all: [{ path: "builder.fields", count: { min: 1 }, mode: "absolute" }] } };
  expect(tutorialScreenshotReplaySteps([draft.steps[0], checkStep])).toEqual([draft.steps[0], checkStep]);
});

it("keeps an expected missing screenshot so invalid replay requests fail instead of silently losing an image", () => {
  const draft = insertDraftStep(createTutorialRecordingDraft(), null);
  expect(tutorialScreenshotReplaySteps(draft.steps)).toEqual(draft.steps);
  const image = { dataUrl: "data:image/png;base64,pixels", width: 1, height: 1, alt: "Interface" } as TutorialScreenshot;
  draft.steps[0].screenshot = image;
  expect(tutorialScreenshotReplaySteps(draft.steps)).toEqual([]);
  expect(draft.steps[0].screenshot).toBe(image);
});

