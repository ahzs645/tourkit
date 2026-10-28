/**
 * The dim overlay's cutouts. driver.js draws one hole, around the element it
 * highlights (the step's anchor region). A step can ring a target that lies
 * outside that region — the Content Area step rings Measures in the tree —
 * and the ring then sat in the dark. These helpers compute the extra holes
 * that keep the ringed control lit, and the stage handling that lets the box
 * glide from the last lit spot to the next.
 */

export interface SpotlightBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface StageRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function paddedBox(rect: StageRect, pad: number): SpotlightBox {
  return { left: rect.x - pad, top: rect.y - pad, right: rect.x + rect.width + pad, bottom: rect.y + rect.height + pad };
}

function isEmpty(box: SpotlightBox): boolean {
  return box.right - box.left < 1 || box.bottom - box.top < 1;
}

/**
 * The parts of `box` outside `cut`, as up to four disjoint rectangles. The
 * overlay path fills with the even-odd rule, so holes must not overlap each
 * other or driver's own hole: an overlap would be filled (dimmed) again.
 */
export function boxMinus(box: SpotlightBox, cut: SpotlightBox): SpotlightBox[] {
  if (isEmpty(box)) return [];
  const overlaps = cut.left < box.right && cut.right > box.left && cut.top < box.bottom && cut.bottom > box.top;
  if (isEmpty(cut) || !overlaps) return [box];
  const middleTop = Math.max(box.top, cut.top);
  const middleBottom = Math.min(box.bottom, cut.bottom);
  const parts: SpotlightBox[] = [
    { left: box.left, top: box.top, right: box.right, bottom: middleTop },
    { left: box.left, top: middleBottom, right: box.right, bottom: box.bottom },
    { left: box.left, top: middleTop, right: Math.max(box.left, cut.left), bottom: middleBottom },
    { left: Math.min(box.right, cut.right), top: middleTop, right: box.right, bottom: middleBottom },
  ];
  return parts.filter((part) => !isEmpty(part));
}

/** SVG sub-paths for extra holes, appended after driver's own path. */
export function cutoutPath(boxes: readonly SpotlightBox[]): string {
  const round = (value: number) => Math.round(value * 100) / 100;
  return boxes
    .map((box) => {
      const width = round(box.right - box.left);
      const height = round(box.bottom - box.top);
      return `M${round(box.left)},${round(box.top)} h${width} v${height} h-${width} z`;
    })
    .join(" ");
}

/** A stage with no size: what driver leaves behind after an anchorless step. */
export function isDegenerateStage(stage: StageRect | undefined | null): boolean {
  return !stage || stage.width < 1 || stage.height < 1;
}

/**
 * driver.js's own overlay path — the viewport, then one rounded hole around
 * `stage` — in the same form it writes, so the overlay can re-cut its hole
 * (around the part of the element its panes show) without a visible change
 * in shape.
 */
export function stageOverlayPath(stage: StageRect, padding: number, radius: number, viewport: { width: number; height: number }): string {
  const width = stage.width + padding * 2;
  const height = stage.height + padding * 2;
  const r = Math.floor(Math.max(Math.min(radius, width / 2, height / 2), 0));
  const x = stage.x - padding + r;
  const y = stage.y - padding;
  const h = width - r * 2;
  const v = height - r * 2;
  const { width: vw, height: vh } = viewport;
  return `M${vw},0L0,0L0,${vh}L${vw},${vh}L${vw},0Z
    M${x},${y} h${h} a${r},${r} 0 0 1 ${r},${r} v${v} a${r},${r} 0 0 1 -${r},${r} h-${h} a${r},${r} 0 0 1 -${r},-${r} v-${v} a${r},${r} 0 0 1 ${r},-${r} z`;
}

