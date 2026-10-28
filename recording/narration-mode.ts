/**
 * How the studio records: with the microphone (narration + actions) or
 * actions only. Actions-only needs no permission prompt and suits authors
 * who write the card text afterwards or hand the timeline to an AI prompt;
 * the recorded steps, anchors and suggested checks are identical either way.
 */
export type TutorialNarrationMode = "voice" | "actions-only";

const NARRATION_MODE_KEY = "tourkit:narration";

export const TUTORIAL_NARRATION_MODES: ReadonlyArray<{ value: TutorialNarrationMode; label: string }> = [
  { value: "voice", label: "Voice + actions" },
  { value: "actions-only", label: "Actions only (no microphone)" },
];

export function readTutorialNarrationMode(): TutorialNarrationMode {
  if (typeof window === "undefined") return "voice";
  try {
    return window.localStorage.getItem(NARRATION_MODE_KEY) === "actions-only" ? "actions-only" : "voice";
  } catch {
    return "voice";
  }
}

export function writeTutorialNarrationMode(mode: TutorialNarrationMode): void {
  if (typeof window === "undefined") return;
  try {
    if (mode === "voice") window.localStorage.removeItem(NARRATION_MODE_KEY);
    else window.localStorage.setItem(NARRATION_MODE_KEY, mode);
  } catch {
    // Storage may be unavailable (private mode); the setting is a convenience.
  }
}

