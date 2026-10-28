import { tutorialScreenshotFingerprint } from "../core/screenshot";
import type { TutorialRecordingDraft } from "./types";

/** Changes to an earlier action can change every later screen. Image bytes never enter the hash. */
export function tutorialStepScreenshotFingerprint(draft: TutorialRecordingDraft, stepId: string): string {
  const index = draft.steps.findIndex((step) => step.id === stepId);
  if (index < 0) throw new Error("This step is no longer in the tutorial.");
  const step = draft.steps[index];
  return tutorialScreenshotFingerprint({ launch: draft.launch, earlierActions: draft.steps.slice(0, index).map((entry) => entry.action ?? null),
    action: step.action, context: step.context, anchor: step.anchor, target: step.target, ...(step.highlights?.length ? { highlights: step.highlights } : {}), title: step.title, instruction: step.instruction });
}

