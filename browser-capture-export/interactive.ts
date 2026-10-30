import { parseBrowserCapture } from "../browser-capture";
import type { BrowserCapturePackage } from "../browser-capture";

/** Bundled, trusted TourKit player code. Captured application scripts are never executable here. */
export interface BrowserCapturePlayerRuntime {
  version: 1;
  javascript: string;
  css: string;
}

export interface BrowserCaptureInteractiveExportOptions {
  loadRuntime: () => Promise<BrowserCapturePlayerRuntime>;
}

function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

export function browserCaptureInteractiveHtml(input: BrowserCapturePackage, runtime: BrowserCapturePlayerRuntime): string {
  const capture = parseBrowserCapture(input);
  if (runtime.version !== 1 || typeof runtime.javascript !== "string" || !runtime.javascript.trim() || typeof runtime.css !== "string") {
    throw new Error("A bundled TourKit capture player runtime is required for interactive HTML export.");
  }
  // Exports contain only the publishable screenshot. Editor-only original pixels
  // must not escape into a guide just because the rest of the package is portable.
  const portable = { ...capture, steps: capture.steps.map((step) => {
    if (!step.screenshot) return step;
    const { sourceDataUrl: _source, sourceWidth: _width, sourceHeight: _height, ...screenshot } = step.screenshot;
    return { ...step, screenshot };
  }) };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; frame-src 'self' about:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<title>${escapeHtml(capture.title)} · TourKit</title><style>${runtime.css.replace(/<\/style/gi, "<\\/style")}</style></head>
<body><div id="root"></div><noscript>Enable JavaScript to play this captured tutorial.</noscript>
<script id="tourkit-capture-data" type="application/json">${safeJson(portable)}</script><script>${runtime.javascript.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
}

export function createBrowserCaptureInteractiveExporter(options: BrowserCaptureInteractiveExportOptions): (capture: BrowserCapturePackage) => Promise<Blob> {
  let pending: Promise<BrowserCapturePlayerRuntime> | undefined;
  return async (capture) => {
    pending ??= options.loadRuntime().catch((error: unknown) => { pending = undefined; throw error; });
    return new Blob([browserCaptureInteractiveHtml(capture, await pending)], { type: "text/html;charset=utf-8" });
  };
}

/** Used by the bundled Studio and extension. Hosts may instead inject their own runtime loader. */
export function createDefaultBrowserCaptureInteractiveExporter(runtimeUrl: string | URL): (capture: BrowserCapturePackage) => Promise<Blob> {
  return createBrowserCaptureInteractiveExporter({
    loadRuntime: async () => {
      const response = await fetch(runtimeUrl);
      if (!response.ok) throw new Error(`The interactive player bundle could not be loaded (${response.status}).`);
      return response.json() as Promise<BrowserCapturePlayerRuntime>;
    },
  });
}
