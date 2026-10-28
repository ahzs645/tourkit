import { describe, expect, it, vi } from "vitest";

import type { TutorialRecorderAction } from "./types";
import { TutorialRecorder } from "./recorder";

describe("TutorialRecorder", () => {
  it("timestamps semantic actions against one monotonic recording clock", async () => {
    let now = 100;
    let listener: ((action: TutorialRecorderAction) => void) | undefined;
    let unsubscribed = false;
    const recorder = new TutorialRecorder({
      now: () => now,
      wallClock: () => new Date("2026-08-12T10:00:00.000Z"),
      subscribeToActions: (next) => {
        listener = next;
        return () => {
          unsubscribed = true;
        };
      }
    });

    await recorder.start({ microphone: false });
    now = 425;
    listener?.({ id: "builder.addField", args: { type: "section" } });
    now = 1_100;
    const capture = await recorder.stop();

    expect(capture).toMatchObject({
      startedAt: "2026-08-12T10:00:00.000Z",
      durationMs: 1_000,
      actions: [
        {
          id: "builder.addField",
          args: { type: "section" },
          atMs: 325
        }
      ]
    });
    expect(unsubscribed).toBe(true);
    expect(recorder.status).toBe("idle");
  });

  it("continues recording actions when microphone permission is denied", async () => {
    let listener: ((action: TutorialRecorderAction) => void) | undefined;
    const recorder = new TutorialRecorder({
      subscribeToActions: (next) => {
        listener = next;
      },
      getMicrophoneStream: async () => {
        throw new Error("Permission denied");
      }
    });

    await recorder.start();
    listener?.({ id: "workspace.openPreview" });
    const capture = await recorder.stop();

    expect(capture.actions[0].id).toBe("workspace.openPreview");
    expect(capture.audio).toBeUndefined();
    expect(capture.warnings[0]).toContain("Permission denied");
  });

  it("excludes paused actions and paused time while pausing microphone recording", async () => {
    let now = 100;
    let listener!: (action: TutorialRecorderAction) => void;
    const streamStop = vi.fn();
    const media = {
      state: "inactive", mimeType: "audio/webm", ondataavailable: null as ((event: BlobEvent) => void) | null,
      onerror: null, onstop: null as ((event: Event) => void) | null,
      start: vi.fn(() => { media.state = "recording"; }),
      pause: vi.fn(() => { media.state = "paused"; }),
      resume: vi.fn(() => { media.state = "recording"; }),
      stop: vi.fn(() => { media.state = "inactive"; media.ondataavailable?.({ data: new Blob(["audio"]) } as BlobEvent); media.onstop?.({} as Event); }),
    };
    const recorder = new TutorialRecorder({ now: () => now, subscribeToActions: (next) => { listener = next; },
      getMicrophoneStream: async () => ({ getTracks: () => [{ stop: streamStop }] }) as unknown as MediaStream,
      createMediaRecorder: () => media });
    await recorder.start();
    now = 300; listener({ id: "before" });
    now = 500; recorder.pause();
    now = 3500; listener({ id: "ignored" });
    recorder.resume();
    now = 3800; listener({ id: "after" });
    now = 4100;
    const capture = await recorder.stop();
    expect(capture.actions).toEqual([{ id: "before", atMs: 200 }, { id: "after", atMs: 700 }]);
    expect(capture.durationMs).toBe(1000);
    expect(capture.audio?.durationMs).toBe(1000);
    expect(capture.warnings).toEqual([expect.stringContaining("1 stage actions made while paused were excluded")]);
    expect(media.pause).toHaveBeenCalledOnce(); expect(media.resume).toHaveBeenCalledOnce(); expect(streamStop).toHaveBeenCalledOnce();
  });

  it("can finish or discard a paused recording without extending its duration", async () => {
    let now = 0;
    const recorder = new TutorialRecorder({ now: () => now, subscribeToActions: () => undefined });
    await recorder.start({ microphone: false });
    now = 500; recorder.pause(); now = 5000;
    expect((await recorder.stop()).durationMs).toBe(500);
    await recorder.start({ microphone: false });
    recorder.pause(); recorder.clear();
    expect(recorder.status).toBe("idle");
    await recorder.start({ microphone: false });
    now = 5500;
    expect((await recorder.stop()).durationMs).toBe(500);
  });

  it("stops a microphone stream that resolves after the recorder was cleared", async () => {
    let resolveStream!: (stream: MediaStream) => void;
    const stopTrack = vi.fn();
    const pendingStream = new Promise<MediaStream>((resolve) => {
      resolveStream = resolve;
    });
    const recorder = new TutorialRecorder({
      subscribeToActions: () => undefined,
      getMicrophoneStream: () => pendingStream,
    });

    const starting = recorder.start();
    recorder.clear();
    resolveStream({ getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream);

    await expect(starting).rejects.toMatchObject({ name: "AbortError" });
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(recorder.status).toBe("idle");
  });

  it("releases microphone hardware when its recorder cannot be constructed", async () => {
    const stopTrack = vi.fn();
    const recorder = new TutorialRecorder({ subscribeToActions: () => undefined,
      getMicrophoneStream: async () => ({ getTracks: () => [{ stop: stopTrack }] }) as unknown as MediaStream,
      createMediaRecorder: () => { throw new Error("Unsupported recorder"); },
    });
    await recorder.start();
    expect(stopTrack).toHaveBeenCalledOnce();
    expect((await recorder.stop()).warnings[0]).toContain("Unsupported recorder");
  });

  it("cleans up failed startup and allows the recorder to be used again", async () => {
    let shouldThrow = true;
    const recorder = new TutorialRecorder({ subscribeToActions: () => {
      if (shouldThrow) throw new Error("Action source unavailable");
    } });
    await expect(recorder.start({ microphone: false })).rejects.toThrow("Action source unavailable");
    expect(recorder.status).toBe("idle");
    shouldThrow = false;
    await recorder.start({ microphone: false });
    expect((await recorder.stop()).warnings).toEqual([]);
  });

  it("does not restart a cleared recording when its visual adapter finishes starting", async () => {
    let finishVisual!: () => void;
    const pendingVisual = new Promise<void>((resolve) => { finishVisual = resolve; });
    const unsubscribe = vi.fn();
    const clearVisual = vi.fn();
    const recorder = new TutorialRecorder({ subscribeToActions: () => unsubscribe,
      visualRecorder: { start: () => pendingVisual, stop: () => undefined, clear: clearVisual } });
    const starting = recorder.start({ microphone: false });
    recorder.clear();
    finishVisual();
    await expect(starting).rejects.toMatchObject({ name: "AbortError" });
    expect(recorder.status).toBe("idle");
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(clearVisual).toHaveBeenCalledOnce();
  });
});

