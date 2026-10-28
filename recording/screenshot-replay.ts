import type { TutorialRecordingStep } from "./types";

/** Static explanations stay in the guide; actions still establish later screenshots' state. */
export function tutorialScreenshotReplaySteps(steps: readonly TutorialRecordingStep[]): TutorialRecordingStep[] {
  return steps.filter((step) => step.action || step.check || (step.screenshotMode !== "none" && !step.screenshot));
}

