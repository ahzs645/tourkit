import { CHANNEL, MAX_ALL_ASSET_BYTES, MAX_ASSET_BYTES, addWarning, type RecordingSession, type ScreenshotPreparation, type StoredStep } from "./protocol";
import { appendChunk, getSession, listSessions, putAsset, putSession, updateSession } from "./storage";
import { privateResourceKey, redactionRects, resourceKey, rewriteCss, safeSource } from "./privacy";
import type { BrowserCaptureEvent } from "../../browser-capture/types";

const activeKey = "tourkitActiveRecording";
let screenshotQueue: Promise<unknown> = Promise.resolve();
let lastScreenshotAt = 0;
let assetQueue: Promise<unknown> = Promise.resolve();
const attemptedAssets = new Set<string>();

async function activeSession(): Promise<RecordingSession | undefined> {
  const stored = await chrome.storage.local.get(activeKey);
  return typeof stored[activeKey] === "string" ? getSession(stored[activeKey]) : undefined;
}
const contentMessage = (tabId: number, message: object) => chrome.tabs.sendMessage(tabId, { channel: CHANNEL, ...message }, { frameId: 0 });
async function report(id: string, code: string, message: string, stepId?: string) {
  await updateSession(id, (session) => addWarning(session, { code, message, ...(stepId ? { stepId } : {}) }));
}

async function inject(session: RecordingSession) {
  try {
    await chrome.scripting.executeScript({ target: { tabId: session.tabId, frameIds: [0] }, files: ["content.js"] });
    const response = await contentMessage(session.tabId, { type: "start-content" });
    if (!response?.ok) throw new Error(response?.error || "The page recorder did not start.");
  } catch (error) {
    await updateSession(session.id, (value) => {
      value.status = "interrupted";
      addWarning(value, { code: "site-access", message: "Recording paused because this page could not be accessed. Open the extension on the destination site and select Resume. Browser internal pages cannot be recorded." });
    });
    await badge("!");
    throw error;
  }
}

async function badge(text: string) {
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color: text === "REC" ? "#176b59" : "#8d5916" });
}

async function transition(id: string, status: "paused" | "stopped") {
  const session = await getSession(id);
  if (!session) throw new Error("Recording was not found.");
  if (session.status === "recording") {
    try {
      await contentMessage(session.tabId, { type: "prepare-stop" });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const drained = await Promise.race([
        Promise.allSettled([screenshotQueue, assetQueue]).then(() => true),
        new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), 25000); }),
      ]);
      clearTimeout(timer);
      if (!drained) await report(id, "pending-resource-work", "Some resource or screenshot work did not finish within 25 seconds of stopping. This recording is recoverable, but inspect missing assets before publishing; reopening it later may include completed resources.");
      const stopped = await contentMessage(session.tabId, { type: "stop-content" });
      if (!stopped?.ok) throw new Error("The final event chunk did not finish saving.");
    }
    catch { await report(id, "capture-disconnected", "The page disconnected before the final flush. Previously acknowledged chunks remain available."); }
  }
  await updateSession(id, (value) => {
    value.status = status;
    const last = value.steps.at(-1);
    if (status === "stopped" && value.lastEventAt && last && value.lastEventAt > last.at) {
      value.steps.push({ id: crypto.randomUUID(), title: "Result", instruction: "Review the result of the recorded workflow.", action: "continue", at: value.lastEventAt,
        ...(value.lastDocumentId ? { sourceDocumentId: value.lastDocumentId } : {}) });
    }
  });
  await badge(status === "paused" ? "Ⅱ" : "");
}

async function start(tabId: number, title: string, screenshots: boolean, privateSelector: string) {
  const prior = await activeSession();
  if (prior?.status === "recording") await transition(prior.id, "paused");
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url || !/^https?:/.test(tab.url)) throw new Error("Open an HTTP or HTTPS page, then start the recorder from the extension button.");
  const now = new Date().toISOString();
  const session: RecordingSession = {
    id: crypto.randomUUID(), title: title.trim().slice(0, 120) || "Untitled recording", createdAt: now, updatedAt: now,
    status: "recording", tabId, settings: { screenshots, privateSelector: privateSelector.slice(0, 1000), advanced: false },
    viewport: { width: 1280, height: 720 }, pages: [], steps: [], warnings: [], eventCount: 0, eventBytes: 0,
    assetBytes: 0, screenshotBytes: 0, missingAssetOrigins: [],
  };
  await putSession(session);
  await chrome.storage.local.set({ [activeKey]: session.id });
  await inject(session);
  await badge("REC");
  return session.id;
}

