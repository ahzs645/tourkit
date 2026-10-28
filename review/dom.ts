import { REVIEW_ANCHOR_ATTRIBUTES, type ReviewAnchor, type ReviewAnchorAttribute } from "./model";

/**
 * Finding and following the preview elements feedback is anchored to. Every
 * preview renderer marks a field's element with one of
 * REVIEW_ANCHOR_ATTRIBUTES (or sits inside a same-origin iframe), so the
 * same lookups work on every renderer.
 */

/** The attributes a surface anchors to; forms by default. */
export type AnchorAttributes = readonly string[];
const selectorFor = (attributes: AnchorAttributes) => attributes.map((attribute) => `[${attribute}]`).join(", ");
/** Marks the feedback layer so lookups and snapshots skip it. */
export const REVIEW_OVERLAY_ATTRIBUTE = "data-review-overlay";

export interface AnchorHit {
  element: HTMLElement;
  attribute: ReviewAnchorAttribute;
  value: string;
  /** Viewport rectangle (iframe content translated into the top document). */
  rect: DOMRect;
}

function attributeOf(element: Element, attributes: AnchorAttributes): ReviewAnchorAttribute | null {
  return attributes.find((attribute) => element.hasAttribute(attribute)) ?? null;
}

function isShown(element: HTMLElement): boolean {
  if (element.closest('[hidden], [aria-hidden="true"]')) return false;
  const view = element.ownerDocument.defaultView;
  const style = view?.getComputedStyle(element);
  if (!style || style.display === "none" || style.visibility === "hidden") return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0;
}

/** `display: contents` wrappers have no box: use their children's union. */
function boxOf(element: HTMLElement): DOMRect {
  const rect = element.getBoundingClientRect();
  if (rect.width > 0 || rect.height > 0) return rect;
  const children = Array.from(element.children).map((child) => child.getBoundingClientRect()).filter((child) => child.width > 0 || child.height > 0);
  if (!children.length) return rect;
  const left = Math.min(...children.map((child) => child.left));
  const top = Math.min(...children.map((child) => child.top));
  return new DOMRect(left, top, Math.max(...children.map((child) => child.right)) - left, Math.max(...children.map((child) => child.bottom)) - top);
}

/**
 * The part of `rect` its scrolling ancestors actually show, or null when it
 * is scrolled out of view (a canvas that scrolls inside the page, so a
 * field can sit "under" the banner above it without being visible).
 */
function clipToScrollers(element: HTMLElement, rect: DOMRect): DOMRect | null {
  let left = rect.left, top = rect.top, right = rect.right, bottom = rect.bottom;
  const view = element.ownerDocument.defaultView;
  for (let node = element.parentElement; node && node !== element.ownerDocument.body; node = node.parentElement) {
    const style = view?.getComputedStyle(node);
    if (!style || !/(auto|scroll|hidden|clip)/.test(`${style.overflow}${style.overflowX}${style.overflowY}`)) continue;
    const box = node.getBoundingClientRect();
    // A wrapper with no box of its own (display: contents) clips nothing.
    if (box.width === 0 && box.height === 0) continue;
    left = Math.max(left, box.left); top = Math.max(top, box.top);
    right = Math.min(right, box.right); bottom = Math.min(bottom, box.bottom);
    if (right <= left || bottom <= top) return null;
  }
  return new DOMRect(left, top, right - left, bottom - top);
}

/** The root and every same-origin iframe document inside it, with the offset to the top document. */
function documentsIn(root: HTMLElement): Array<{ scope: ParentNode; offsetX: number; offsetY: number }> {
  const scopes: Array<{ scope: ParentNode; offsetX: number; offsetY: number }> = [{ scope: root, offsetX: 0, offsetY: 0 }];
  root.querySelectorAll("iframe").forEach((frame) => {
    try {
      const body = frame.contentDocument?.body;
      if (!body) return;
      const rect = frame.getBoundingClientRect();
      scopes.push({ scope: body, offsetX: rect.left + frame.clientLeft, offsetY: rect.top + frame.clientTop });
    } catch {
      // A cross-origin frame does not expose its document.
    }
  });
  return scopes;
}

const shift = (rect: DOMRect, x: number, y: number) => new DOMRect(rect.left + x, rect.top + y, rect.width, rect.height);

