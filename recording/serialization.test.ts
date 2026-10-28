import { describe, expect, it } from "vitest";

import { applyCaptureToDraft, createTutorialRecordingDraft, insertDraftStep } from "./draft";
import {
  deserializeTutorialRecordingDraft,
  serializeTutorialRecordingDraft
} from "./serialization";

describe("tutorial recording serialization", () => {
  it("round trips Continue explanations and validates their completion option", async () => {
    const draft = insertDraftStep(createTutorialRecordingDraft(), null);
    draft.steps[0].completion = "continue";
    draft.steps[0].contentKind = "note";
    const text = await serializeTutorialRecordingDraft(draft);
    expect((await deserializeTutorialRecordingDraft(text)).steps[0]).toMatchObject({ completion: "continue", contentKind: "note" });
    const invalid = JSON.parse(text);
    invalid.steps[0].completion = "invalid";
    await expect(deserializeTutorialRecordingDraft(JSON.stringify(invalid))).rejects.toThrow();
    delete draft.steps[0].completion;
    const legacyText = await serializeTutorialRecordingDraft(draft);
    expect(JSON.parse(legacyText).steps[0]).not.toHaveProperty("completion");
    expect((await deserializeTutorialRecordingDraft(legacyText)).steps[0]).not.toHaveProperty("completion");
  });

  it("round trips a portable draft with narration audio", async () => {
    const draft = applyCaptureToDraft(createTutorialRecordingDraft({ id: "portable" }), {
      startedAt: new Date().toISOString(),
      durationMs: 900,
      warnings: [],
      actions: [{ id: "builder.addField", args: { type: "text" }, atMs: 200 }],
      audio: {
        blob: new Blob(["audio bytes"], { type: "audio/webm" }),
        mimeType: "audio/webm",
        durationMs: 900
      }
    });

    const imported = await deserializeTutorialRecordingDraft(
      await serializeTutorialRecordingDraft(draft)
    );

    expect(imported.id).toBe("portable");
    expect(imported.steps[0].action).toMatchObject({ id: "builder.addField" });
    expect(imported.audio?.blob.type).toBe("audio/webm");
    expect(await imported.audio?.blob.text()).toBe("audio bytes");
  });

  it("imports MediaRecorder audio MIME parameters from a portable draft", async () => {
    const draft = applyCaptureToDraft(createTutorialRecordingDraft({ id: "opus-audio" }), {
      startedAt: new Date().toISOString(),
      durationMs: 500,
      warnings: [],
      actions: [],
      audio: {
        blob: new Blob(["opus bytes"], { type: "audio/webm;codecs=opus" }),
        mimeType: "audio/webm;codecs=opus",
        durationMs: 500,
      },
    });

    const imported = await deserializeTutorialRecordingDraft(
      await serializeTutorialRecordingDraft(draft),
    );

    expect(imported.audio?.blob.type).toBe("audio/webm;codecs=opus");
    expect(await imported.audio?.blob.text()).toBe("opus bytes");
  });
});

