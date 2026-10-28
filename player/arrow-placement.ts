import type { CardRect } from "./card-placement";

/** Edge-to-edge pointer, kept outside both boxes and shortened near its target.
 * Placement principles: https://floating-ui.com/docs/arrow and /docs/flip.
 * Geometry is local, rather than copied from a library's caret implementation.
 */
export function tutorialArrow(card: CardRect, target: CardRect, viewport: { width: number; height: number }) {
  if (card.left < target.right && card.right > target.left && card.top < target.bottom && card.bottom > target.top) return null;
  if (target.right <= 0 || target.bottom <= 0 || target.left >= viewport.width || target.top >= viewport.height) return null;
  const a = { x: (card.left + card.right) / 2, y: (card.top + card.bottom) / 2 };
  const b = { x: (target.left + target.right) / 2, y: (target.top + target.bottom) / 2 };
  const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
  if (!length || target.right <= target.left || target.bottom <= target.top) return null;
  const cardScale = Math.min(dx ? (card.right - card.left) / 2 / Math.abs(dx) : Infinity, dy ? (card.bottom - card.top) / 2 / Math.abs(dy) : Infinity);
  const targetScale = Math.min(dx ? (target.right - target.left) / 2 / Math.abs(dx) : Infinity, dy ? (target.bottom - target.top) / 2 / Math.abs(dy) : Infinity);
  const end = { x: b.x - dx * targetScale - dx / length * 10, y: b.y - dy * targetScale - dy / length * 10 };
  const available = length * (1 - cardScale - targetScale) - 18;
  if (available < 28) return null;
  const distance = Math.min(120, available);
  const start = { x: end.x - dx / length * distance, y: end.y - dy / length * distance };
  if ([start, end].some((p) => p.x < 4 || p.y < 4 || p.x > viewport.width - 4 || p.y > viewport.height - 4)) return null;
  return { start, end };
}

