import type { TutorialFocusHighlight } from "../core/schema";
import { findTutorialAnchor, visibleBoxOf } from "./anchor";
import { DEFAULT_TUTORIAL_DOM_POLICY, type TutorialDomPolicy } from "./dom-policy";
import { visibleClientRect } from "./visibility";
import { boxMinus, paddedBox, type SpotlightBox } from "./spotlight";

export interface FocusRect { x: number; y: number; width: number; height: number }
export interface ResolvedFocusHighlight { highlight: TutorialFocusHighlight; rect: FocusRect }

/** Relative coordinates follow the named window/area when it moves or resizes. */
export function relativeFocusRect(area: FocusRect, rect: FocusRect): FocusRect {
  return { x: area.x + rect.x * area.width, y: area.y + rect.y * area.height,
    width: rect.width * area.width, height: rect.height * area.height };
}
export function resolveFocusHighlights(doc: Document, highlights: readonly TutorialFocusHighlight[] = [], domPolicy: TutorialDomPolicy = DEFAULT_TUTORIAL_DOM_POLICY): ResolvedFocusHighlight[] {
  return highlights.flatMap((highlight) => {
    const anchor = findTutorialAnchor(doc, highlight.target.anchor, domPolicy);
    if (!anchor?.isConnected) return [];
    const element = visibleBoxOf(anchor);
    const full = element.getBoundingClientRect();
    const visible = visibleClientRect(element, true);
    if (full.width < 1 || full.height < 1 || visible.width < 1 || visible.height < 1) return [];
    const raw = highlight.target.kind === "element" ? visible : relativeFocusRect(full, highlight.target.rect);
    const x = Math.max(raw.x, visible.x, 0), y = Math.max(raw.y, visible.y, 0);
    const right = Math.min(raw.x + raw.width, visible.x + visible.width, doc.documentElement.clientWidth || Infinity);
    const bottom = Math.min(raw.y + raw.height, visible.y + visible.height, doc.documentElement.clientHeight || Infinity);
    return right - x >= 1 && bottom - y >= 1 ? [{ highlight, rect: { x, y, width: right - x, height: bottom - y } }] : [];
  });
}
/** Even-odd SVG cutouts must be disjoint, including overlapping focus areas. */
export function additionalFocusCutouts(rects: readonly FocusRect[], existing: readonly SpotlightBox[], padding = 4): SpotlightBox[] {
  const result: SpotlightBox[] = [];
  for (const rect of rects) {
    let pieces = [paddedBox(rect, padding)];
    for (const occupied of [...existing, ...result]) pieces = pieces.flatMap((piece) => boxMinus(piece, occupied));
    result.push(...pieces);
  }
  return result;
}

/** Visible annotation extents, including the red shaft/head outside a box. */
export function focusAnnotationAvoidRects(resolved:readonly ResolvedFocusHighlight[]):SpotlightBox[]{return resolved.flatMap(({highlight,rect})=>{
 const result=[paddedBox(rect,8)];if(highlight.style==='box')return result;
 const {x,y,width,height}=rect,side=highlight.arrowFrom,to=side==='left'?{x:x-3,y:y+height/2}:side==='right'?{x:x+width+3,y:y+height/2}:side==='top'?{x:x+width/2,y:y-3}:{x:x+width/2,y:y+height+3},dx=side==='left'?1:side==='right'?-1:0,dy=side==='top'?1:side==='bottom'?-1:0;
 const points=[to,{x:to.x-dx*38,y:to.y-dy*38},{x:to.x-dx*9-dy*5,y:to.y-dy*9+dx*5},{x:to.x-dx*9+dy*5,y:to.y-dy*9-dx*5}],left=Math.min(...points.map(p=>p.x))-2,top=Math.min(...points.map(p=>p.y))-2,right=Math.max(...points.map(p=>p.x))+2,bottom=Math.max(...points.map(p=>p.y))+2;
 result.push(paddedBox({x:left,y:top,width:right-left,height:bottom-top},8));return result
})}

/** Same inert annotation renderer for the live player, studio, and screenshot capture. */
export function drawFocusHighlights(doc: Document, root: HTMLElement, highlights: readonly TutorialFocusHighlight[] = [], domPolicy: TutorialDomPolicy = DEFAULT_TUTORIAL_DOM_POLICY): number {
  const resolved = resolveFocusHighlights(doc, highlights, domPolicy);
  for (const { highlight, rect } of resolved) {
    const { x, y, width, height } = rect;
    const item = doc.createElement("div");
    item.dataset.tutorialFocus = highlight.id;
    item.setAttribute("aria-hidden", "true");
    item.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:${width}px;height:${height}px;pointer-events:none;box-sizing:border-box;`;
    if (highlight.style !== "arrow") item.style.cssText += "background:rgba(250,204,21,.42);border:1px solid rgba(202,138,4,.85);border-radius:2px;";
    if (highlight.label) item.title = highlight.label;
    root.append(item);
    if (highlight.style === "box") continue;
    const ns = "http://www.w3.org/2000/svg";
    const svg = doc.createElementNS(ns, "svg");
    svg.dataset.tutorialFocusArrow = highlight.id;
    svg.setAttribute("width", "1"); svg.setAttribute("height", "1");
    svg.style.cssText = "position:fixed;left:0;top:0;overflow:visible;pointer-events:none;";
    const side = highlight.arrowFrom;
    const to = side === "left" ? { x: x - 3, y: y + height / 2 } : side === "right" ? { x: x + width + 3, y: y + height / 2 }
      : side === "top" ? { x: x + width / 2, y: y - 3 } : { x: x + width / 2, y: y + height + 3 };
    const dx = side === "left" ? 1 : side === "right" ? -1 : 0;
    const dy = side === "top" ? 1 : side === "bottom" ? -1 : 0;
    const from = { x: to.x - dx * 38, y: to.y - dy * 38 };
    const line = doc.createElementNS(ns, "path");
    line.setAttribute("d", `M${from.x},${from.y} L${to.x},${to.y} M${to.x - dx * 9 - dy * 5},${to.y - dy * 9 + dx * 5} L${to.x},${to.y} L${to.x - dx * 9 + dy * 5},${to.y - dy * 9 - dx * 5}`);
    line.setAttribute("fill", "none"); line.setAttribute("stroke", "#dc2626");
    line.setAttribute("stroke-width", "3"); line.setAttribute("stroke-linecap", "round"); line.setAttribute("stroke-linejoin", "round");
    svg.append(line); root.append(svg);
  }
  return resolved.length;
}


