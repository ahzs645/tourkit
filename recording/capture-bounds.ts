export interface TutorialCaptureBounds { x: number; y: number; width: number; height: number }
export interface TutorialCaptureBoundsOptions {
  /** Visible regions to frame together; omitted means the complete viewport. */
  regionSelector?: string;
  margin?: number;
}

/** Frame app-selected windows or popups without knowing the application's DOM. */
export function tutorialCaptureBounds(doc: Document, options: TutorialCaptureBoundsOptions = {}): TutorialCaptureBounds {
  const view = doc.defaultView;
  const width = view?.innerWidth ?? doc.documentElement.clientWidth;
  const height = view?.innerHeight ?? doc.documentElement.clientHeight;
  const full = { x: 0, y: 0, width, height };
  if (!options.regionSelector) return full;
  const rects = [...doc.querySelectorAll<HTMLElement>(options.regionSelector)].flatMap((element) => {
    const rect = element.getBoundingClientRect();
    const style = view?.getComputedStyle(element);
    if (rect.width <= 0 || rect.height <= 0 || rect.right <= 0 || rect.bottom <= 0 || rect.left >= width || rect.top >= height
      || style?.visibility === "hidden" || style?.display === "none" || style?.opacity === "0"
      || (element.checkVisibility && !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))) return [];
    return [rect];
  });
  if (!rects.length) return full;
  const margin = options.margin ?? 16;
  const padding = Math.max(0, Math.min(128, Number.isFinite(margin) ? margin : 16));
  const x = Math.max(0, Math.floor(Math.min(...rects.map((rect) => rect.left)) - padding));
  const y = Math.max(0, Math.floor(Math.min(...rects.map((rect) => rect.top)) - padding));
  const right = Math.min(width, Math.ceil(Math.max(...rects.map((rect) => rect.right)) + padding));
  const bottom = Math.min(height, Math.ceil(Math.max(...rects.map((rect) => rect.bottom)) + padding));
  return { x, y, width: right - x, height: bottom - y };
}

