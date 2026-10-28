import type { TutorialManifest } from "../core/schema";
import type { TutorialExportSource } from "./document";
import type { TutorialExportRuntime } from "./runtime";
import { escapeHtml } from "./html";
import { TutorialExportOptionsSchema, type TutorialExportOptions } from "./options";

export function interactiveTutorialUnavailable(source: TutorialExportSource, runtime?: TutorialExportRuntime): string | null {
  return runtime?.interactive ? runtime.interactive.unavailable(source) : "This application has not supplied an offline interactive tutorial runtime. Export a reading guide instead.";
}

export async function exportInteractiveTutorial(source: TutorialExportSource, onProgress?: (text: string) => void, options: Partial<TutorialExportOptions> = {}, runtime?: TutorialExportRuntime): Promise<Blob> {
  const unavailable = interactiveTutorialUnavailable(source, runtime);
  if (unavailable) throw new Error(unavailable);
  return runtime!.interactive!.export(source, onProgress, options);
}

export interface InteractiveTutorialRuntime { version: number; javascript: string; css: string; data?: Record<string, unknown> }
const safeJson = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");

/** A complete executable interface and the existing player, with no runtime asset requests. */
export function interactiveTutorialHtml(manifest: TutorialManifest, runtime: InteractiveTutorialRuntime, options: Partial<TutorialExportOptions> = {}): string {
  if (runtime.version !== 1 || !runtime.javascript || !runtime.css) {
    throw new Error("The offline tutorial runtime is unavailable. Rebuild the tutorial runtime and try again.");
  }
  const portable = { ...manifest, chapters: manifest.chapters.map((chapter) => ({ ...chapter,
    steps: chapter.steps.map(({ screenshot: _image, ...step }) => step) })) };
  const data = safeJson({ ...runtime.data, manifest: portable, highlightStyle: TutorialExportOptionsSchema.parse(options).highlightStyle });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'">
<title>${escapeHtml(manifest.title)} · Interactive tutorial</title><style>${runtime.css.replace(/<\/style/gi, "<\\/style")}</style></head>
<body><div id="root"></div><noscript>Enable JavaScript to play this offline interactive tutorial.</noscript>
<script id="tutorial-data" type="application/json">${data}</script><script>${runtime.javascript.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
}