async function resume(id: string, tabId: number) {
  const prior = await activeSession();
  if (prior?.status === "recording") await transition(prior.id, "paused");
  const session = await updateSession(id, (value) => {
    value.tabId = tabId; value.status = "recording";
    addWarning(value, { code: "resumed-capture", message: "This recording contains a pause or interruption. Review the transition between recording segments in Studio." });
  });
  await chrome.storage.local.set({ [activeKey]: id });
  await inject(session); await badge("REC");
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 32768) binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
  return btoa(binary);
}

async function screenshot(sessionId: string, stepId: string, documentId: string, captureRevision: number) {
  const session = await getSession(sessionId);
  if (!session || session.status !== "recording" || !session.settings.screenshots) return;
  if (session.screenshotBytes >= 10 * 1024 * 1024) { await report(sessionId, "screenshot-limit", "Screenshot storage reached 10 MiB. DOM recording continues; screenshots can be added in Studio."); return; }
  const tab = await chrome.tabs.get(session.tabId);
  const [active] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
  if (active?.id !== session.tabId) { await report(sessionId, "screenshot-inactive", "A screenshot was skipped because the recording tab was not active.", stepId); return; }
  // A checkpoint screenshot is deliberately rate-limited below Chrome's 2/s cap.
  const delay = Math.max(0, 650 - (Date.now() - lastScreenshotAt));
  if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
  const response = await contentMessage(session.tabId, { type: "prepare-screenshot", documentId, captureRevision });
  if (!response?.ok) throw new Error("The page could not prepare a private screenshot.");
  const prepared = response.preparation as ScreenshotPreparation;
  if (!prepared || !Array.isArray(prepared.masks) || prepared.masks.length > 25000 || !(prepared.width > 0 && prepared.height > 0)) throw new Error("Screenshot redaction information was invalid.");
  let dataUrl: string;
  let stillStable = false;
  try {
    lastScreenshotAt = Date.now();
    dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  } finally {
    const checked = await contentMessage(session.tabId, { type: "validate-screenshot", token: prepared.token }).catch(() => undefined);
    stillStable = checked?.valid === true;
  }
  const [afterActive] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
  if (!stillStable || afterActive?.id !== session.tabId) {
    await report(sessionId, "screenshot-changing-layout", "A screenshot was discarded because the page changed while privacy masks were being measured. DOM capture is still available.", stepId); return;
  }
  const bitmap = await createImageBitmap(await (await fetch(dataUrl!)).blob());
  const scale = Math.min(1, 1600 / bitmap.width, 1600 / bitmap.height);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Screenshot redaction is not available in this browser.");
  context.drawImage(bitmap, 0, 0, width, height); bitmap.close();
  context.fillStyle = "#172738";
  for (const rect of redactionRects(prepared.masks, width, height, width / prepared.width, height / prepared.height)) context.fillRect(rect.x, rect.y, rect.width, rect.height);
  const blob = await canvas.convertToBlob({ type: "image/png" });
  if (blob.size > 3 * 1024 * 1024) { await report(sessionId, "screenshot-too-large", "A screenshot exceeded the 3 MiB checkpoint limit and was omitted.", stepId); return; }
  const safeDataUrl = `data:image/png;base64,${base64(new Uint8Array(await blob.arrayBuffer()))}`;
  await updateSession(sessionId, (value) => {
    const step = value.steps.find((item) => item.id === stepId);
    if (!step) return;
    value.screenshotBytes -= step.screenshot?.dataUrl.length ?? 0;
    step.screenshot = { dataUrl: safeDataUrl, width, height, alt: `Captured result: ${step.title}`.slice(0, 500), caption: "Visible viewport after the recorded action; input values and private regions are covered.", provenance: { engine: "native", capturedAt: new Date().toISOString() } };
    step.screenshotAt = Date.now();
    value.screenshotBytes += safeDataUrl.length;
  });
}

