// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { createCaptureStudioSample } from "./sample";
import { readCaptureStudioDraft, saveCaptureStudioDraft } from "./storage";

describe("capture studio durable edits", () => {
  it("recovers the latest valid edited package without a synthetic-data assertion", async () => {
    const capture = createCaptureStudioSample();
    capture.id = "recover-edited-capture";
    capture.title = "Edited locally";
    capture.privacy = { mode: "unreviewed" };
    await saveCaptureStudioDraft(capture);
    const restored = await readCaptureStudioDraft();
    expect(restored?.title).toBe("Edited locally");
    expect(restored?.privacy.mode).toBe("unreviewed");
    expect(restored?.events).toEqual(capture.events);
    await expect(saveCaptureStudioDraft({ ...capture, title: "" })).rejects.toThrow();
    expect((await readCaptureStudioDraft(capture.id))?.title).toBe("Edited locally");
  });
});
