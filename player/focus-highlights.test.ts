// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { TutorialFocusHighlightsSchema } from "../core/schema";
import { additionalFocusCutouts, drawFocusHighlights, focusAnnotationAvoidRects, relativeFocusRect, resolveFocusHighlights } from "./focus-highlights";
import { syncStageOverlay } from "../studio/stage-overlay";
afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });
const highlights = () => TutorialFocusHighlightsSchema.parse([
  { id: "a", target: { kind: "element", anchor: "report.lastContact" }, style: "box" },
  { id: "b", target: { kind: "area", anchor: "report.window", rect: { x: .25, y: .5, width: .25, height: .1 } }, style: "both", arrowFrom: "right" },
]);
function fixture() {
  const area = document.createElement("div"); area.dataset.tutorialId = "report.window";
  const field = document.createElement("div"); field.dataset.tutorialId = "report.lastContact"; area.append(field); document.body.append(area);
  area.getBoundingClientRect = () => new DOMRect(100, 80, 600, 600);
  field.getBoundingClientRect = () => new DOMRect(150, 180, 60, 20);
  return { area, field };
}
describe("multi-focus geometry and rendering", () => {
  it("tracks a relative rectangle through window movement and resizing", () => {
    const { area } = fixture();
    expect(resolveFocusHighlights(document, highlights())[1].rect).toEqual({ x: 250, y: 380, width: 150, height: 60 });
    area.getBoundingClientRect = () => new DOMRect(20, 40, 400, 500);
    expect(resolveFocusHighlights(document, highlights())[1].rect).toEqual({ x: 120, y: 290, width: 100, height: 50 });
    expect(relativeFocusRect({ x: 1, y: 2, width: 200, height: 100 }, { x: .5, y: .5, width: .1, height: .2 })).toEqual({ x: 101, y: 52, width: 20, height: 20 });
  });
  it("skips missing, detached, or hidden areas without inventing a fallback location", () => {
    const { area, field } = fixture(); field.remove();
    expect(resolveFocusHighlights(document, highlights())).toHaveLength(1);
    area.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
    expect(resolveFocusHighlights(document, highlights())).toEqual([]);
  });
  it("does not draw an area wholly clipped by its scroll pane", () => {
    const { area } = fixture(); const scroll = document.createElement("div");
    scroll.style.overflowX = "hidden"; scroll.style.overflowY = "hidden";
    scroll.getBoundingClientRect = () => new DOMRect(0, 0, 40, 40);
    area.before(scroll); scroll.append(area);
    expect(resolveFocusHighlights(document, highlights())).toEqual([]);
  });
  it("renders both independent yellow areas and the authored red arrow without capturing pointer input", () => {
    fixture(); const root = document.createElement("div"); document.body.append(root);
    expect(drawFocusHighlights(document, root, highlights())).toBe(2);
    expect(root.querySelectorAll("[data-tutorial-focus]")).toHaveLength(2);
    expect(root.querySelectorAll("[data-tutorial-focus-arrow]")).toHaveLength(1);
    expect(root.querySelector('[data-tutorial-focus="b"]')?.getAttribute("style")).toContain("pointer-events: none");
    expect(root.querySelector("svg path")?.getAttribute("stroke")).toBe("#dc2626");
  });
  it("protects the red arrow shaft outside the yellow rectangle when placing cards", () => {
    fixture(); const resolved=resolveFocusHighlights(document,highlights()),avoid=focusAnnotationAvoidRects(resolved);
    expect(avoid).toHaveLength(3); // two highlighted areas plus the second area's arrow
    expect(avoid[2]).toEqual({left:393,top:395,right:451,bottom:425});
    expect(avoid[2].right).toBeGreaterThan(resolved[1].rect.x+resolved[1].rect.width+38);
  });
  it("shows focus-only reading steps in the studio even without an action anchor", () => {
    fixture(); const frame = { contentDocument: document } as HTMLIFrameElement;
    const result = syncStageOverlay(frame, [{ index: 0, title: "Compare", body: "Read both fields.", focused: true, pointer: false, highlights: highlights() }], { highlight: true, markers: false, card: false });
    expect(result.focusedFound).toBe(true); expect(document.querySelectorAll("[data-tutorial-focus]")).toHaveLength(2);
  });
  it("keeps the measured Studio/export card outside the authored focus region", () => {
    fixture();vi.spyOn(document.documentElement,'clientWidth','get').mockReturnValue(800);vi.spyOn(document.documentElement,'clientHeight','get').mockReturnValue(700);
    const original=HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){return 'studioCard' in this.dataset?new DOMRect(parseFloat(this.style.left),parseFloat(this.style.top),280,120):original.call(this)});
    const focus=TutorialFocusHighlightsSchema.parse([{id:'instruction-focus',target:{kind:'area',anchor:'report.window',rect:{x:.25,y:.25,width:.25,height:.1}},style:'both',arrowFrom:'left'}]);
    syncStageOverlay({contentDocument:document} as HTMLIFrameElement,[{index:0,title:'Compare both',body:'Retain all highlighted areas',focused:true,anchorId:'report.lastContact',pointer:true,highlights:focus}],{highlight:true,markers:false,card:true});
    const card=document.querySelector<HTMLElement>('[data-studio-card]')!.getBoundingClientRect();
    for(const area of focusAnnotationAvoidRects(resolveFocusHighlights(document,focus)))expect(Math.max(0,Math.min(card.right,area.right)-Math.max(card.left,area.left))*Math.max(0,Math.min(card.bottom,area.bottom)-Math.max(card.top,area.top))).toBe(0);
  });
  it("keeps overlapping spotlight holes disjoint so intersections stay illuminated", () => {
    const existing = [{ left: 0, top: 0, right: 10, bottom: 10 }];
    const holes = additionalFocusCutouts([{ x: 5, y: 0, width: 10, height: 10 }, { x: 8, y: 0, width: 12, height: 10 }], existing, 0);
    expect(holes.reduce((n, h) => n + (h.right - h.left) * (h.bottom - h.top), 0)).toBe(100);
    const all = [...existing, ...holes];
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j]; expect(a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top).toBe(false);
    }
  });
});

