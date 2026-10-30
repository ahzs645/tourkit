import { z } from "zod";
import { readingScreenshot, TutorialScreenshotSchema } from "../core/screenshot";
import {
  DEFAULT_BROWSER_CAPTURE_LIMITS,
  type BrowserCaptureLimits,
  type BrowserCapturePackage,
  type JsonValue,
} from "./types";

const id = z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);
const time = z.number().finite().min(0);
const target = z.strictObject({
  nodeId: z.number().int().min(0), documentId: id.optional(),
  selector: z.string().max(2_000).optional(), label: z.string().max(500).optional(),
});

/** Limits are checked before Zod walks the engine payload or allocates clones. */
export function assertBoundedCaptureJson(value: unknown, limits: BrowserCaptureLimits): asserts value is JsonValue {
  const stack: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  let nodes = 0;
  let bytes = 0;
  const encoder = new TextEncoder();
  while (stack.length) {
    const entry = stack.pop()!;
    if (++nodes > limits.maxNodes) throw new Error("Capture contains too many JSON values.");
    if (entry.depth > limits.maxDepth) throw new Error("Capture JSON nesting is too deep.");
    const current = entry.value;
    if (typeof current === "string") bytes += encoder.encode(current).length + 2;
    else if (current === null || typeof current === "boolean") bytes += 5;
    else if (typeof current === "number" && Number.isFinite(current)) bytes += 24;
    else if (current && typeof current === "object") {
      if (!Array.isArray(current) && Object.getPrototypeOf(current) !== Object.prototype && Object.getPrototypeOf(current) !== null) {
        throw new Error("Capture must contain plain JSON objects.");
      }
      for (const [key, child] of Object.entries(current)) {
        if (key === "__proto__" || key === "constructor" || key === "prototype") throw new Error("Capture contains an unsafe JSON property.");
        bytes += encoder.encode(key).length + 4;
        stack.push({ value: child, depth: entry.depth + 1 });
        if (stack.length + nodes > limits.maxNodes) throw new Error("Capture contains too many JSON values.");
      }
    } else throw new Error("Capture must contain JSON values only.");
    if (bytes > limits.maxBytes) throw new Error("Capture exceeds the size limit.");
  }
}

