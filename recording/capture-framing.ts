export interface TutorialFrameRect { x: number; y: number; width: number; height: number }
export type TutorialScreenshotFraming = "step" | "screen";

/** Capture resolution: crops of a 2× capture stay sharp when a page or slide enlarges them. */
export const TUTORIAL_CAPTURE_SCALE = 2;
/** Whole-screen images are downscaled to this width so a long guide stays a sensible size. */
const SCREEN_MAX_WIDTH = 2560;
/** Crops never exceed this width; wider than any page or slide needs. */
const CROP_MAX_WIDTH = 2400;
/** CSS-pixel context around the ringed control, and the smallest region worth showing. */
const FOCUS_PADDING = 120;
const MIN_WIDTH = 800;
const MIN_HEIGHT = 500;
/** Crops keep a readable page shape: no narrower than 4:3, no wider than 2:1. */
const MIN_ASPECT = 4 / 3;
const MAX_ASPECT = 2;

/**
 * The region of a capture an export shows, in image pixels. "step" zooms to
 * the step's ringed control with enough surrounding interface to recognise
 * where it is; "screen", or a step without a control, shows the whole capture.
 */
export function tutorialFrameRect(
  image: { width: number; height: number },
  focus: TutorialFrameRect | undefined,
  framing: TutorialScreenshotFraming,
  scale = 1,
): TutorialFrameRect {
  const whole = { x: 0, y: 0, width: image.width, height: image.height };
  if (framing === "screen" || !focus || focus.width <= 0 || focus.height <= 0) return whole;
  const pad = FOCUS_PADDING * scale;
  let width = Math.max(focus.width + pad * 2, MIN_WIDTH * scale);
  let height = Math.max(focus.height + pad * 2, MIN_HEIGHT * scale);
  if (width / height < MIN_ASPECT) width = height * MIN_ASPECT;
  if (width / height > MAX_ASPECT) height = width / MAX_ASPECT;
  width = Math.min(width, image.width);
  height = Math.min(height, image.height);
  // A control that already fills most of the screen gains nothing from a crop.
  if (width * height >= image.width * image.height * 0.7) return whole;
  const centreX = focus.x + focus.width / 2;
  const centreY = focus.y + focus.height / 2;
  const x = Math.min(Math.max(0, centreX - width / 2), image.width - width);
  const y = Math.min(Math.max(0, centreY - height / 2), image.height - height);
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

/** Output size for a framed region: crops keep their captured detail, whole screens are capped. */
export function tutorialFrameOutputSize(region: TutorialFrameRect, whole: boolean): { width: number; height: number } {
  const limit = whole ? SCREEN_MAX_WIDTH : CROP_MAX_WIDTH;
  const ratio = Math.min(1, limit / region.width, 4096 / region.height);
  return { width: Math.max(1, Math.round(region.width * ratio)), height: Math.max(1, Math.round(region.height * ratio)) };
}

/** Browser-only: draws the framed region of a capture onto a new canvas. */
export function frameTutorialCanvas(
  source: HTMLCanvasElement,
  focus: TutorialFrameRect | undefined,
  framing: TutorialScreenshotFraming,
  scale: number,
): HTMLCanvasElement {
  const region = tutorialFrameRect(source, focus, framing, scale);
  const whole = region.width === source.width && region.height === source.height;
  const size = tutorialFrameOutputSize(region, whole);
  if (whole && size.width === source.width && size.height === source.height) return source;
  const canvas = source.ownerDocument.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot crop interface screenshots.");
  context.imageSmoothingQuality = "high";
  context.drawImage(source, region.x, region.y, region.width, region.height, 0, 0, size.width, size.height);
  return canvas;
}

