// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { tutorialCaptureBounds } from "./capture-bounds";

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });
function windowRect(x: number, y: number, width: number, height: number, popup = false) {
  const element = document.createElement("div");
  if (popup) element.dataset.trainingPopup = "menu"; else element.className = "training-window";
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue(new DOMRect(x, y, width, height));
  element.checkVisibility = vi.fn(() => true);
  document.body.append(element);
  return element;
}
function host() {
  vi.spyOn(window, "innerWidth", "get").mockReturnValue(1920);
  vi.spyOn(window, "innerHeight", "get").mockReturnValue(1080);
}
describe("application-selected screenshot framing", () => {
  it("keeps a 16px margin and the window's natural proportions", () => {
    host(); windowRect(460, 172, 1000, 736);
    expect(tutorialCaptureBounds(document, { regionSelector: ".training-window, [data-training-popup]" })).toEqual({ x: 444, y: 156, width: 1032, height: 768 });
  });
  it("expands to include dialogs and menus extending outside the main window", () => {
    host(); windowRect(460, 172, 1000, 736); windowRect(1380, 860, 400, 200, true);
    expect(tutorialCaptureBounds(document, { regionSelector: ".training-window, [data-training-popup]" })).toEqual({ x: 444, y: 156, width: 1352, height: 920 });
  });
  it("ignores hidden and offscreen windows and clips margins at viewport edges", () => {
    host(); windowRect(0, 0, 1000, 736);
    windowRect(1500, 20, 300, 900).style.visibility = "hidden";
    windowRect(-2000, 0, 100, 100);
    expect(tutorialCaptureBounds(document, { regionSelector: ".training-window, [data-training-popup]" })).toEqual({ x: 0, y: 0, width: 1016, height: 752 });
  });
  it("keeps the complete viewport when the host supplies no region selector", () => {
    host(); windowRect(460, 172, 1000, 736);
    expect(tutorialCaptureBounds(document)).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });
});

