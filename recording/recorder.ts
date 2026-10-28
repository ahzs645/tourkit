import type {
  SubscribeToTutorialActions,
  TutorialAudioTrack,
  TutorialCapture,
  TutorialRecordedAction
} from "./types";
import type { TutorialVisualRecorderAdapter } from "./visual-recorder";

interface MediaRecorderLike {
  state: string;
  mimeType: string;
  ondataavailable: ((event: BlobEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onstop: ((event: Event) => void) | null;
  start(timeslice?: number): void;
  pause?(): void;
  resume?(): void;
  stop(): void;
}

interface MediaStreamLike {
  getTracks(): Array<{ stop(): void }>;
}

export interface TutorialRecorderOptions {
  subscribeToActions: SubscribeToTutorialActions;
  visualRecorder?: TutorialVisualRecorderAdapter;
  now?: () => number;
  wallClock?: () => Date;
  getMicrophoneStream?: () => Promise<MediaStream>;
  createMediaRecorder?: (stream: MediaStream) => MediaRecorderLike;
}

export interface StartTutorialRecordingOptions {
  microphone?: boolean;
}

export type TutorialRecorderStatus = "idle" | "requesting-permission" | "recording" | "paused" | "stopping";

/**
 * Coordinates audio, semantic actions, and an optional visual adapter against
 * one monotonic clock. A recorder instance is reusable and contains no app state.
 */
export class TutorialRecorder {
  private readonly options: TutorialRecorderOptions;
  private readonly now: () => number;
  private readonly wallClock: () => Date;
  private statusValue: TutorialRecorderStatus = "idle";
  private startedAtMs = 0;
  private startedAtIso = "";
  private pausedAtMs: number | undefined;
  private pausedDurationMs = 0;
  private pausedActions = 0;
  private actions: TutorialRecordedAction[] = [];
  private warnings: string[] = [];
  private chunks: Blob[] = [];
  private mediaRecorder: MediaRecorderLike | undefined;
  private stream: MediaStreamLike | undefined;
  private unsubscribe: (() => void) | undefined;
  private runId = 0;

  constructor(options: TutorialRecorderOptions) {
    this.options = options;
    this.now = options.now ?? (() => performance.now());
    this.wallClock = options.wallClock ?? (() => new Date());
  }

  get status(): TutorialRecorderStatus {
    return this.statusValue;
  }

  get isRecording(): boolean {
    return this.statusValue === "recording";
  }

  get excludedPausedActionCount(): number {
    return this.pausedActions;
  }

  async start(options: StartTutorialRecordingOptions = {}): Promise<void> {
    if (this.statusValue !== "idle") throw new Error("A tutorial recording is already active.");
    const runId = ++this.runId;
    this.clearCaptureState();

    const wantsMicrophone = options.microphone !== false;
    if (wantsMicrophone) {
      this.statusValue = "requesting-permission";
      try {
        const getStream =
          this.options.getMicrophoneStream ??
          (() => navigator.mediaDevices.getUserMedia({ audio: true, video: false }));
        const stream = await getStream();
        if (runId !== this.runId || this.statusValue !== "requesting-permission") {
          stream.getTracks().forEach((track) => track.stop());
          throw recordingCancelledError();
        }
        this.stream = stream;
        const createRecorder =
          this.options.createMediaRecorder ?? ((stream) => new MediaRecorder(stream));
        const mediaRecorder = createRecorder(this.stream as MediaStream);
        this.mediaRecorder = mediaRecorder;
        this.attachMediaRecorder(mediaRecorder);
      } catch (error) {
        if (runId !== this.runId) throw error;
        this.stopStream();
        this.mediaRecorder = undefined;
        this.warnings.push(
          `Microphone was unavailable; actions will still be recorded. ${formatError(error)}`
        );
      }
    }

    if (runId !== this.runId) throw recordingCancelledError();

    this.startedAtMs = this.now();
    this.startedAtIso = this.wallClock().toISOString();
    try {
      const unsubscribe = this.options.subscribeToActions((action) => {
        if (this.statusValue === "paused") this.pausedActions += 1;
        if (this.statusValue !== "recording") return;
        this.actions.push({
          ...action,
          atMs: this.elapsedMs()
        });
      });
      this.unsubscribe = typeof unsubscribe === "function" ? unsubscribe : undefined;

      this.mediaRecorder?.start(1_000);
      try {
        await this.options.visualRecorder?.start({ nowMs: () => this.elapsedMs() });
      } catch (error) {
        this.warnings.push(`Visual reference recording did not start. ${formatError(error)}`);
      }
      if (runId !== this.runId) throw recordingCancelledError();
      this.statusValue = "recording";
    } catch (error) {
      if (runId === this.runId) this.clear();
      throw error;
    }
  }

  pause(): void {
    if (this.statusValue !== "recording") throw new Error("No tutorial recording is active.");
    if (this.mediaRecorder && (!this.mediaRecorder.pause || !this.mediaRecorder.resume)) {
      throw new Error("This browser cannot pause narration. Stop this recording instead.");
    }
    this.mediaRecorder?.pause?.();
    this.pausedAtMs = this.now();
    this.statusValue = "paused";
    this.options.visualRecorder?.pause?.();
  }

  resume(): void {
    if (this.statusValue !== "paused") throw new Error("No tutorial recording is paused.");
    this.mediaRecorder?.resume?.();
    this.pausedDurationMs += this.now() - this.pausedAtMs!;
    this.pausedAtMs = undefined;
    this.statusValue = "recording";
    this.options.visualRecorder?.resume?.();
  }

  async stop(): Promise<TutorialCapture> {
    if (this.statusValue !== "recording" && this.statusValue !== "paused") throw new Error("No tutorial recording is active.");
    const durationMs = this.elapsedMs();
    this.statusValue = "stopping";
    this.unsubscribe?.();
    this.unsubscribe = undefined;

    const audio = await this.stopAudio(durationMs);
    let visualReference = undefined;
    try {
      const captured = await this.options.visualRecorder?.stop();
      visualReference = captured || undefined;
    } catch (error) {
      this.warnings.push(`Visual reference recording could not be finalized. ${formatError(error)}`);
    }
    this.stopStream();
    this.statusValue = "idle";

    const warnings = [...this.warnings];
    if (this.pausedActions) warnings.push(`${this.pausedActions} stage actions made while paused were excluded. Later steps may depend on that unrecorded setup; preview the tutorial from its starting fixture and record any required setup.`);
    return {
      startedAt: this.startedAtIso,
      durationMs,
      actions: [...this.actions],
      audio,
      visualReference,
      warnings
    };
  }

  /** Stops hardware/listeners and removes every in-memory capture artifact. */
  clear(): void {
    this.runId += 1;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      this.mediaRecorder.ondataavailable = null;
      this.mediaRecorder.onerror = null;
      this.mediaRecorder.onstop = null;
      this.mediaRecorder.stop();
    }
    this.options.visualRecorder?.clear?.();
    this.stopStream();
    this.statusValue = "idle";
    this.clearCaptureState();
  }

  private elapsedMs(): number {
    return Math.max(0, Math.round((this.pausedAtMs ?? this.now()) - this.startedAtMs - this.pausedDurationMs));
  }

  private clearCaptureState(): void {
    this.startedAtMs = 0;
    this.startedAtIso = "";
    this.pausedAtMs = undefined;
    this.pausedDurationMs = 0;
    this.pausedActions = 0;
    this.actions = [];
    this.warnings = [];
    this.chunks = [];
    this.mediaRecorder = undefined;
  }

  private attachMediaRecorder(recorder: MediaRecorderLike): void {
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
    recorder.onerror = () => {
      this.warnings.push("The browser reported an error while recording microphone audio.");
    };
  }

  private stopAudio(durationMs: number): Promise<TutorialAudioTrack | undefined> {
    const recorder = this.mediaRecorder;
    if (!recorder) return Promise.resolve(undefined);
    if (recorder.state === "inactive") return Promise.resolve(this.buildAudioTrack(recorder, durationMs));

    return new Promise((resolve) => {
      recorder.onstop = () => resolve(this.buildAudioTrack(recorder, durationMs));
      recorder.stop();
    });
  }

  private buildAudioTrack(
    recorder: MediaRecorderLike,
    durationMs: number
  ): TutorialAudioTrack | undefined {
    if (this.chunks.length === 0) return undefined;
    const mimeType = recorder.mimeType || this.chunks[0]?.type || "audio/webm";
    return {
      blob: new Blob(this.chunks, { type: mimeType }),
      mimeType,
      durationMs
    };
  }

  private stopStream(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function recordingCancelledError(): Error {
  const error = new Error("Tutorial recording was cancelled.");
  error.name = "AbortError";
  return error;
}

