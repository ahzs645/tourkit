import type { TutorialFocusHighlight } from "../core/schema";
import { buildTutorialLaunchUrl } from "../core/schema";
import type { TutorialExportSource } from "../export/document";
import { stampTutorialScreenshot, type TutorialScreenshot } from "../core/screenshot";
import { tutorialManifestToRecordingDraft, tutorialRecordingDraftToManifest } from "./draft";
import { createDefaultTutorialDraftStore, type TutorialDraftStore } from "./draft-store";
import type { TutorialLaunch } from "../core/schema";
import { captureTutorialInterface } from "./capture-interface";
import { TUTORIAL_CAPTURE_SCALE, type TutorialScreenshotFraming } from "./capture-framing";
import { TUTORIAL_CAPTURE_PROTOCOL, isCaptureMessage } from "./capture-protocol";
import { tutorialScreenshotReplaySteps } from "./screenshot-replay";
import { tutorialStepScreenshotFingerprint } from "./screenshot-freshness";

export interface TutorialCaptureStep { index: number; title: string; body: string; anchorId?: string; targetId?: string; highlights?: TutorialFocusHighlight[] }

/**
 * Replays the tutorial once in an isolated desktop fixture and captures every
 * step that has no screenshot yet. Never substitutes another step's pixels on failure.
 */
export async function captureMissingTutorialScreenshots(source: TutorialExportSource, {
  signal, onScreenshot, onProgress, drawOverlay, focus, framing = "screen", draftStore, resolveLaunchUrl = buildTutorialLaunchUrl, captureInterface = captureTutorialInterface,
}: {
  signal: AbortSignal;
  onScreenshot: (stepId: string, screenshot: TutorialScreenshot) => void;
  onProgress: (message: string) => void;
  drawOverlay: (frame: HTMLIFrameElement, step: TutorialCaptureStep) => void;
  /** The elements a step rings, for "step" framing. */
  focus?: (doc: Document, step: TutorialCaptureStep) => readonly Element[];
  framing?: TutorialScreenshotFraming;
  draftStore?: TutorialDraftStore;
  captureInterface?: typeof captureTutorialInterface;
  resolveLaunchUrl?: (launch: TutorialLaunch) => string;
}): Promise<void> {
  signal.throwIfAborted();
  const original = "draft" in source ? source.draft : tutorialManifestToRecordingDraft(source.manifest);
  const token = crypto.randomUUID();
  const draft = { ...original, id: `capture-${token}`, audio: undefined,
    // A static explanation has no replay behavior. Leave it in the guide, but
    // do not require it to satisfy the interactive manifest's playback contract.
    // Actions on text-only steps still replay to establish the next image's state.
    steps: tutorialScreenshotReplaySteps(original.steps)
      .map((step) => ({ ...step, narration: undefined, screenshot: undefined })) };
  // Validate before opening any fixture; incomplete authored steps need a manual capture.
  const manifest = tutorialRecordingDraftToManifest(draft);
  const steps = manifest.chapters.flatMap((chapter) => chapter.steps);
  const existing = new Set(original.steps.filter((step) => step.screenshot).map((step) => step.id));
  const store = draftStore ?? createDefaultTutorialDraftStore();
  const frame = document.createElement("iframe");
  frame.title = "Tutorial screenshot capture";
  frame.setAttribute("aria-hidden", "true"); frame.tabIndex = -1;
  frame.style.cssText = "position:fixed;left:-20000px;top:0;width:1920px;height:1080px;border:0;pointer-events:none;";
  const hash = { ...manifest.launch.hash, tutorial: `draft:${draft.id}`, tutorialCapture: token, tutorialRun: token };
  frame.src = resolveLaunchUrl({ ...manifest.launch, hash });
  try {
    await store.put(draft);
    signal.throwIfAborted();
    onProgress("Opening the tutorial to take screenshots…");
    await new Promise<void>((resolve, reject) => {
      let index = 0;
      let capturing = false;
      let settled = false;
      let timer: ReturnType<typeof setTimeout>;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        window.removeEventListener("message", receive); signal.removeEventListener("abort", abort);
        if (error) reject(error); else resolve();
      };
      const resetTimeout = () => {
        clearTimeout(timer);
        timer = setTimeout(() => finish(new Error(`Screenshots stopped at step ${index + 1}. Export without screenshots, or open this step in Studio and capture it there.`)), 45_000);
      };
      const abort = () => finish(new DOMException("Export cancelled.", "AbortError"));
      const receive = (event: MessageEvent) => {
        if (event.source !== frame.contentWindow || event.origin !== window.location.origin || !isCaptureMessage(event.data, token) || settled) return;
        const message = event.data;
        if (message.type === "error") {
          const step = steps.find((entry) => entry.id === message.stepId);
          finish(new Error(`Could not capture “${step?.overlay.title ?? "tutorial"}”: ${message.error ?? "Replay failed."}`));
          return;
        }
        if (message.type === "complete") {
          finish(index === steps.length ? undefined : new Error("Replay finished without visiting every step."));
          return;
        }
        if (message.type !== "step" || capturing || message.stepId !== steps[index]?.id) return;
        const step = steps[index];
        capturing = true; resetTimeout();
        const needsImage = step.screenshotMode !== "none" && !existing.has(step.id);
        onProgress(`${needsImage ? "Taking screenshot" : "Replaying step"} ${index + 1} of ${steps.length}: ${step.overlay.title}`);
        void (async () => {
          try {
            if (needsImage) {
              const captureStep = { index, title: step.overlay.title, body: step.overlay.body, anchorId: step.anchor?.id, targetId: step.target?.id, highlights: step.highlights };
              drawOverlay(frame, captureStep);
              const screenshot = await captureInterface(frame, `Interface for ${step.overlay.title}`.slice(0, 500), {
                scale: TUTORIAL_CAPTURE_SCALE, framing, focus: focus ? (doc) => focus(doc, captureStep) : undefined,
              });
              if (settled) return;
              signal.throwIfAborted();
              onScreenshot(step.id, stampTutorialScreenshot(screenshot, { engine: "dom", capturedAt: new Date().toISOString(),
                stepFingerprint: tutorialStepScreenshotFingerprint(original, step.id) }));
            }
            if (settled) return;
            index += 1; capturing = false; resetTimeout();
            frame.contentWindow?.postMessage({ protocol: TUTORIAL_CAPTURE_PROTOCOL, token, type: "captured", stepId: step.id }, window.location.origin);
          } catch (error) { finish(error instanceof Error ? error : new Error("Screenshot capture failed.")); }
        })();
      };
      window.addEventListener("message", receive);
      signal.addEventListener("abort", abort, { once: true });
      resetTimeout();
      document.body.append(frame);
    });
  } finally {
    frame.remove();
    await store.delete(draft.id);
  }
}

