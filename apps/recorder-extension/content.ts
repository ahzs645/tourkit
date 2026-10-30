import { record } from "@rrweb/record";
import type { BrowserCaptureEvent } from "../../browser-capture/types";
import { CHANNEL, MASKED_TEXT_SELECTOR, PRIVATE_SELECTOR, type RecorderSettings, type Rect, type ScreenshotPreparation } from "./protocol";
import { createCapturePrivacyState, privatizeEvent, privateResourceKey, rewriteCss, safeSource } from "./privacy";

declare global { interface Window { __tourkitRecorderInstalled?: boolean } }

function installRecorder() {
  if (window.__tourkitRecorderInstalled || window.top !== window) return;
  window.__tourkitRecorderInstalled = true;
  let stopRecord: (() => void) | undefined;
  let sessionId = "";
  let documentId = "";
  let settings: RecorderSettings;
  let sequence = 0;
  let segmentId = "";
  let starting: Promise<void> | undefined;
  let events: BrowserCaptureEvent[] = [];
  let sendChain: Promise<unknown> = Promise.resolve();
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let afterTimer: ReturnType<typeof setTimeout> | undefined;
  let maxAfterTimer: ReturnType<typeof setTimeout> | undefined;
  let observer: MutationObserver | undefined;
  let revision = 0;
  let currentStepId: string | undefined;
  let lastSnapshotAt = 0;
  let lastInput: { target: EventTarget | null; at: number; stepId: string } | undefined;
  let indicator: HTMLDivElement | undefined;
  let prepared: ScreenshotPreparation | undefined;
  let preparingStop = false;
  let privacyState = createCapturePrivacyState();
  const assets = new Set<string>();
  const blockedResourceKeys = new Set<string>();
  const assetRequests = new Set<Promise<unknown>>();
  const warned = new Set<string>();
  const blockedHosts = new Set<Element>();
  const listeners: Array<() => void> = [];

  const send = (message: Record<string, unknown>) => chrome.runtime.sendMessage({ channel: CHANNEL, sessionId, documentId, ...message });
  function report(code: string, message: string) {
    if (warned.has(code)) return;
    warned.add(code);
    void send({ type: "warning", code, message }).catch(() => {});
  }
  function isPrivate(element: Element): boolean {
    const selectors = `${PRIVATE_SELECTOR},${MASKED_TEXT_SELECTOR}${settings?.privateSelector ? `,${settings.privateSelector}` : ""}`;
    try {
      if (element.closest(selectors)) return true;
      let root = element.getRootNode();
      while (root instanceof ShadowRoot) {
        if (root.host.closest(selectors)) return true;
        root = root.host.getRootNode();
      }
    } catch { return true; }
    return false;
  }
  function inspectOpaqueContent() {
    for (const frame of document.querySelectorAll("iframe,frame")) {
      try {
        const child = (frame as HTMLIFrameElement).contentDocument;
        if (!child || !child.documentElement) throw new Error("opaque");
      } catch {
        frame.setAttribute("data-tourkit-capture-blocked", ""); blockedHosts.add(frame);
        report("opaque-frame", "A cross-origin or restricted frame was excluded and covered in screenshots. Record its site separately if this content is part of the tutorial.");
      }
    }
    // rrweb captures open roots. Chrome can see closed roots, but this adapter
    // deliberately marks them rather than claiming to reconstruct their contents.
    for (const element of document.querySelectorAll("*")) {
      if (element === indicator || indicator?.contains(element)) continue;
      if (!element.shadowRoot && chrome.dom?.openOrClosedShadowRoot(element as HTMLElement)) {
        element.setAttribute("data-tourkit-capture-blocked", ""); blockedHosts.add(element);
        report("closed-shadow-root", "A closed Shadow DOM component was replaced with a placeholder. Its pixels are masked in screenshots.");
      }
    }
    if (document.querySelector("canvas")) report("canvas-snapshot", "Canvas and WebGL internals are not reconstructed as DOM. Screenshot checkpoints preserve their visible appearance; use a separate recording for interactions inside them.");
    if (document.querySelector("video,audio")) report("media-snapshot", "Live audio and video streams are not included. Screenshots may show the current video frame.");
  }
  function listen<K extends keyof DocumentEventMap>(name: K, listener: (event: DocumentEventMap[K]) => void) {
    document.addEventListener(name, listener, true);
    listeners.push(() => document.removeEventListener(name, listener, true));
  }
  function flush(): Promise<unknown> {
    clearTimeout(flushTimer);
    if (!events.length) return sendChain;
    const batch = events.splice(0);
    const chunkId = `${sessionId}:${documentId}:${segmentId}:${String(sequence++).padStart(9, "0")}`;
    const data = { type: "events", chunkId, events: batch };
    sendChain = sendChain.then(async () => {
      let failure: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const result = await send(data);
          if (!result?.ok) throw new Error(result?.error || "The recording could not be saved.");
          return;
        } catch (error) { failure = error; }
      }
      if (indicator) indicator.textContent = "TourKit · Save failed — reopen recorder";
      stopRecord?.(); stopRecord = undefined;
      void send({ type: "fatal", message: "The recorder could not persist an event chunk. Recording stopped; previously acknowledged data is recoverable. Resume only after exporting and checking the saved recording." }).catch(() => {});
      throw failure;
    });
    // Preserve the rejected chain so later messages cannot skip lost events.
    void sendChain.catch(() => {});
    return sendChain;
  }
  function emit(event: BrowserCaptureEvent) {
    collectPrivateResourceKeys();
    const masked = privatizeEvent(event, location.href, (url) => {
      if (blockedResourceKeys.has(privateResourceKey(url))) return false;
      if (/^https?:/.test(url)) assets.add(url);
    }, privacyState);
    events.push(masked);
    if (event.type === 2) lastSnapshotAt = event.timestamp;
    if (events.length >= 60) void flush();
    else if (!flushTimer) flushTimer = setTimeout(() => { flushTimer = undefined; void flush(); }, 120);
  }
  function collectPrivateResourceKeys() {
    const selectors = `${PRIVATE_SELECTOR},${MASKED_TEXT_SELECTOR}${settings?.privateSelector ? `,${settings.privateSelector}` : ""}`;
    const mark = (url: string) => {
      if (!url || url.startsWith("#")) return;
      try { blockedResourceKeys.add(privateResourceKey(new URL(url, location.href).href)); } catch { /* Not a resource URL. */ }
    };
    const visit = (root: Document | ShadowRoot) => {
      const privateNodes = new Set<Element>();
      for (const parent of root.querySelectorAll(selectors)) {
        if (parent === indicator) continue;
        privateNodes.add(parent);
        for (const child of parent.querySelectorAll("*")) privateNodes.add(child);
        const shadow = parent.shadowRoot ?? chrome.dom?.openOrClosedShadowRoot(parent as HTMLElement);
        if (shadow) for (const child of shadow.querySelectorAll("*")) privateNodes.add(child);
      }
      for (const node of privateNodes) {
        if (node instanceof HTMLImageElement) { mark(node.currentSrc); mark(node.src); }
        if (node instanceof HTMLVideoElement) mark(node.poster);
        const style = getComputedStyle(node);
        for (const property of ["background-image", "border-image-source", "mask-image", "list-style-image", "content", "cursor"]) rewriteCss(style.getPropertyValue(property), location.href, (url) => { mark(url); return false; });
      }
      for (const host of root.querySelectorAll("*")) if (host.shadowRoot) visit(host.shadowRoot);
    };
    visit(document);
  }
  function collectAssets(): Promise<unknown> {
    collectPrivateResourceKeys();
    for (const image of document.images) if (!isPrivate(image) && image.currentSrc && /^https?:/.test(image.currentSrc)) assets.add(image.currentSrc);
    for (const stylesheet of document.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"]')) if (/^https?:/.test(stylesheet.href)) assets.add(stylesheet.href);
    const urls = [...assets].filter((url) => !blockedResourceKeys.has(privateResourceKey(url))).slice(0, 300);
    for (const url of urls) assets.delete(url);
    const task = send({ type: "assets", urls, blockedResourceKeys: [...blockedResourceKeys].slice(0, 5000) }).catch(() => {}).finally(() => assetRequests.delete(task));
    assetRequests.add(task);
    return task;
  }
  function targetFor(element: Element) {
    const nodeId = record.mirror.getId(element);
    if (nodeId < 0) return undefined;
    const label = labelFor(element);
    const stable = element.getAttribute("data-tutorial") ?? element.getAttribute("data-testid");
    const selector = stable && /^[a-zA-Z0-9_-]{1,80}$/.test(stable)
      ? `[${element.hasAttribute("data-tutorial") ? "data-tutorial" : "data-testid"}="${stable}"]` : undefined;
    return { nodeId, documentId, label, ...(selector ? { selector } : {}) };
  }
  function labelFor(element: Element): string {
    if (isPrivate(element)) return "Private element";
    if (element.matches("input,textarea,select,[contenteditable]")) return element.getAttribute("aria-label")?.slice(0, 80) || "field";
    return (element.getAttribute("aria-label") || element.textContent || element.tagName.toLowerCase()).trim().replace(/\s+/g, " ").slice(0, 80) || "element";
  }
  function actionElement(event: Event): Element | undefined {
    const element = event.composedPath().find((item) => item instanceof Element) as Element | undefined;
    if (!element || indicator?.contains(element) || element === indicator || isPrivate(element)) return;
    return element.closest("button,a,input,textarea,select,[role=button],[contenteditable],label") ?? element;
  }
  function scheduleResult(id: string) {
    clearTimeout(afterTimer);
    afterTimer = setTimeout(() => {
      afterTimer = undefined; clearTimeout(maxAfterTimer); maxAfterTimer = undefined;
      void checkpointResult(id).catch(() => {});
    }, 420);
    maxAfterTimer ??= setTimeout(() => {
      clearTimeout(afterTimer); afterTimer = undefined; maxAfterTimer = undefined;
      if (currentStepId) void checkpointResult(currentStepId).catch(() => {});
    }, 1800);
  }
  async function checkpointResult(id: string) {
    if (!stopRecord || preparingStop) return;
    record.takeFullSnapshot(true);
    record.addCustomEvent("tourkit-checkpoint", {});
    const afterAt = Math.max(lastSnapshotAt, Date.now());
    await flush();
    await send({ type: "step-result", stepId: id, afterAt });
    void collectAssets();
    if (settings.screenshots) void send({ type: "screenshot", stepId: id, captureRevision: revision }).catch(() => {});
  }
  function addAction(event: Event, action: "click" | "input" | "change") {
    if (!stopRecord || preparingStop) return;
    const element = actionElement(event);
    if (!element) return;
    if (action === "change" && lastInput?.target === element) {
      scheduleResult(lastInput.stepId); lastInput = undefined; return;
    }
    if (action === "input" && lastInput?.target === element && Date.now() - lastInput.at < 1200) {
      lastInput.at = Date.now(); scheduleResult(lastInput.stepId); return;
    }
    record.takeFullSnapshot(true);
    const at = lastSnapshotAt;
    const target = targetFor(element);
    const id = crypto.randomUUID();
    currentStepId = id;
    if (action === "input") lastInput = { target: element, at: Date.now(), stepId: id };
    const label = labelFor(element);
    const title = action === "click" ? `Select ${label}` : action === "change" ? `Change ${label}` : `Complete ${label}`;
    void flush().then(() => send({ type: "step", step: {
      id, title, instruction: `${title}.`, action, at, sourceDocumentId: documentId,
      ...(target ? { target } : {}),
    } })).catch(() => {});
    scheduleResult(id);
  }
  function rectangles(): Rect[] {
    const result: Rect[] = [];
    const selector = `input,textarea,select,${MASKED_TEXT_SELECTOR},${PRIVATE_SELECTOR}${settings.privateSelector ? `,${settings.privateSelector}` : ""}`;
    const visit = (root: Document | ShadowRoot, offsetX = 0, offsetY = 0) => {
      const cover = (element: Element, descendants = false) => {
        if (element === indicator || indicator?.contains(element)) return;
        for (const box of element.getClientRects()) if (box.width && box.height) result.push({ x: box.x + offsetX, y: box.y + offsetY, width: box.width, height: box.height });
        if (descendants) {
          for (const child of element.querySelectorAll("*")) cover(child);
          const shadow = element.shadowRoot ?? chrome.dom?.openOrClosedShadowRoot(element as HTMLElement);
          if (shadow) for (const child of shadow.querySelectorAll("*")) cover(child);
        }
      };
      for (const element of root.querySelectorAll(selector)) {
        cover(element, !element.matches("input,textarea,select"));
      }
      for (const element of root.querySelectorAll("*")) {
        if (element.shadowRoot) visit(element.shadowRoot, offsetX, offsetY);
        else if (chrome.dom?.openOrClosedShadowRoot(element as HTMLElement)) {
          cover(element, true);
        }
        if (element instanceof HTMLIFrameElement) {
          const box = element.getBoundingClientRect();
          // Mask every embedded frame in screenshots. Pixel coordinates inside
          // transformed/zoomed frames cannot be safely inferred from DOM offsets.
          result.push({ x: box.x + offsetX, y: box.y + offsetY, width: box.width, height: box.height });
        }
      }
    };
    visit(document);
    return result;
  }
  async function prepareScreenshot(expectedDocumentId: string, expectedRevision: number): Promise<ScreenshotPreparation> {
    if (!stopRecord) throw new Error("Recording is not active.");
    if (expectedDocumentId !== documentId || expectedRevision !== revision) throw new Error("The requested checkpoint has already changed.");
    if (indicator) indicator.style.visibility = "hidden";
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    prepared = { token: crypto.randomUUID(), masks: rectangles(), width: innerWidth, height: innerHeight,
      scrollX, scrollY, revision };
    return prepared;
  }
  function validateScreenshot(token: string): boolean {
    const prior = prepared;
    const valid = Boolean(prior && prior.token === token && prior.revision === revision && prior.width === innerWidth && prior.height === innerHeight
      && prior.scrollX === scrollX && prior.scrollY === scrollY && JSON.stringify(prior.masks) === JSON.stringify(rectangles()));
    prepared = undefined;
    if (indicator) indicator.style.visibility = "visible";
    return valid;
  }
  async function finish() {
    clearTimeout(afterTimer); clearTimeout(maxAfterTimer); afterTimer = undefined; maxAfterTimer = undefined;
    if (stopRecord) {
      record.takeFullSnapshot(true);
      record.addCustomEvent("tourkit-stop", {});
    }
    stopRecord?.(); stopRecord = undefined;
    observer?.disconnect();
    for (const remove of listeners.splice(0)) remove();
    indicator?.remove(); indicator = undefined;
    for (const host of blockedHosts) host.removeAttribute("data-tourkit-capture-blocked");
    blockedHosts.clear();
    await flush();
  }
  async function prepareStop() {
    if (!stopRecord) return;
    preparingStop = true;
    clearTimeout(afterTimer); clearTimeout(maxAfterTimer); afterTimer = undefined; maxAfterTimer = undefined;
    record.takeFullSnapshot(true);
    record.addCustomEvent("tourkit-final-checkpoint", {});
    await flush();
    if (currentStepId) {
      await send({ type: "step-result", stepId: currentStepId, afterAt: Date.now() });
      if (settings.screenshots) await send({ type: "screenshot", stepId: currentStepId, captureRevision: revision });
    }
    void collectAssets();
    let assetWait: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.allSettled([...assetRequests]),
      new Promise<void>((resolve) => { assetWait = setTimeout(resolve, 5000); }),
    ]);
    clearTimeout(assetWait);
  }
  async function begin() {
    const config = await chrome.runtime.sendMessage({ channel: CHANNEL, type: "hello", viewport: { width: innerWidth, height: innerHeight, devicePixelRatio }, source: safeSource(location.href) });
    if (!config?.ok || !config.sessionId || stopRecord) return;
    sessionId = config.sessionId; documentId = config.documentId; settings = config.settings;
    sequence = 0; segmentId = crypto.randomUUID(); events = []; sendChain = Promise.resolve(); warned.clear(); preparingStop = false;
    privacyState = createCapturePrivacyState(); lastInput = undefined; currentStepId = undefined; prepared = undefined; blockedResourceKeys.clear(); assets.clear();
    inspectOpaqueContent();
    indicator = document.createElement("div"); indicator.id = "tourkit-recorder-indicator";
    indicator.setAttribute("data-tourkit-capture-blocked", "");
    indicator.textContent = "TourKit · Recording";
    Object.assign(indicator.style, { position: "fixed", top: "12px", right: "12px", zIndex: "2147483647", background: "#123349", color: "white", padding: "9px 14px", font: "600 12px system-ui", borderRadius: "24px", boxShadow: "0 2px 12px #0003", pointerEvents: "none" });
    document.documentElement.append(indicator);
    observer = new MutationObserver((mutations) => {
      if (mutations.some((item) => item.target !== indicator && !indicator?.contains(item.target))) {
        revision++;
        if (currentStepId && afterTimer) scheduleResult(currentStepId);
      }
    });
    observer.observe(document, { childList: true, subtree: true, attributes: true, characterData: true });
    emit({ type: 5, timestamp: Date.now(), data: { tag: "tourkit-document", payload: { documentId } } });
    stopRecord = record({
      emit: (event) => emit(event as BrowserCaptureEvent),
      maskAllInputs: true, maskInputFn: () => "••••", maskTextFn: () => "••••",
      maskTextSelector: MASKED_TEXT_SELECTOR,
      blockSelector: `${PRIVATE_SELECTOR}${settings.privateSelector ? `,${settings.privateSelector}` : ""}`,
      slimDOMOptions: { script: true, comment: true, headMetaDescKeywords: true, headMetaSocial: true, headMetaRobots: true, headMetaHttpEquiv: true, headMetaAuthorship: true, headMetaVerification: true },
      recordCanvas: false, recordCrossOriginIframes: false, inlineStylesheet: true, collectFonts: false,
      sampling: { mousemove: false, mouseInteraction: { MouseMove: false }, scroll: 150, input: "last" },
      checkoutEveryNms: 15000,
      errorHandler(error) { report("rrweb-error", `Some page content could not be recorded: ${String(error).slice(0, 180)}`); return true; },
    });
    listen("click", (event) => addAction(event, "click"));
    listen("beforeinput", (event) => addAction(event, "input"));
    listen("change", (event) => addAction(event, "change"));
    listen("input", () => { revision++; });
    listen("scroll", () => { revision++; });
    const resize = () => { revision++; };
    window.addEventListener("resize", resize); listeners.push(() => window.removeEventListener("resize", resize));
    const unload = () => { void flush(); };
    window.addEventListener("pagehide", unload); listeners.push(() => window.removeEventListener("pagehide", unload));
    await flush();
    const initialId = crypto.randomUUID();
    currentStepId = initialId;
    await send({ type: "step", step: { id: initialId, title: config.isFirstPage ? "Start here" : "Continue on this page", instruction: "Review this screen, then continue.", action: config.isFirstPage ? "continue" : "navigate", at: lastSnapshotAt, sourceDocumentId: documentId } });
    void collectAssets();
    if (settings.screenshots) void send({ type: "screenshot", stepId: initialId, captureRevision: revision }).catch(() => {});
  }
  function boot(): Promise<void> {
    if (stopRecord) return Promise.resolve();
    starting ??= begin().finally(() => { starting = undefined; });
    return starting;
  }

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || message?.channel !== CHANNEL) return;
    if (message.type === "prepare-stop") { void prepareStop().then(() => respond({ ok: true })).catch((error) => respond({ ok: false, error: String(error) })); return true; }
    if (message.type === "stop-content") { void finish().then(() => respond({ ok: true })).catch((error) => respond({ ok: false, error: String(error) })); return true; }
    if (message.type === "start-content") { void boot().then(() => respond({ ok: true })).catch((error) => respond({ ok: false, error: String(error) })); return true; }
    if (message.type === "prepare-screenshot") { void prepareScreenshot(message.documentId, message.captureRevision).then((value) => respond({ ok: true, preparation: value })).catch((error) => respond({ ok: false, error: String(error) })); return true; }
    if (message.type === "validate-screenshot") { respond({ ok: true, valid: validateScreenshot(message.token) }); return; }
    if (message.type === "collect-assets") { void collectAssets(); respond({ ok: true }); }
  });
  void boot().catch(() => {});
}

installRecorder();
