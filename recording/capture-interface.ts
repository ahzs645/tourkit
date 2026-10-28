import { TutorialScreenshotSchema, type TutorialScreenshot } from "../core/screenshot";
import { tutorialCaptureBounds, type TutorialCaptureBounds } from "./capture-bounds";
import { frameTutorialCanvas, type TutorialFrameRect, type TutorialScreenshotFraming } from "./capture-framing";
import { normalizeTutorialCaptureGradients } from "./capture-gradients";

export const TUTORIAL_CAPTURE_VIEWPORT = { width: 1920, height: 1080 } as const;
const activeCaptures = new WeakSet<HTMLIFrameElement>();

export interface TutorialCaptureOptions {
  /** Canvas pixels per CSS pixel. */
  scale?: number;
  framing?: TutorialScreenshotFraming;
  /** The elements the step rings, read after the stage has reflowed to desktop size. */
  focus?: (doc: Document) => readonly Element[];
  /** App-owned framing, evaluated after the stage reflows. Defaults to its complete viewport. */
  bounds?: (doc: Document) => TutorialCaptureBounds;
}

/** Reflows the live stage at desktop size, retaining its current state, then restores Studio. */
export async function captureTutorialInterface(frame: HTMLIFrameElement, alt: string, options: TutorialCaptureOptions = {}): Promise<TutorialScreenshot> {
  if (activeCaptures.has(frame)) throw new Error("An interface capture is already in progress.");
  activeCaptures.add(frame);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const originalStyle = frame.getAttribute("style");
  const controller = new AbortController();
  try {
    // Keep the same browsing context: cloning or moving the iframe would lose menus and form state.
    for (const [property, value] of Object.entries({
      position: "fixed", left: "-20000px", top: "0", width: "1920px", height: "1080px",
      "min-width": "1920px", "min-height": "1080px", "max-width": "none", "max-height": "none",
      flex: "none", transform: "none", border: "0", "box-sizing": "content-box",
    })) frame.style.setProperty(property, value, "important");
    return await Promise.race([
      captureStage(frame, alt, controller.signal, options),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error("Screenshot capture timed out. Wait for the stage to settle, then try again."));
        }, 20_000);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
    if (originalStyle === null) frame.removeAttribute("style");
    else frame.setAttribute("style", originalStyle);
    activeCaptures.delete(frame);
  }
}

async function captureStage(frame: HTMLIFrameElement, alt: string, signal: AbortSignal, options: TutorialCaptureOptions): Promise<TutorialScreenshot> {
  const scale = options.scale ?? 1;
  // The maintained fork: html2canvas 1.4.1 throws on the oklch/oklab colours Tailwind v4 emits.
  const { default: html2canvas } = await import("html2canvas-pro");
  // Allow resize listeners, responsive React layouts, and Studio's highlight sync to settle.
  await new Promise<void>((resolve) => setTimeout(resolve, 350));
  signal.throwIfAborted();
  const doc = frame.contentDocument;
  const view = doc?.defaultView;
  if (!doc?.body || !view || doc.readyState !== "complete" || view.innerWidth < 1 || view.innerHeight < 1) {
    throw new Error("Wait for the tutorial interface to finish loading, then capture again.");
  }
  await doc.fonts?.ready;
  signal.throwIfAborted();
  if (frame.contentDocument !== doc || !doc.defaultView) throw new Error("The interface changed pages during capture. Please capture again.");
  if (view.innerWidth !== TUTORIAL_CAPTURE_VIEWPORT.width || view.innerHeight !== TUTORIAL_CAPTURE_VIEWPORT.height) {
    throw new Error("The interface could not be resized to the export viewport. Please capture again.");
  }
  // html2canvas measures font baselines in its calling document. Tailwind's block-image
  // reset breaks its hidden 1px probe, shifting text down and clipping control labels.
  const metricsStyle = document.createElement("style");
  metricsStyle.textContent = 'body > div[style*="visibility: hidden"][style*="white-space: nowrap"] > img[width="1"][height="1"] { display: inline-block !important; }';
  document.head.append(metricsStyle);
  const borrowed = await borrowFrameFonts(doc);
  let canvas: HTMLCanvasElement;
  let focus: TutorialFrameRect | undefined;
  try {
    const bounds = options.bounds?.(doc) ?? tutorialCaptureBounds(doc);
    focus = focusRect([...(options.focus?.(doc) ?? []), ...doc.querySelectorAll("[data-tutorial-focus]")], bounds, scale);
    canvas = await html2canvas(doc.documentElement, {
      width: bounds.width, height: bounds.height,
      x: view.scrollX + bounds.x, y: view.scrollY + bounds.y,
      windowWidth: view.innerWidth, windowHeight: view.innerHeight,
      scale,
      backgroundColor: "#ffffff", logging: false, useCORS: false, allowTaint: false, imageTimeout: 10_000,
      onclone: (clone) => {
        normalizeTutorialCaptureGradients(clone);
        // Its inline-block paint order can cover nested button labels with the button's
        // own background. A local stacking context fixes paint order without reflow.
        clone.querySelectorAll("button").forEach((button) => {
          const style = clone.defaultView?.getComputedStyle(button);
          if (style?.display === "inline-block" && style.position === "static") {
            button.style.position = "relative"; button.style.zIndex = "0";
          }
        });
        // Mask private content in the cloned capture, leaving the live interface untouched.
        clone.querySelectorAll<HTMLElement>('[data-tutorial-private], [data-private], input[type="password"]').forEach((element) => {
          element.style.setProperty("visibility", "hidden", "important");
        });
        clone.querySelectorAll("nextjs-portal").forEach((element) => element.remove());
        // Keep the focused highlight without other steps' markers or internal anchor labels.
        clone.querySelectorAll("#tourkit-stage-overlay > :not([data-studio-region]):not([data-studio-ring]):not([data-tutorial-focus]):not([data-tutorial-focus-arrow])")
          .forEach((element) => element.remove());
      },
    });
  } finally {
    metricsStyle.remove();
    for (const face of borrowed) document.fonts.delete(face);
  }
  signal.throwIfAborted();
  // A navigation during capture means the result cannot reliably belong to this step.
  if (frame.contentDocument !== doc) throw new Error("The interface changed pages during capture. Please capture again.");
  const framed = frameTutorialCanvas(canvas, focus, options.framing ?? "screen", scale);
  return TutorialScreenshotSchema.parse({ dataUrl: framed.toDataURL("image/png"), width: framed.width, height: framed.height, alt });
}

