import { z } from "zod";

const PNG_PREFIX = "data:image/png;base64,";
export const MAX_TUTORIAL_SCREENSHOT_BYTES = 5_999_970;
const pngDataUrl = z.string().max(8_000_000).regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/);
const imageDimension = z.number().int().min(1).max(4096);

export const TutorialScreenshotProvenanceSchema = z.strictObject({
  engine: z.enum(["dom", "native", "import"]),
  capturedAt: z.string().datetime(),
  stepFingerprint: z.string().min(1).max(160).optional(),
  reviewedAt: z.string().datetime().optional(),
});
export type TutorialScreenshotProvenance = z.infer<typeof TutorialScreenshotProvenanceSchema>;

function pngDimensionsMatch(dataUrl: string, width: number, height: number) {
  try {
    const header = atob(dataUrl.slice(PNG_PREFIX.length, PNG_PREFIX.length + 44));
    const bytes = Uint8Array.from(header, (char) => char.charCodeAt(0));
    const view = new DataView(bytes.buffer);
    return bytes.length >= 24 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a
      && view.getUint32(12) === 0x49484452 && view.getUint32(16) === width && view.getUint32(20) === height;
  } catch { return false; }
}

/** Only embedded raster images cross the draft/manifest boundary; never remote URLs or SVG. */
export const TutorialScreenshotSchema = z.strictObject({
  dataUrl: pngDataUrl,
  width: imageDimension,
  height: imageDimension,
  alt: z.string().min(1).max(500),
  caption: z.string().max(500).optional(),
  /** Editable draft backup only. Reading and playback exports must use readingScreenshot. */
  sourceDataUrl: pngDataUrl.optional(),
  sourceWidth: imageDimension.optional(),
  sourceHeight: imageDimension.optional(),
  provenance: TutorialScreenshotProvenanceSchema.optional(),
}).superRefine((image, context) => {
  if (!pngDimensionsMatch(image.dataUrl, image.width, image.height)) {
    context.addIssue({ code: "custom", message: "Screenshot must be an embedded PNG with matching dimensions.", path: ["dataUrl"] });
  }
  const hasSource = image.sourceDataUrl !== undefined || image.sourceWidth !== undefined || image.sourceHeight !== undefined;
  if (hasSource && (!image.sourceDataUrl || !image.sourceWidth || !image.sourceHeight
    || !pngDimensionsMatch(image.sourceDataUrl, image.sourceWidth, image.sourceHeight))) {
    context.addIssue({ code: "custom", message: "Original screenshot needs a valid PNG and matching dimensions.", path: ["sourceDataUrl"] });
  }
});

export type TutorialScreenshot = z.infer<typeof TutorialScreenshotSchema>;

/** Only baked pixels may be distributed: a redacted original must stay in the editable draft. */
export function readingScreenshot(image: TutorialScreenshot): TutorialScreenshot {
  const { sourceDataUrl: _data, sourceWidth: _width, sourceHeight: _height, ...safe } = image;
  return safe;
}

export const publishedScreenshot = readingScreenshot;

export function stampTutorialScreenshot(image: TutorialScreenshot, provenance: TutorialScreenshotProvenance): TutorialScreenshot {
  return TutorialScreenshotSchema.parse({ ...image, provenance });
}

/** A change detector, not a security hash. Object key order and absent optional values are ignored. */
export function tutorialScreenshotFingerprint(input: unknown): string {
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined)
        .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, normalize(child)]));
    }
    return value;
  };
  const text = JSON.stringify(normalize(input)) ?? "null";
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return `s1-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function screenshotIsStale(image: TutorialScreenshot, expectedFingerprint?: string): boolean {
  return Boolean(expectedFingerprint && image.provenance?.stepFingerprint && image.provenance.stepFingerprint !== expectedFingerprint);
}

export function screenshotBytes(image: TutorialScreenshot): Uint8Array {
  const valid = TutorialScreenshotSchema.parse(image);
  return Uint8Array.from(atob(valid.dataUrl.slice(PNG_PREFIX.length)), (char) => char.charCodeAt(0));
}

export function fitScreenshot(image: TutorialScreenshot, maxWidth: number, maxHeight: number) {
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
  return { width: image.width * scale, height: image.height * scale };
}

