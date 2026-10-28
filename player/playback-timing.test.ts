import { describe, expect, it } from "vitest";

import { parseTutorialManifest } from "../core/schema";

import { autoplayStepDurationMs } from "./playback-timing";

function step(body: string, advanceDelayMs = 750) {
  return parseTutorialManifest({
    schemaVersion: 1,
    id: "timing",
    title: "Timing",
    defaultMode: "autoplay",
    launch: { fixture: "blank" },
    chapters: [{
      id: "chapter",
      title: "Chapter",
      steps: [{
        id: "step",
        action: { id: "timing.wait" },
        overlay: { title: "Read this", body },
        advanceDelayMs,
      }],
    }],
  }).chapters[0].steps[0];
}

describe("autoplay reading time", () => {
  it("gives short cards a five-second reading floor plus the offset", () => {
    expect(autoplayStepDurationMs(step("A short instruction."))).toBe(5_750);
  });

  it("gives longer cards proportionally more time and caps the reading interval", () => {
    const medium = step(Array.from({ length: 30 }, () => "word").join(" "));
    const veryLong = step(Array.from({ length: 200 }, () => "word").join(" "));
    expect(autoplayStepDurationMs(medium)).toBeGreaterThan(8_000);
    expect(autoplayStepDurationMs(veryLong)).toBe(15_750);
  });

  it("uses narration as the listening interval and preserves only the offset", () => {
    const narrated = step("Listen to this narration.", 1_200);
    narrated.narration = { src: "/voice.webm", startMs: 0, endMs: 4_000 };
    expect(autoplayStepDurationMs(narrated)).toBe(1_200);
  });
});

