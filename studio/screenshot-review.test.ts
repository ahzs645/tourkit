import { describe, expect, it } from "vitest";
import { applyCaptureToDraft, createTutorialRecordingDraft, insertDraftStep } from "../recording/draft";
import { screenshotFingerprintForStep, screenshotSelectionReplayDraft } from "./screenshot-review";

const draft = () => applyCaptureToDraft(createTutorialRecordingDraft(), { startedAt: new Date().toISOString(), durationMs: 4000,
  warnings: [], actions: [{ id: "builder.addField", args: { type: "text" }, atMs: 100 },
    { id: "workspace.selectTab", args: { tab: "preview" }, atMs: 1000 }, { id: "unsupported.later", atMs: 2000 }] });

describe("screenshot review", () => {
  it("replays prerequisites but captures only the requested image without depending on later unfinished steps", () => {
    const original = draft();
    const selected = original.steps[1].id;
    const replay = screenshotSelectionReplayDraft(original, [selected]);
    expect(replay.steps).toHaveLength(2);
    expect(replay.steps[0].action).toEqual(original.steps[0].action);
    expect(replay.steps[0].screenshotMode).toBe("none");
    expect(replay.steps[1].screenshotMode).toBe("auto");
    expect(original.steps).toHaveLength(3);
    expect(original.steps[0].screenshotMode).toBeUndefined();
  });
  it("requires a replayable selected step and directs manual explanations to manual capture", () => {
    const original = insertDraftStep(draft(), null);
    expect(() => screenshotSelectionReplayDraft(original, [original.steps.at(-1)!.id])).toThrow("Capture the current interface");
    expect(() => screenshotSelectionReplayDraft(original, ["gone"])).toThrow("no longer");
  });
  it("invalidates a later image when an earlier action, launch or instruction changes, but ignores later actions", () => {
    const original = draft(); const id = original.steps[1].id;
    const expected = screenshotFingerprintForStep(original, id);
    const earlier = structuredClone(original); earlier.steps[0].action!.args = { type: "number" };
    expect(screenshotFingerprintForStep(earlier, id)).not.toBe(expected);
    const later = structuredClone(original); later.steps[2].title = "Different later step";
    expect(screenshotFingerprintForStep(later, id)).toBe(expected);
    const instruction = structuredClone(original); instruction.steps[1].instruction = "Updated instructions";
    expect(screenshotFingerprintForStep(instruction, id)).not.toBe(expected);
    const launch = structuredClone(original); launch.launch.fixture = "another-fixture";
    expect(screenshotFingerprintForStep(launch, id)).not.toBe(expected);
  });
});

