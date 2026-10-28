import { MAX_TUTORIAL_SCREENSHOT_BYTES, TutorialScreenshotSchema, type TutorialScreenshot } from "../core/screenshot";

export type ScreenshotPoint = { x: number; y: number };
export type ScreenshotCrop = ScreenshotPoint & { width: number; height: number };
export type ScreenshotAnnotation =
  | { kind: "arrow"; start: ScreenshotPoint; end: ScreenshotPoint }
  | { kind: "text"; start: ScreenshotPoint; text: string }
  | { kind: "number"; start: ScreenshotPoint; number: number }
  | { kind: "redact"; rect: ScreenshotCrop };
export type ScreenshotTool = "arrow" | "text" | "number" | "redact" | "crop";

export function screenshotRectangle(start: ScreenshotPoint, end: ScreenshotPoint, width: number, height: number): ScreenshotCrop {
  const x = Math.max(0, Math.min(width - 1, Math.floor(Math.min(start.x, end.x))));
  const y = Math.max(0, Math.min(height - 1, Math.floor(Math.min(start.y, end.y))));
  const right = Math.max(x + 1, Math.min(width, Math.ceil(Math.max(start.x, end.x))));
  const bottom = Math.max(y + 1, Math.min(height, Math.ceil(Math.max(start.y, end.y))));
  return { x, y, width: right - x, height: bottom - y };
}

/** Reject disguised files/oversized dimensions before asking the browser to decode any pixels. */
export async function importTutorialScreenshot(file: Blob, alt = "Tutorial interface", expectedFingerprint?: string): Promise<TutorialScreenshot> {
  if (file.type && file.type !== "image/png") throw new Error("Choose a PNG image.");
  if (!file.size || file.size > MAX_TUTORIAL_SCREENSHOT_BYTES) throw new Error("PNG images must be smaller than 6 MB.");
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("The PNG could not be read."));
    reader.readAsDataURL(file.type ? file : file.slice(0, file.size, "image/png"));
  });
  try {
    const header = atob(dataUrl.split(",")[1].slice(0, 44));
    const bytes = Uint8Array.from(header, (character) => character.charCodeAt(0));
    const view = new DataView(bytes.buffer);
    const image = TutorialScreenshotSchema.parse({ dataUrl, width: view.getUint32(16), height: view.getUint32(20), alt,
      provenance: { engine: "import", capturedAt: new Date().toISOString(), stepFingerprint: expectedFingerprint } });
    await loadScreenshotImage(image.dataUrl);
    return image;
  } catch { throw new Error("The file must be a valid PNG, no wider or taller than 4096 pixels."); }
}

export function loadScreenshotImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The screenshot could not be decoded."));
    image.src = dataUrl;
  });
}

export function originalTutorialScreenshot(image: TutorialScreenshot): TutorialScreenshot {
  const { sourceDataUrl, sourceWidth, sourceHeight, ...current } = image;
  return { ...current, dataUrl: sourceDataUrl ?? image.dataUrl, width: sourceWidth ?? image.width, height: sourceHeight ?? image.height,
    ...(image.provenance ? { provenance: { ...image.provenance, reviewedAt: undefined } } : {}) };
}

export function drawScreenshotAnnotations(context: CanvasRenderingContext2D, annotations: ScreenshotAnnotation[], scale: number) {
  context.save();
  context.globalAlpha = 1;
  context.globalCompositeOperation = "source-over";
  const fontSize = Math.max(16, Math.round(24 * scale));
  const stroke = Math.max(3, 4 * scale);
  context.font = `bold ${fontSize}px Arial, sans-serif`;
  context.lineJoin = "round";
  for (const annotation of annotations.filter((item) => item.kind !== "redact")) {
    context.fillStyle = "#dc2626";
    context.strokeStyle = "#dc2626";
    context.lineWidth = stroke;
    if (annotation.kind === "arrow") {
      const { start, end } = annotation;
      const angle = Math.atan2(end.y - start.y, end.x - start.x);
      const head = Math.max(12, 18 * scale);
      context.beginPath(); context.moveTo(start.x, start.y); context.lineTo(end.x, end.y); context.stroke();
      context.beginPath(); context.moveTo(end.x, end.y);
      context.lineTo(end.x - head * Math.cos(angle - Math.PI / 6), end.y - head * Math.sin(angle - Math.PI / 6));
      context.lineTo(end.x - head * Math.cos(angle + Math.PI / 6), end.y - head * Math.sin(angle + Math.PI / 6));
      context.closePath(); context.fill();
    } else if (annotation.kind === "text") {
      context.strokeStyle = "#ffffff"; context.lineWidth = Math.max(4, 5 * scale);
      context.textAlign = "left"; context.textBaseline = "top";
      context.strokeText(annotation.text, annotation.start.x, annotation.start.y);
      context.fillText(annotation.text, annotation.start.x, annotation.start.y);
    } else if (annotation.kind === "number") {
      const radius = Math.max(14, 19 * scale);
      context.beginPath(); context.arc(annotation.start.x, annotation.start.y, radius, 0, Math.PI * 2); context.fill();
      context.fillStyle = "#ffffff"; context.textAlign = "center"; context.textBaseline = "middle";
      context.fillText(String(annotation.number), annotation.start.x, annotation.start.y);
    }
  }
  // Always last, fully opaque, and without antialiased rounded corners: no source pixels survive inside.
  context.fillStyle = "#000000";
  for (const annotation of annotations) if (annotation.kind === "redact") {
    const { x, y, width, height } = annotation.rect;
    context.fillRect(Math.floor(x), Math.floor(y), Math.ceil(x + width) - Math.floor(x), Math.ceil(y + height) - Math.floor(y));
  }
  context.restore();
}

export async function bakeTutorialScreenshot(image: TutorialScreenshot, annotations: ScreenshotAnnotation[], crop?: ScreenshotCrop): Promise<TutorialScreenshot> {
  const bitmap = await loadScreenshotImage(image.dataUrl);
  const region = crop ?? { x: 0, y: 0, width: image.width, height: image.height };
  const canvas = document.createElement("canvas");
  canvas.width = region.width; canvas.height = region.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot edit screenshots.");
  context.drawImage(bitmap, region.x, region.y, region.width, region.height, 0, 0, region.width, region.height);
  context.save(); context.translate(-region.x, -region.y);
  drawScreenshotAnnotations(context, annotations, image.width / 1280);
  context.restore();
  return TutorialScreenshotSchema.parse({ ...image, dataUrl: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height,
    sourceDataUrl: image.sourceDataUrl ?? image.dataUrl, sourceWidth: image.sourceWidth ?? image.width, sourceHeight: image.sourceHeight ?? image.height,
    ...(image.provenance ? { provenance: { ...image.provenance, reviewedAt: undefined } } : {}) });
}

