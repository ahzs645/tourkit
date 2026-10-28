import type { TutorialStep } from "./types";

const AUTOPLAY_READING_WORDS_PER_MINUTE = 200;
const AUTOPLAY_MINIMUM_READING_MS = 5_000;
const AUTOPLAY_MAXIMUM_READING_MS = 15_000;

function wordCount(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

/** Reading time for the visible card plus the author's post-reading offset. */
export function autoplayStepDurationMs(step: TutorialStep): number {
  // Narration already supplies the reading/listening interval. Its configured
  // delay remains a short beat after the audio range ends.
  if (step.narration) return step.advanceDelayMs;

  const words = wordCount(`${step.overlay.title} ${step.overlay.body}`);
  const readingMs = Math.ceil((words / AUTOPLAY_READING_WORDS_PER_MINUTE) * 60_000);
  const boundedReadingMs = Math.min(
    AUTOPLAY_MAXIMUM_READING_MS,
    Math.max(AUTOPLAY_MINIMUM_READING_MS, readingMs),
  );
  return boundedReadingMs + step.advanceDelayMs;
}