function enqueueScreenshot(id: string, stepId: string, documentId: string, captureRevision: number) {
  screenshotQueue = screenshotQueue.then(() => screenshot(id, stepId, documentId, captureRevision)).catch(async () => {
    await report(id, "screenshot-unavailable", "A private screenshot could not be captured. No unredacted screenshot was saved; DOM capture continues.", stepId).catch(() => {});
  });
}

async function fetchAsset(sessionId: string, raw: string, depth = 0, deadline = Date.now() + 100_000): Promise<void> {
  let url: URL;
  try { url = new URL(raw); } catch { return; }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || depth > 4 || Date.now() >= deadline) return;
  const key = resourceKey(url.href);
  const attemptKey = `${sessionId}:${key}`;
  if (attemptedAssets.has(attemptKey)) return;
  const session = await getSession(sessionId);
  if (session?.blockedResourceKeys?.includes(key)) return;
  if (!session || session.assetBytes >= MAX_ALL_ASSET_BYTES) {
    if (session) await report(sessionId, "asset-limit", "The asset bundle reached 12 MiB. Some resources are omitted; check offline replay before publishing.");
    return;
  }
  const currentOrigin = session.pages.at(-1)?.origin;
  if (url.origin !== currentOrigin && !(await chrome.permissions.contains({ origins: [`${url.origin}/*`] }))) {
    await updateSession(sessionId, (value) => {
      if (!value.missingAssetOrigins.includes(url.origin)) value.missingAssetOrigins.push(url.origin);
      addWarning(value, { code: "asset-permission", message: `Assets from ${url.origin} need site access. Use Grant asset access in the recording dashboard, then resume the source page to collect them.` });
    });
    return;
  }
  attemptedAssets.add(attemptKey);
  try {
    const response = await fetch(url.href, { credentials: "omit", signal: AbortSignal.timeout(Math.max(1, Math.min(10000, deadline - Date.now()))), referrerPolicy: "no-referrer" });
    if (!response.ok) throw new Error("response");
    const headerSize = Number(response.headers.get("content-length") || 0);
    if (headerSize > MAX_ASSET_BYTES) throw new Error("size");
    let mime = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (["application/font-woff", "application/x-font-woff"].includes(mime)) mime = "font/woff";
    if (mime === "application/octet-stream") {
      if (/\.woff2$/i.test(url.pathname)) mime = "font/woff2";
      else if (/\.woff$/i.test(url.pathname)) mime = "font/woff";
      else if (/\.ttf$/i.test(url.pathname)) mime = "font/ttf";
    }
    if (!/^(image\/(png|jpeg|webp|gif)|font\/(woff2?|ttf|otf)|text\/css)$/.test(mime)) {
      await report(sessionId, "unsupported-asset", `A resource from ${url.origin} has an unsupported type (${mime || "unknown"}). Scripts, HTML and external SVG files are not executed or bundled by this recorder.`); return;
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("body");
    const chunks: Uint8Array[] = []; let bytes = 0;
    while (true) {
      const item = await reader.read(); if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > MAX_ASSET_BYTES) { await reader.cancel(); throw new Error("size"); }
      chunks.push(item.value);
    }
    let content = new Uint8Array(bytes); let offset = 0;
    for (const chunk of chunks) { content.set(chunk, offset); offset += chunk.length; }
    // A private region may appear while the response is in flight. Re-read the
    // durable exclusions before retaining either the resource or nested URLs.
    const current = await getSession(sessionId);
    if (!current || current.blockedResourceKeys?.includes(key)) return;
    const children: string[] = [];
    if (mime === "text/css") content = new TextEncoder().encode(rewriteCss(new TextDecoder().decode(content), response.url || url.href, (child) => {
      if (current.blockedResourceKeys?.includes(privateResourceKey(child))) return false;
      if (/^https?:/.test(child)) children.push(child);
    }));
    const dataUrl = `data:${mime};base64,${base64(content)}`;
    await putAsset({ id: `${sessionId}:${key.slice(key.lastIndexOf("/") + 1)}`, sessionId, url: key, mime, dataUrl, bytes: dataUrl.length });
    for (const child of children.slice(0, 120)) {
      if (Date.now() >= deadline) { await report(sessionId, "asset-time-limit", "Some resources exceeded the capture time budget. Resume the source page to collect them again, and check offline replay before sharing."); break; }
      await fetchAsset(sessionId, child, depth + 1, deadline);
    }
  } catch {
    await report(sessionId, "asset-unavailable", `A resource from ${url.origin} could not be bundled without credentials or exceeded 2 MiB. Check the replay for missing images, fonts or styles.`);
  }
}

