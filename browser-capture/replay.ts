import type { BrowserCaptureAction, BrowserCaptureEvent, BrowserCapturePackage, BrowserCaptureStep, BrowserCaptureTarget } from "./types";
import { parseBrowserCapture } from "./validation";
import { BROWSER_CAPTURE_CSP, sanitizeCaptureEventsForReplay } from "./sanitize";

/** Structural adapter: the core entry point does not import or bundle rrweb. */
export interface BrowserCaptureReplayer {
  iframe: HTMLIFrameElement;
  pause(atMs?: number): void;
  destroy(): void;
  enableInteract?(): void;
  getMirror(): { getNode(id: number): Node | null; getId(node: Node): number };
}

export interface BrowserCaptureObservedAction {
  type: BrowserCaptureAction;
  target?: BrowserCaptureTarget;
  value?: string;
}

export interface BrowserCaptureReplayOptions {
  capture: BrowserCapturePackage;
  root: HTMLElement;
  createReplayer: (events: BrowserCaptureEvent[], options: Record<string, unknown>) => BrowserCaptureReplayer;
  autoAdvance?: boolean;
  onReady?: () => void;
  onStepChange?: (index: number, step: BrowserCaptureStep | undefined) => void;
  onAction?: (action: BrowserCaptureObservedAction) => void;
  onWarning?: (message: string) => void;
  onComplete?: (step: BrowserCaptureStep | undefined) => void;
}

export interface BrowserCaptureRect { x: number; y: number; left: number; top: number; width: number; height: number; right: number; bottom: number }

export interface BrowserCaptureReplayController {
  ready: Promise<void>;
  seekStep(index: number): void;
  next(): void;
  back(): void;
  reset(): void;
  getCurrentStep(): BrowserCaptureStep | undefined;
  getCurrentIndex(): number;
  isComplete(): boolean;
  setAutoAdvance(enabled: boolean): void;
  getTargetElement(): Element | null;
  getTargetRect(): BrowserCaptureRect | null;
  getDocument(): Document | null;
  pickTarget(element: Element): BrowserCaptureTarget | undefined;
  beginTargetPicking(callback: (target: BrowserCaptureTarget) => void): void;
  endTargetPicking(): void;
  getVariables(): Record<string, string>;
  destroy(): void;
}

type StoredValue = { nodeId: number; documentId: string; value: string; checked?: boolean };
function isElement(node: Node | null | undefined): node is Element { return node?.nodeType === 1; }

