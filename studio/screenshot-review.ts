import type { TutorialRecordingDraft } from "../recording/types";
export { tutorialStepScreenshotFingerprint as screenshotFingerprintForStep } from "../recording/screenshot-freshness";

/** Replay only through the last requested image; do not depend on later unfinished steps. */
export function screenshotSelectionReplayDraft(draft: TutorialRecordingDraft, stepIds: readonly string[]): TutorialRecordingDraft {
  const wanted = new Set(stepIds);
  if (!wanted.size) throw new Error("Choose at least one step to capture.");
  for (const id of wanted) {
    const step = draft.steps.find((entry) => entry.id === id);
    if (!step) throw new Error("A selected step is no longer in the tutorial.");
    if (!step.action && !step.check) throw new Error(`“${step.title}” has no replay action. Capture the current interface or upload an image for this explanation.`);
    if (!step.action) throw new Error(`“${step.title}” has an outcome check but no replay action. Add its action or capture the current interface.`);
  }
  const last = Math.max(...draft.steps.map((step, index) => wanted.has(step.id) ? index : -1));
  return { ...draft, steps: draft.steps.slice(0, last + 1).map((step) => ({ ...step,
    screenshot: undefined, screenshotMode: wanted.has(step.id) ? "auto" : "none" })) };
}