function enqueueAssets(sessionId: string, urls: string[]): Promise<unknown> {
  assetQueue = assetQueue.then(async () => {
    const pending = urls.slice(0, 300);
    const deadline = Date.now() + 100_000;
    const workers = Array.from({ length: 4 }, async () => {
      while (pending.length && Date.now() < deadline) {
        const url = pending.shift(); if (url) await fetchAsset(sessionId, url, 0, deadline);
      }
    });
    await Promise.all(workers);
    if (pending.length) await report(sessionId, "asset-time-limit", "Some resources exceeded the capture time budget. Resume the source page to collect them again, and check offline replay before sharing.");
  }).catch(() => {});
  return assetQueue;
}

function checkedStep(input: unknown): StoredStep {
  if (!input || typeof input !== "object") throw new Error("Invalid tutorial step.");
  const value = input as StoredStep;
  if (typeof value.id !== "string" || value.id.length > 120 || !Number.isFinite(value.at) || !["click", "input", "change", "continue", "navigate", "scroll"].includes(value.action)) throw new Error("Invalid tutorial step.");
  const step: StoredStep = { id: value.id, title: String(value.title || "Step").slice(0, 120), instruction: String(value.instruction || "Continue.").slice(0, 2000), at: value.at, action: value.action };
  if (value.target && Number.isSafeInteger(value.target.nodeId) && value.target.nodeId >= 0) step.target = {
    nodeId: value.target.nodeId,
    ...(value.target.documentId ? { documentId: String(value.target.documentId).slice(0, 120) } : {}),
    ...(value.target.label ? { label: String(value.target.label).slice(0, 200) } : {}),
    ...(value.target.selector ? { selector: String(value.target.selector).slice(0, 500) } : {}),
  };
  if (value.sourceDocumentId) step.sourceDocumentId = String(value.sourceDocumentId).slice(0, 120);
  return step;
}