export function createBrowserCaptureReplay(options: BrowserCaptureReplayOptions): BrowserCaptureReplayController {
  const capture = parseBrowserCapture(options.capture);
  const events = sanitizeCaptureEventsForReplay(capture.events, capture.assets);
  const root = options.root;
  const owner = root.ownerDocument;
  const hostWindow = owner.defaultView;
  if (!hostWindow) throw new Error("Replay needs a browser document.");
  const frame = owner.createElement("iframe");
  frame.title = `${capture.title} — captured interface`;
  frame.setAttribute("sandbox", "allow-same-origin");
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.style.cssText = `display:block;border:0;width:${capture.viewport.width}px;height:${capture.viewport.height}px;transform-origin:top left;`;
  const priorStyles = { position: root.style.position, height: root.style.height, overflow: root.style.overflow };
  root.style.position ||= "relative";
  root.style.overflow = "hidden";
  let replayer: BrowserCaptureReplayer | undefined;
  let index = capture.steps.findIndex((step) => !step.disabled);
  let destroyed = false;
  let seeking = false;
  let pick: ((target: BrowserCaptureTarget) => void) | undefined;
  let scale = 1;
  let complete = false;
  let autoAdvance = options.autoAdvance !== false;
  let activeAtMs = 0;
  let activeDocumentId: string | undefined;
  let seekGeneration = 0;
  let cleanups: (() => void)[] = [];
  const values = new Map<string, StoredValue>();
  let resolveReady!: () => void;
  let rejectReady!: (reason: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  // Destroy-before-load is normal in React strict mode; callers may still await ready.
  void ready.catch(() => {});
  const step = () => capture.steps[index];
  const documentAt = (atMs: number) => {
    let identity: string | undefined;
    let explicitIdentity = false;
    const absolute = (capture.events[0]?.timestamp ?? 0) + atMs;
    for (const event of capture.events) {
      if (event.timestamp > absolute) break;
      const data = event.data && typeof event.data === "object" && !Array.isArray(event.data) ? event.data : undefined;
      if (event.type === 5 && data?.tag === "tourkit-document" && data.payload && typeof data.payload === "object" && !Array.isArray(data.payload) && typeof data.payload.documentId === "string") { identity = data.payload.documentId; explicitIdentity = true; }
      if (!explicitIdentity && event.type === 4 && typeof data?.href === "string") {
        try {
          const url = new URL(data.href);
          const page = capture.pages?.find((candidate) => candidate.origin === url.origin && candidate.path === url.pathname);
          if (page) identity = page.id;
        } catch { /* Source metadata is optional. */ }
      }
    }
    return identity;
  };
  const documentId = () => activeDocumentId ?? step()?.sourceDocumentId ?? step()?.target?.documentId ?? capture.pages?.[0]?.id ?? "default";
  const getDocument = () => replayer?.iframe.contentDocument ?? null;

  function resize() {
    scale = Math.min(1, (root.clientWidth || capture.viewport.width) / capture.viewport.width);
    frame.style.transform = `scale(${scale})`;
    root.style.height = `${capture.viewport.height * scale}px`;
  }
  const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : undefined;
  resizeObserver?.observe(root);
  hostWindow.addEventListener("resize", resize);

  function pickTarget(element: Element): BrowserCaptureTarget | undefined {
    if (!replayer) return undefined;
    const mirror = replayer.getMirror();
    let current: Element | null = element;
    while (current) {
      const nodeId = mirror.getId(current);
      if (nodeId >= 0) {
        const describedLabel = (current.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter(Boolean).map((id) => current!.ownerDocument.getElementById(id)?.textContent ?? "").join(" ").trim();
        const fieldLabels = "labels" in current && (current as HTMLInputElement).labels ? Array.from((current as HTMLInputElement).labels!).map((label) => label.textContent ?? "").join(" ").trim() : "";
        const label = (current.getAttribute("aria-label") || describedLabel || fieldLabels || current.getAttribute("title") || current.textContent || current.tagName.toLowerCase()).trim().slice(0, 500);
        return { nodeId, ...(documentId() === "default" ? {} : { documentId: documentId() }), label };
      }
      current = current.parentElement;
    }
    return undefined;
  }

  function storeValue(element: Element, target: BrowserCaptureTarget | undefined): string | undefined {
    if (!target || !["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName)) return undefined;
    const field = element as HTMLInputElement;
    if (field.type === "password" || field.type === "file") return undefined;
    const checked = ["checkbox", "radio"].includes(field.type) ? field.checked : undefined;
    const value = checked === undefined ? field.value : String(checked);
    values.set(`${documentId()}:${target.nodeId}`, { nodeId: target.nodeId, documentId: documentId(), value, ...(checked === undefined ? {} : { checked }) });
    return value;
  }

  function restoreValues() {
    if (!replayer) return;
    for (const value of values.values()) {
      if (value.documentId !== documentId()) continue;
      const node = replayer.getMirror().getNode(value.nodeId);
      if (!isElement(node) || !["INPUT", "TEXTAREA", "SELECT"].includes(node.tagName)) continue;
      const field = node as HTMLInputElement;
      if (value.checked !== undefined) field.checked = value.checked;
      else field.value = value.value;
    }
  }

  function getTargetElement(): Element | null {
    const target = step()?.target;
    if (complete || !target || !replayer || (target.documentId && target.documentId !== documentId())) return null;
    const node = replayer.getMirror().getNode(target.nodeId);
    if (isElement(node)) return node;
    // Selectors are a repair aid, never silently used to click a different element.
    return null;
  }

  function matches(element: Element, action: BrowserCaptureAction, value?: string): boolean {
    const current = step();
    if (!current || current.disabled || complete) return false;
    const expected = getTargetElement();
    if (current.target && (!expected || !(expected === element || expected.contains(element)))) return false;
    const actionMatches = current.action === action || (current.action === "navigate" && action === "click") || (current.action === "input" && action === "change");
    if (!actionMatches) return false;
    if (current.action === "input" && action === "input") return false;
    return current.value === undefined || current.value === value;
  }

  function observe(event: Event) {
    if (destroyed || seeking) return;
    const original = event.composedPath()[0] ?? event.target;
    const element = isElement(original as Node) ? original as Element : (original as Document)?.documentElement;
    if (!element) return;
    if (event.type === "click" && element.closest("a")) event.preventDefault();
    const target = pickTarget(element);
    if (pick && event.type === "click") {
      event.preventDefault(); event.stopImmediatePropagation();
      if (target) pick(target);
      return;
    }
    const type = event.type as BrowserCaptureAction;
    const value = ["input", "change"].includes(type) ? storeValue(element, target) : undefined;
    options.onAction?.({ type, target, ...(value === undefined ? {} : { value }) });
    if (autoAdvance && matches(element, type, value)) next();
  }

  function bindDocuments() {
    for (const cleanup of cleanups) cleanup();
    cleanups = [];
    const visited = new Set<Document>();
    function bind(doc: Document) {
      if (visited.has(doc)) return;
      visited.add(doc);
      for (const name of ["click", "input", "change", "scroll"]) {
        doc.addEventListener(name, observe, true);
        cleanups.push(() => doc.removeEventListener(name, observe, true));
      }
      const stopSubmit = (event: Event) => event.preventDefault();
      doc.addEventListener("submit", stopSubmit, true);
      cleanups.push(() => doc.removeEventListener("submit", stopSubmit, true));
      const onEnter = (event: KeyboardEvent) => {
        if (event.key === "Enter" && step()?.action === "input" && isElement(event.target as Node)) {
          event.preventDefault();
          const element = event.target as Element;
          const value = storeValue(element, pickTarget(element));
          if (autoAdvance && matches(element, "change", value)) next();
        }
      };
      doc.addEventListener("keydown", onEnter, true);
      cleanups.push(() => doc.removeEventListener("keydown", onEnter, true));
      for (const nested of doc.querySelectorAll("iframe")) {
        try { if (nested.contentDocument) bind(nested.contentDocument); } catch { /* Opaque frames remain inert. */ }
      }
    }
    const doc = getDocument();
    if (doc) bind(doc);
  }

  function seek(atMs: number) {
    if (!replayer || destroyed) return;
    seeking = true;
    activeAtMs = atMs;
    activeDocumentId = documentAt(activeAtMs);
    const generation = ++seekGeneration;
    replayer.pause(atMs);
    replayer.iframe.setAttribute("sandbox", "allow-same-origin");
    replayer.enableInteract?.();
    restoreValues();
    bindDocuments();
    // Replay may flush mutations in a microtask. Ignore restoration-generated events.
    hostWindow!.requestAnimationFrame(() => hostWindow!.requestAnimationFrame(() => {
      if (destroyed || generation !== seekGeneration) return;
      restoreValues(); bindDocuments(); seeking = false;
      if (!complete && step()?.target && !getTargetElement()) options.onWarning?.(`The target for “${step()!.title}” is not present at this checkpoint. Select a new target or adjust the checkpoint.`);
    }));
  }

  function seekStep(nextIndex: number) {
    if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= capture.steps.length) throw new Error("Step index is outside the recording.");
    index = nextIndex;
    complete = false;
    seek(step()!.atMs);
    options.onStepChange?.(index, step());
  }
  function next() {
    const nextIndex = capture.steps.findIndex((candidate, at) => at > index && !candidate.disabled);
    if (nextIndex >= 0) seekStep(nextIndex);
    else if (!complete) {
      complete = true;
      if (step()?.afterMs !== undefined) seek(step()!.afterMs!);
      options.onComplete?.(step());
    }
  }
  function back() {
    for (let at = index - 1; at >= 0; at--) if (!capture.steps[at]!.disabled) { seekStep(at); return; }
  }
  function reset() {
    values.clear();
    complete = false;
    const first = capture.steps.findIndex((candidate) => !candidate.disabled);
    if (first >= 0) seekStep(first); else seek(0);
  }

  function getTargetRect(): BrowserCaptureRect | null {
    const element = getTargetElement();
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    let x = rect.left;
    let y = rect.top;
    let measuredWidth = rect.width;
    let measuredHeight = rect.height;
    let doc: Document | null = element.ownerDocument;
    // rrweb can reconstruct nested frames. Accumulate their origins to our outer frame.
    while (doc && doc !== frame.contentDocument) {
      const embedding: Element | null | undefined = doc.defaultView?.frameElement;
      if (!embedding) break;
      const offset = embedding.getBoundingClientRect();
      const htmlEmbedding = embedding as HTMLElement;
      const frameScaleX = htmlEmbedding.offsetWidth ? offset.width / htmlEmbedding.offsetWidth : 1;
      const frameScaleY = htmlEmbedding.offsetHeight ? offset.height / htmlEmbedding.offsetHeight : 1;
      x = offset.left + (x + htmlEmbedding.clientLeft) * frameScaleX;
      y = offset.top + (y + htmlEmbedding.clientTop) * frameScaleY;
      measuredWidth *= frameScaleX; measuredHeight *= frameScaleY;
      doc = embedding.ownerDocument;
    }
    const frameRect = frame.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    const left = frameRect.left - rootRect.left + x * scale;
    const top = frameRect.top - rootRect.top + y * scale;
    const width = measuredWidth * scale;
    const height = measuredHeight * scale;
    return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height };
  }

  const loadTimeout = hostWindow.setTimeout(() => rejectReady(new Error("The isolated replay document did not load.")), 15_000);
  frame.addEventListener("load", () => {
    if (destroyed || replayer) return;
    try {
      const doc = frame.contentDocument;
      if (!doc) throw new Error("Cannot access the isolated replay document.");
      const stage = doc.createElement("div");
      doc.body.appendChild(stage);
      replayer = options.createReplayer(events, {
        root: stage, mouseTail: false, showWarning: false, showDebug: false,
        skipInactive: false, triggerFocus: false, UNSAFE_replayCanvas: false,
      });
      replayer.iframe.setAttribute("sandbox", "allow-same-origin");
      replayer.iframe.style.border = "0";
      replayer.iframe.style.display = "block";
      seek(step()?.atMs ?? 0);
      hostWindow.clearTimeout(loadTimeout);
      resolveReady();
      options.onReady?.();
      options.onStepChange?.(index, step());
    } catch (error) {
      hostWindow.clearTimeout(loadTimeout);
      const failure = error instanceof Error ? error : new Error("Cannot replay this capture.");
      rejectReady(failure); options.onWarning?.(failure.message);
    }
  });
  // This policy exists before constructing the engine or inserting captured nodes.
  frame.srcdoc = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${BROWSER_CAPTURE_CSP.replace(/"/g, "&quot;")}"><style>html,body{margin:0;padding:0;overflow:hidden;background:#fff}</style></head><body></body></html>`;
  root.appendChild(frame);
  resize();

  return {
    ready, seekStep, next, back, reset, getCurrentStep: step, getCurrentIndex: () => index, isComplete: () => complete,
    setAutoAdvance: (enabled) => { autoAdvance = enabled; },
    getTargetElement, getTargetRect, getDocument, pickTarget,
    beginTargetPicking: (callback) => { pick = callback; }, endTargetPicking: () => { pick = undefined; },
    getVariables: () => Object.fromEntries([...values].map(([key, entry]) => [key, entry.value])),
    destroy() {
      if (destroyed) return;
      destroyed = true; ++seekGeneration;
      hostWindow.clearTimeout(loadTimeout); rejectReady(new Error("Replay was closed before loading."));
      for (const cleanup of cleanups) cleanup();
      resizeObserver?.disconnect(); hostWindow.removeEventListener("resize", resize);
      replayer?.destroy(); frame.remove();
      Object.assign(root.style, priorStyles);
      values.clear();
    },
  };
}
