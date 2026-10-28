import { describe, expect, it } from "vitest";

import { applyCaptureToDraft, createTutorialRecordingDraft } from "./draft";
import { buildTutorialAiEditingPrompt } from "./ai-prompt";

describe("buildTutorialAiEditingPrompt", () => {
  it("includes action timing, anchors, args, privacy, and canonical-output instructions", () => {
    const draft = applyCaptureToDraft(
      createTutorialRecordingDraft({
        id: "first-form",
        title: "First form",
        fixture: "tutorial-blank"
      }),
      {
        startedAt: "2026-08-12T00:00:00.000Z",
        durationMs: 2_500,
        warnings: [],
        actions: [
          {
            id: "builder.addField",
            args: { type: "section", source: "toolbar" },
            anchor: "builder.add-section",
            atMs: 750
          }
        ]
      }
    );

    const prompt = buildTutorialAiEditingPrompt(draft);

    expect(prompt).toContain("Return canonical tutorial manifest JSON only");
    expect(prompt).toContain("synthetic-data-only");
    expect(prompt).toContain('"id": "builder.addField"');
    expect(prompt).toContain('"anchor": "builder.add-section"');
    expect(prompt).toContain('"atMs": 750');
    expect(prompt).toContain('"type": "section"');
    expect(prompt).toContain('"attached": false');
    expect(prompt.toLowerCase()).toContain("do not invent a transcript");
  });

  it("instructs transcription only when local narration is attached", () => {
    const draft = applyCaptureToDraft(createTutorialRecordingDraft(), {
      startedAt: "2026-08-12T00:00:00.000Z",
      durationMs: 1_200,
      warnings: [],
      actions: [{ id: "workspace.selectTab", args: { tab: "builder" }, atMs: 100 }],
      audio: {
        blob: new Blob(["local audio"], { type: "audio/webm" }),
        mimeType: "audio/webm",
        durationMs: 1_200
      }
    });

    const prompt = buildTutorialAiEditingPrompt(draft);

    expect(prompt).toContain('"attached": true');
    expect(prompt).toContain('"mimeType": "audio/webm"');
    expect(prompt).toContain("transcribe it first");
    expect(prompt).not.toContain("local audio");
  });
});