/** The anchored element the reviewer pointed at, innermost first. */
export function anchorAtPoint(root: HTMLElement, clientX: number, clientY: number, attributes: AnchorAttributes = REVIEW_ANCHOR_ATTRIBUTES): AnchorHit | null {
  const selector = selectorFor(attributes);
  const stack = root.ownerDocument.elementsFromPoint(clientX, clientY)
    .filter((element) => root.contains(element) && !element.closest(`[${REVIEW_OVERLAY_ATTRIBUTE}]`));
  for (const element of stack) {
    if (element instanceof HTMLIFrameElement) {
      try {
        const doc = element.contentDocument;
        if (!doc) continue;
        const frameRect = element.getBoundingClientRect();
        const x = clientX - frameRect.left - element.clientLeft;
        const y = clientY - frameRect.top - element.clientTop;
        const inner = doc.elementFromPoint(x, y)?.closest(selector) as HTMLElement | null;
        const attribute = inner && attributeOf(inner, attributes);
        if (inner && attribute) return { element: inner, attribute, value: inner.getAttribute(attribute) ?? "", rect: shift(boxOf(inner), frameRect.left + element.clientLeft, frameRect.top + element.clientTop) };
      } catch {
        continue;
      }
    }
    const anchored = element.closest(selector) as HTMLElement | null;
    if (anchored && root.contains(anchored)) {
      const attribute = attributeOf(anchored, attributes)!;
      return { element: anchored, attribute, value: anchored.getAttribute(attribute) ?? "", rect: boxOf(anchored) };
    }
  }
  return null;
}

/** Every visible anchored element, outermost per field. */
export function visibleAnchors(root: HTMLElement, attributes: AnchorAttributes = REVIEW_ANCHOR_ATTRIBUTES): AnchorHit[] {
  const hits: AnchorHit[] = [];
  for (const { scope, offsetX, offsetY } of documentsIn(root)) {
    scope.querySelectorAll<HTMLElement>(selectorFor(attributes)).forEach((element) => {
      if (element.closest(`[${REVIEW_OVERLAY_ATTRIBUTE}]`) || !isShown(element)) return;
      const shown = clipToScrollers(element, boxOf(element));
      if (!shown) return;
      const attribute = attributeOf(element, attributes)!;
      hits.push({ element, attribute, value: element.getAttribute(attribute) ?? "", rect: shift(shown, offsetX, offsetY) });
    });
  }
  return hits;
}

/** The nearest visible field to a point (within `maxDistance` CSS pixels). */
export function nearestAnchor(root: HTMLElement, clientX: number, clientY: number, maxDistance = 480, attributes: AnchorAttributes = REVIEW_ANCHOR_ATTRIBUTES): AnchorHit | null {
  let best: AnchorHit | null = null;
  let bestDistance = maxDistance;
  for (const hit of visibleAnchors(root, attributes)) {
    const dx = Math.max(hit.rect.left - clientX, 0, clientX - hit.rect.right);
    const dy = Math.max(hit.rect.top - clientY, 0, clientY - hit.rect.bottom);
    const distance = Math.hypot(dx, dy);
    // Prefer the smaller (more specific) element at equal distance.
    if (distance < bestDistance || (best && distance === bestDistance && hit.rect.width * hit.rect.height < best.rect.width * best.rect.height)) {
      best = hit;
      bestDistance = distance;
    }
  }
  return best;
}

/** Where an anchor's element is now, or null when it is not on screen (another page, hidden, scrolled away). */
export function locateAnchor(root: HTMLElement, anchor: Pick<ReviewAnchor, "attribute" | "value">): DOMRect | null {
  if (!anchor.attribute || anchor.value === null) return root.getBoundingClientRect();
  const selector = `[${anchor.attribute}="${CSS.escape(anchor.value)}"]`;
  for (const { scope, offsetX, offsetY } of documentsIn(root)) {
    for (const element of scope.querySelectorAll<HTMLElement>(selector)) {
      if (element.closest(`[${REVIEW_OVERLAY_ATTRIBUTE}]`) || !isShown(element)) continue;
      const box = boxOf(element);
      // Scrolled out of its container: hidden, like a field on another page.
      if (!clipToScrollers(element, box)) return null;
      return shift(box, offsetX, offsetY);
    }
  }
  return null;
}

/** A visible label for an anchored element when the builder has no field for it. */
export function labelNear(element: HTMLElement): string | null {
  const labelled = element.getAttribute("aria-label") ?? element.querySelector("label, legend, [data-powerform-input='label']")?.textContent;
  const text = (labelled ?? element.textContent ?? "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 80) : null;
}

