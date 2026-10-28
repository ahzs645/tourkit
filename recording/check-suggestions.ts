import type { TutorialCheck, TutorialLaunch, TutorialSemanticAction } from "../core/schema";

/** Suggestions belong to the application profile; the editor only consumes this result. */
export interface TutorialCheckSuggestion {
  check?: TutorialCheck;
  reason?: "no-action" | "already-satisfied" | "unsupported-action";
}

/** One projection per recording/inspection, so parallel editors never share mutable state. */
export interface TutorialCheckSuggestionSession {
  suggest(action: TutorialSemanticAction | undefined): TutorialCheckSuggestion;
  apply(action: TutorialSemanticAction | undefined): void;
}

export interface TutorialCheckSuggestionProvider {
  forLaunch(launch: TutorialLaunch): TutorialCheckSuggestionSession;
}

/** A host without a projection still records replayable actions; it invents no outcome checks. */
export function createTutorialSuggestionSession(
  launch: TutorialLaunch,
  provider?: TutorialCheckSuggestionProvider,
): TutorialCheckSuggestionSession {
  return provider?.forLaunch(launch) ?? {
    suggest: (action) => ({ reason: action ? "unsupported-action" : "no-action" }),
    apply: () => {},
  };
}