async function handle(message: Record<string, unknown>, sender: chrome.runtime.MessageSender): Promise<Record<string, unknown>> {
  if (message.channel !== CHANNEL || sender.id !== chrome.runtime.id) throw new Error("Unknown recorder message.");
  const extensionPage = sender.url?.startsWith(chrome.runtime.getURL("")) === true;
  if (extensionPage) {
    if (message.type === "status") return { ok: true, active: await activeSession(), sessions: await listSessions() };
    if (message.type === "start" && Number.isSafeInteger(message.tabId)) return { ok: true, sessionId: await start(Number(message.tabId), String(message.title || ""), message.screenshots !== false, String(message.privateSelector || "")) };
    if (message.type === "pause" || message.type === "stop") { await transition(String(message.sessionId), message.type === "pause" ? "paused" : "stopped"); return { ok: true }; }
    if (message.type === "resume" && Number.isSafeInteger(message.tabId)) { await resume(String(message.sessionId), Number(message.tabId)); return { ok: true }; }
    if (message.type === "refresh-assets") {
      const session = await getSession(String(message.sessionId));
      if (session) { attemptedAssets.clear(); await contentMessage(session.tabId, { type: "collect-assets" }).catch(() => {}); }
      return { ok: true };
    }
    throw new Error("Unknown recorder command.");
  }
  const session = await activeSession();
  if (!session || sender.tab?.id !== session.tabId || sender.frameId !== 0 || !sender.documentId) return { ok: false, error: "This page is not the active recording." };
  if (message.type === "hello") {
    if (session.status !== "recording") return { ok: false };
    const source = safeSource(sender.url || "");
    const viewport = message.viewport as { width?: number; height?: number; devicePixelRatio?: number } | undefined;
    const isFirstPage = session.pages.length === 0;
    await updateSession(session.id, (value) => {
      if (!value.pages.some((page) => page.id === sender.documentId)) value.pages.push({ id: sender.documentId!, ...source });
      value.lastDocumentId = sender.documentId;
      if (isFirstPage && viewport && viewport.width && viewport.height) value.viewport = { width: Math.min(8192, Math.max(1, viewport.width)), height: Math.min(8192, Math.max(1, viewport.height)), devicePixelRatio: Math.min(5, Math.max(0.5, viewport.devicePixelRatio || 1)) };
    });
    return { ok: true, sessionId: session.id, documentId: sender.documentId, settings: session.settings, isFirstPage };
  }
  if (message.sessionId !== session.id || message.documentId !== sender.documentId) throw new Error("Recording identity does not match this page.");
  if (message.type === "events") {
    if (!Array.isArray(message.events) || message.events.length > 1000 || typeof message.chunkId !== "string" || message.chunkId.length > 300) throw new Error("Invalid event chunk.");
    const events = message.events as BrowserCaptureEvent[];
    if (events.some((event) => !Number.isFinite(event.timestamp) || !Number.isInteger(event.type) || event.type < 0 || event.type > 6)) throw new Error("Invalid recording event.");
    await appendChunk({ id: message.chunkId, sessionId: session.id, documentId: sender.documentId, events });
    return { ok: true };
  }
  if (message.type === "step") {
    const step = checkedStep(message.step);
    step.sourceDocumentId = sender.documentId;
    if (step.target) step.target.documentId = sender.documentId;
    await updateSession(session.id, (value) => { if (!value.steps.some((item) => item.id === step.id) && value.steps.length < 1900) value.steps.push(step); });
    return { ok: true };
  }
  if (message.type === "step-result") {
    const afterAt = Number(message.afterAt);
    if (!Number.isFinite(afterAt)) throw new Error("Invalid checkpoint.");
    await updateSession(session.id, (value) => { const step = value.steps.find((item) => item.id === message.stepId); if (step) step.afterAt = Math.max(step.at, afterAt); });
    return { ok: true };
  }
  if (message.type === "screenshot" && typeof message.stepId === "string" && Number.isFinite(message.captureRevision)) { enqueueScreenshot(session.id, message.stepId, sender.documentId, Number(message.captureRevision)); return { ok: true }; }
  if (message.type === "assets" && Array.isArray(message.urls)) {
    const blocked = Array.isArray(message.blockedResourceKeys) ? message.blockedResourceKeys.filter((key): key is string => typeof key === "string" && /^https:\/\/capture\.invalid\/assets\/[0-9a-f]{16}$/.test(key)).slice(0, 5000) : [];
    await updateSession(session.id, (value) => { value.blockedResourceKeys = [...new Set([...(value.blockedResourceKeys ?? []), ...blocked])].slice(0, 5000); });
    await enqueueAssets(session.id, message.urls.filter((url): url is string => typeof url === "string" && url.length < 8192)); return { ok: true };
  }
  if (message.type === "warning") { await report(session.id, String(message.code).slice(0, 80), String(message.message).slice(0, 1000)); return { ok: true }; }
  if (message.type === "fatal") {
    await updateSession(session.id, (value) => { value.status = "interrupted"; addWarning(value, { code: "persistence-failed", message: String(message.message).slice(0, 1000) }); });
    await badge("!"); return { ok: true };
  }
  return { ok: false, error: "Unknown page recorder message." };
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.channel !== CHANNEL) return;
  void handle(message, sender).then(respond).catch((error) => respond({ ok: false, error: error instanceof Error ? error.message : "The recorder could not complete this action." }));
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status !== "complete") return;
  void activeSession().then(async (session) => {
    if (session?.status === "recording" && session.tabId === tabId) await inject(session);
  }).catch(() => {});
});
chrome.tabs.onRemoved.addListener((tabId) => {
  void activeSession().then(async (session) => {
    if (session?.tabId === tabId && session.status === "recording") {
      await updateSession(session.id, (value) => { value.status = "interrupted"; addWarning(value, { code: "tab-closed", message: "The source tab closed. Acknowledged data is saved; resume on the source site to continue." }); });
      await badge("!");
    }
  }).catch(() => {});
});
chrome.runtime.onStartup.addListener(() => {
  void activeSession().then(async (session) => {
    if (session?.status === "recording") { await updateSession(session.id, (value) => { value.status = "interrupted"; }); await badge("!"); }
  });
});