/**
 * html2canvas paints text with its calling document's fonts. A stage that
 * brings its own web fonts (a desktop emulator's MS Sans Serif) would otherwise be painted
 * in a fallback whose glyph widths disagree with the measured layout —
 * collapsed word gaps, a ring off its control. Lends the frame's loaded
 * @font-face fonts to this document for the capture; returns them to remove.
 */
async function borrowFrameFonts(doc: Document): Promise<FontFace[]> {
  const own = new Set([...document.fonts].map((face) => face.family.replace(/["']/g, "")));
  const faces: FontFace[] = [];
  for (const sheet of [...doc.styleSheets]) {
    let rules: CSSRuleList;
    try { rules = sheet.cssRules; } catch { continue; } // cross-origin sheets cannot be read
    for (const rule of [...rules]) {
      if (rule.constructor.name !== "CSSFontFaceRule") continue;
      const style = (rule as CSSFontFaceRule).style;
      const family = style.getPropertyValue("font-family").replace(/["']/g, "").trim();
      const source = style.getPropertyValue("src");
      if (!family || !source || own.has(family)) continue;
      // Relative urls resolve against the sheet (or the document for inline <style>), not this page.
      const base = sheet.href ?? doc.baseURI;
      const src = source.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, (_, _quote, url: string) => `url("${new URL(url, base).href}")`);
      faces.push(new FontFace(family, src, {
        weight: style.getPropertyValue("font-weight") || "normal",
        style: style.getPropertyValue("font-style") || "normal",
        stretch: style.getPropertyValue("font-stretch") || "normal",
        unicodeRange: style.getPropertyValue("unicode-range") || undefined,
      }));
    }
  }
  const loaded = await Promise.all(faces.map((face) => face.load().catch(() => null)));
  const usable = loaded.filter((face): face is FontFace => face !== null);
  for (const face of usable) document.fonts.add(face);
  return usable;
}

/** The union of the ringed elements' boxes, in capture pixels; undefined when none is visible. */
function focusRect(elements: readonly Element[], bounds: TutorialFrameRect, scale: number): TutorialFrameRect | undefined {
  const rects = elements.map((element) => element.getBoundingClientRect()).filter((rect) => rect.width > 0 && rect.height > 0);
  if (!rects.length) return undefined;
  const left = Math.max(bounds.x, Math.min(...rects.map((rect) => rect.left)));
  const top = Math.max(bounds.y, Math.min(...rects.map((rect) => rect.top)));
  const right = Math.min(bounds.x + bounds.width, Math.max(...rects.map((rect) => rect.right)));
  const bottom = Math.min(bounds.y + bounds.height, Math.max(...rects.map((rect) => rect.bottom)));
  if (right <= left || bottom <= top) return undefined;
  return { x: (left - bounds.x) * scale, y: (top - bounds.y) * scale, width: (right - left) * scale, height: (bottom - top) * scale };
}

