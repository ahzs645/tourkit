import type { TutorialSemanticAction } from "./types";
import { TutorialViewContextSchema, type TutorialViewContext } from "../core/schema";
import { TutorialViewStateSchema, tutorialContextMatches, type TutorialViewState } from "../core/view-context";
import type { TutorialSeekEntry } from "../core/stage-seek";

export const TUTORIAL_IFRAME_PROTOCOL = "tourkit-v1" as const;

/**
 * Messages an authoring frame posts to the studio. Playback runs in the top
 * window and uses no frames; this protocol only carries the studio recording
 * stream — semantic action ids and structural args, never DOM text or values.
 */
export type TutorialFrameMessage = {
  protocol: typeof TUTORIAL_IFRAME_PROTOCOL;
  type: "tutorial:action";
  action: TutorialSemanticAction;
  context?: TutorialViewContext;
} | { protocol: typeof TUTORIAL_IFRAME_PROTOCOL; type: "tutorial:view"; state: TutorialViewState; ready?: boolean }
  | { protocol: typeof TUTORIAL_IFRAME_PROTOCOL; type: "tutorial:view-restored"; id: string; error?: string }
  | { protocol: typeof TUTORIAL_IFRAME_PROTOCOL; type: "tutorial:seeked"; id: string; error?: string };

export function isTutorialProtocolMessage(value: unknown): value is TutorialFrameMessage {
  return typeof value === "object"
    && value !== null
    && "protocol" in value
    && (value as { protocol?: unknown }).protocol === TUTORIAL_IFRAME_PROTOCOL
    && "type" in value
    && typeof (value as { type?: unknown }).type === "string";
}

export interface TutorialIframeControllerOptions {
  /** Use an exact origin in production. Defaults to the current origin. */
  targetOrigin?: string;
}

/**
 * Studio-side recording listener with an explicit, navigation-only restore request.
 */
export function createTutorialIframeController(
  iframe: HTMLIFrameElement,
  { targetOrigin = window.location.origin }: TutorialIframeControllerOptions = {}
) {
  const listeners = new Set<(action: TutorialSemanticAction, context?: TutorialViewContext) => void>();
  const viewListeners = new Set<(state: TutorialViewState, ready: boolean) => void>();
  let lastView: TutorialViewState = {};
  let lastReady = false;
  const pending = new Map<string, { context: TutorialViewContext; acknowledged: boolean; resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const seeks = new Map<string, { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();

  const onMessage = (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow || event.origin !== targetOrigin || !isTutorialProtocolMessage(event.data)) return;
    if (event.data.type === "tutorial:action") {
      const { action } = event.data;
      const parsed = TutorialViewContextSchema.safeParse(event.data.context);
      listeners.forEach((listener) => listener(action, parsed.success ? parsed.data : undefined));
    } else if (event.data.type === "tutorial:view") {
      const parsed = TutorialViewStateSchema.safeParse(event.data.state);
      if (!parsed.success || (event.data.ready !== undefined && typeof event.data.ready !== "boolean")) return;
      lastView = parsed.data;
      lastReady = event.data.ready !== false;
      viewListeners.forEach((listener) => listener(parsed.data, lastReady));
      for (const [id, request] of pending) {
        if (lastReady && request.acknowledged && tutorialContextMatches(request.context, lastView)) {
          clearTimeout(request.timer); pending.delete(id); request.resolve();
        }
      }
    } else if (event.data.type === "tutorial:seeked") {
      const request = seeks.get(event.data.id);
      if (!request) return;
      clearTimeout(request.timer); seeks.delete(event.data.id);
      if (event.data.error) request.reject(new Error(event.data.error)); else request.resolve();
    } else if (event.data.type === "tutorial:view-restored") {
      const request = pending.get(event.data.id);
      if (!request) return;
      if (event.data.error) {
        clearTimeout(request.timer); pending.delete(event.data.id); request.reject(new Error(event.data.error));
      } else {
        request.acknowledged = true;
        if (lastReady && tutorialContextMatches(request.context, lastView)) {
          clearTimeout(request.timer); pending.delete(event.data.id); request.resolve();
        }
      }
    }
  };
  window.addEventListener("message", onMessage);

  return {
    subscribe(listener: (action: TutorialSemanticAction, context?: TutorialViewContext) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribeView(listener: (state: TutorialViewState, ready: boolean) => void) {
      viewListeners.add(listener);
      iframe.contentWindow?.postMessage({ protocol: TUTORIAL_IFRAME_PROTOCOL, type: "tutorial:view-request" }, targetOrigin);
      return () => viewListeners.delete(listener);
    },
    restoreView(context: TutorialViewContext) {
      const id = crypto.randomUUID();
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error("The stage did not restore this view. Open it manually or use Preview from step.")); }, 10_000);
        pending.set(id, { context, acknowledged: false, resolve, reject, timer });
        iframe.contentWindow?.postMessage({ protocol: TUTORIAL_IFRAME_PROTOCOL, type: "tutorial:view-restore", id, context }, targetOrigin);
      });
    },
    /** Resets the stage to its fixture and replays `entries`; resolves once the stage has them all. */
    seek(entries: TutorialSeekEntry[]) {
      const id = crypto.randomUUID();
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { seeks.delete(id); reject(new Error("The stage did not finish replaying the earlier steps. Use Preview from step instead.")); }, 30_000);
        seeks.set(id, { resolve, reject, timer });
        iframe.contentWindow?.postMessage({ protocol: TUTORIAL_IFRAME_PROTOCOL, type: "tutorial:seek", id, entries }, targetOrigin);
      });
    },
    destroy() {
      window.removeEventListener("message", onMessage);
      listeners.clear();
      viewListeners.clear();
      pending.forEach((request) => { clearTimeout(request.timer); request.reject(new Error("The tutorial stage changed while restoring the view.")); });
      pending.clear();
      seeks.forEach((request) => { clearTimeout(request.timer); request.reject(new Error("The tutorial stage changed while replaying steps.")); });
      seeks.clear();
    },
  };
}

export type TutorialIframeController = ReturnType<typeof createTutorialIframeController>;

