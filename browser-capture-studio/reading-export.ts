import type { BrowserCapturePackage } from "../browser-capture/types";
import { publishedScreenshot } from "../core/screenshot";

const html = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!));

/** Reading exports use only published screenshot pixels, never an editable original. */
export function captureReadingHtml(capture: BrowserCapturePackage): string {
  const steps = capture.steps.filter((step) => !step.disabled);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${html(capture.title)}</title><style>body{font:16px/1.6 system-ui,sans-serif;color:#17213a;max-width:900px;margin:60px auto;padding:0 26px}header{border-bottom:2px solid #6859d9;padding-bottom:30px;margin-bottom:36px}.eyebrow{color:#6654cc;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}h1{font-size:40px;line-height:1.15}h2{font-size:24px}section{margin:42px 0;break-inside:avoid}p{white-space:pre-wrap}img{max-width:100%;height:auto;border:1px solid #dce1ea;border-radius:10px}figcaption,footer{color:#647084;font-size:13px}figure{margin:20px 0}footer{border-top:1px solid #ddd;padding:24px 0}@media print{body{margin:0;max-width:none}header{margin-top:0}}</style></head><body><header><div class="eyebrow">TourKit · Captured tutorial</div><h1>${html(capture.title)}</h1><p>${steps.length} steps · Recorded ${html(capture.createdAt.slice(0, 10))}</p></header>${steps.map((step, index) => {
    const screenshot = step.screenshot ? publishedScreenshot(step.screenshot) : undefined;
    return `<section><div class="eyebrow">Step ${index + 1}</div><h2>${html(step.title)}</h2><p>${html(step.instruction)}</p>${screenshot ? `<figure><img src="${screenshot.dataUrl}" width="${screenshot.width}" height="${screenshot.height}" alt="${html(screenshot.alt)}">${screenshot.caption ? `<figcaption>${html(screenshot.caption)}</figcaption>` : ""}</figure>` : ""}</section>`;
  }).join("")}<footer>Created with TourKit. This guide describes the captured workflow; interactive behavior is available in the companion tutorial.</footer></body></html>`;
}

export function captureReadingMarkdown(capture: BrowserCapturePackage): string {
  const escape = (value: string) => value.replace(/[\\`*_{}[\]<>#]/g, "\\$&");
  return `# ${escape(capture.title)}\n\nRecorded ${capture.createdAt.slice(0, 10)}.\n\n${capture.steps.filter((step) => !step.disabled).map((step, index) => `## ${index + 1}. ${escape(step.title)}\n\n${escape(step.instruction)}\n`).join("\n")}`;
}