function limitsFor(overrides: Partial<BrowserCaptureLimits> = {}): BrowserCaptureLimits {
  const limits = { ...DEFAULT_BROWSER_CAPTURE_LIMITS, ...overrides };
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid capture limit: ${key}.`);
  }
  return limits;
}

const embeddedAsset = /^data:(image\/(?:png|jpeg|webp|gif)|font\/(?:woff|woff2|ttf|otf)|application\/(?:font-woff|font-sfnt)|text\/css);base64,[A-Za-z0-9+/]+={0,2}$/i;

function packageSchema(limits: BrowserCaptureLimits) {
  return z.strictObject({
    format: z.literal("tourkit-browser-capture"), version: z.literal(1), id,
    title: z.string().min(1).max(300),
    createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
    engine: z.strictObject({ name: z.literal("rrweb"), version: z.string().min(1).max(100) }),
    viewport: z.strictObject({
      width: z.number().int().min(1).max(16_384), height: z.number().int().min(1).max(16_384),
      devicePixelRatio: z.number().finite().min(0.1).max(10).optional(),
    }),
    privacy: z.strictObject({ mode: z.enum(["masked", "reviewed", "unreviewed"]), notes: z.string().max(10_000).optional() }),
    pages: z.array(z.strictObject({ id, origin: z.string().max(2_048), path: z.string().max(4_096) })).max(2_000).optional(),
    events: z.array(z.strictObject({ type: z.number().int().min(0).max(6), timestamp: time, data: z.custom<JsonValue>() })).min(1).max(limits.maxEvents),
    steps: z.array(z.strictObject({
      id, title: z.string().min(1).max(300), instruction: z.string().max(20_000), atMs: time,
      afterMs: time.optional(), action: z.enum(["click", "input", "change", "scroll", "navigate", "continue"]),
      target: target.optional(), sourceDocumentId: id.optional(),
      screenshot: TutorialScreenshotSchema.transform(readingScreenshot).optional(), screenshotAtMs: time.optional(),
      value: z.string().max(20_000).optional(), disabled: z.boolean().optional(),
    })).max(limits.maxSteps),
    assets: z.array(z.strictObject({ id, url: z.string().min(1).max(8_192), mime: z.string().max(100), dataUrl: z.string().max(16_000_000).regex(embeddedAsset) })).max(limits.maxAssets).optional(),
    warnings: z.array(z.strictObject({ code: id, message: z.string().min(1).max(4_000), stepId: id.optional() })).max(10_000),
  });
}

export function captureDuration(capture: Pick<BrowserCapturePackage, "events">): number {
  return capture.events.length ? Math.max(0, capture.events[capture.events.length - 1]!.timestamp - capture.events[0]!.timestamp) : 0;
}

function uniqueIds(items: { id: string }[], label: string): Set<string> {
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) throw new Error(`Duplicate ${label} id: ${item.id}.`);
    ids.add(item.id);
  }
  return ids;
}

export function sanitizeCaptureSourceUrl(raw: string): { origin: string; path: string } {
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only HTTP(S) source pages can be recorded.");
  return { origin: url.origin, path: url.pathname || "/" };
}

export function parseBrowserCapture(input: unknown, overrides: Partial<BrowserCaptureLimits> = {}): BrowserCapturePackage {
  const limits = limitsFor(overrides);
  let value: unknown = input;
  if (typeof input === "string") {
    if (new TextEncoder().encode(input).length > limits.maxBytes) throw new Error("Capture exceeds the size limit.");
    try { value = JSON.parse(input); } catch { throw new Error("Capture is not valid JSON."); }
  }
  assertBoundedCaptureJson(value, limits);
  const capture = packageSchema(limits).parse(value) as BrowserCapturePackage;
  const stepIds = uniqueIds(capture.steps, "step");
  const pageIds = uniqueIds(capture.pages ?? [], "page");
  uniqueIds(capture.assets ?? [], "asset");
  const assetUrls = new Set<string>();
  for (const asset of capture.assets ?? []) {
    if (assetUrls.has(asset.url)) throw new Error(`Duplicate asset URL: ${asset.url}.`);
    assetUrls.add(asset.url);
    if (asset.dataUrl.slice(5, asset.dataUrl.indexOf(";")) !== asset.mime) throw new Error(`Asset MIME type does not match its data URL: ${asset.id}.`);
  }
  for (const page of capture.pages ?? []) {
    const sanitized = sanitizeCaptureSourceUrl(page.origin + page.path);
    if (sanitized.origin !== page.origin || sanitized.path !== page.path || !page.path.startsWith("/") || page.path.startsWith("//")) {
      throw new Error(`Source page must contain only an origin and path: ${page.id}.`);
    }
  }
  let previousTimestamp = -Infinity;
  let hasSnapshot = false;
  for (const event of capture.events) {
    if (event.timestamp < previousTimestamp) throw new Error("Capture events must be ordered by timestamp.");
    previousTimestamp = event.timestamp;
    if (event.type === 5 && event.data && typeof event.data === "object" && !Array.isArray(event.data) && event.data.tag === "tourkit-document") {
      const payload = event.data.payload;
      if (!payload || typeof payload !== "object" || Array.isArray(payload) || typeof payload.documentId !== "string" || !pageIds.has(payload.documentId)) {
        throw new Error("Document marker references an unknown source page.");
      }
    }
    if (event.type === 2) {
      if (!event.data || typeof event.data !== "object" || Array.isArray(event.data) || !event.data.node) throw new Error("Full snapshot event is missing its document node.");
      hasSnapshot = true;
    }
  }
  if (!hasSnapshot) throw new Error("Capture needs at least one full DOM snapshot.");
  const duration = captureDuration(capture);
  for (const step of capture.steps) {
    for (const point of [step.atMs, step.afterMs, step.screenshotAtMs]) {
      if (point !== undefined && point > duration + 1) throw new Error(`Step lies outside the recording: ${step.id}.`);
    }
    if (step.afterMs !== undefined && step.afterMs < step.atMs) throw new Error(`Result precedes its action: ${step.id}.`);
    for (const documentId of [step.sourceDocumentId, step.target?.documentId]) {
      if (documentId && !pageIds.has(documentId)) throw new Error(`Unknown source document in step: ${step.id}.`);
    }
  }
  for (const warning of capture.warnings) if (warning.stepId && !stepIds.has(warning.stepId)) throw new Error(`Warning references an unknown step: ${warning.stepId}.`);
  return capture;
}

export function serializeBrowserCapture(capture: BrowserCapturePackage, pretty = false): string {
  return JSON.stringify(parseBrowserCapture(capture), null, pretty ? 2 : undefined);
}

export { limitsFor as browserCaptureLimits };
