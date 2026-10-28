import type {
  TutorialJsonValue,
  TutorialVisualReference
} from "./types";

export interface TutorialVisualRecorderContext {
  nowMs: () => number;
}

/** Adapter point for rrweb or another full visual recorder in a host app. */
export interface TutorialVisualRecorderAdapter {
  start(context: TutorialVisualRecorderContext): void | Promise<void>;
  stop(): void | TutorialVisualReference | undefined | Promise<TutorialVisualReference | undefined>;
  pause?(): void;
  resume?(): void;
  clear?(): void;
}

export class NoopTutorialVisualRecorder implements TutorialVisualRecorderAdapter {
  start(): void {}
  stop(): undefined {
    return undefined;
  }
}

interface DomPointerReference {
  atMs: number;
  anchor?: string;
  tag: string;
  role?: string;
  rect: { x: number; y: number; width: number; height: number };
  viewport: { width: number; height: number };
}

export interface DomPointerVisualRecorderOptions {
  root?: Document | HTMLElement;
  anchorAttribute?: string;
  blockedSelector?: string;
}

/**
 * Privacy-preserving fallback when rrweb is not installed.
 *
 * It records only pointer target geometry and stable tutorial anchors. It never
 * records text, input values, HTML, key presses, or form data, and ignores
 * anything inside a privacy-blocked subtree. This is a visual editing reference,
 * not a deterministic application replay.
 */
export class DomPointerVisualRecorder implements TutorialVisualRecorderAdapter {
  private readonly root: Document | HTMLElement;
  private readonly anchorAttribute: string;
  private readonly blockedSelector: string;
  private references: DomPointerReference[] = [];
  private nowMs: (() => number) | undefined;
  private listening = false;
  private paused = false;

  constructor(options: DomPointerVisualRecorderOptions = {}) {
    if (!options.root && typeof document === "undefined") {
      throw new Error("DomPointerVisualRecorder requires a browser document or an explicit root.");
    }
    this.root = options.root ?? document;
    this.anchorAttribute = options.anchorAttribute ?? "data-tutorial-id";
    this.blockedSelector =
      options.blockedSelector ?? "[data-tutorial-private], [data-private]";
  }

  start(context: TutorialVisualRecorderContext): void {
    this.clear();
    this.paused = false;
    this.nowMs = context.nowMs;
    this.root.addEventListener("pointerdown", this.handlePointerDown as EventListener, true);
    this.listening = true;
  }

  stop(): TutorialVisualReference {
    this.detach();
    return {
      kind: "dom-pointer-reference",
      version: 1,
      data: {
        privacy: "geometry-only",
        events: this.references as unknown as TutorialJsonValue
      }
    };
  }

  clear(): void {
    this.detach();
    this.references = [];
    this.nowMs = undefined;
    this.paused = false;
  }

  pause(): void { this.paused = true; }
  resume(): void { this.paused = false; }

  private detach(): void {
    if (!this.listening) return;
    this.root.removeEventListener("pointerdown", this.handlePointerDown as EventListener, true);
    this.listening = false;
  }

  private readonly handlePointerDown = (event: Event): void => {
    if (this.paused) return;
    const element = event.target instanceof Element ? event.target : undefined;
    if (!element || element.closest(this.blockedSelector)) return;

    const anchored = element.closest(`[${this.anchorAttribute}]`);
    const anchor = anchored?.getAttribute(this.anchorAttribute)?.trim() || undefined;
    const rect = element.getBoundingClientRect();
    const view = element.ownerDocument.defaultView;

    this.references.push({
      atMs: Math.max(0, Math.round(this.nowMs?.() ?? 0)),
      anchor,
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute("role") || undefined,
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      },
      viewport: {
        width: view?.innerWidth ?? 0,
        height: view?.innerHeight ?? 0
      }
    });
  };
}

