// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { isTutorialAnchorFullyVisible, visibleClientRect } from "./visibility";

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** An element with a fixed rect, since happy-dom lays nothing out. */
function element(box: Box, overflow?: "auto" | "visible"): HTMLElement {
  const node = document.createElement("div");
  if (overflow) node.style.overflowY = overflow;
  node.getBoundingClientRect = () => ({
    top: box.top,
    left: box.left,
    bottom: box.top + box.height,
    right: box.left + box.width,
    width: box.width,
    height: box.height,
    x: box.left,
    y: box.top,
    toJSON: () => ({}),
  }) as DOMRect;
  return node;
}

/** Anchor inside a scrolling pane, both mounted so isConnected holds. */
function mount(pane: Box, anchor: Box): HTMLElement {
  const paneElement = element(pane, "auto");
  const anchorElement = element(anchor);
  paneElement.append(anchorElement);
  document.body.append(paneElement);
  return anchorElement;
}

describe("isTutorialAnchorFullyVisible", () => {
  it("wants a control that fits to sit inside its pane", () => {
    const pane = { top: 100, left: 0, width: 300, height: 400 };
    expect(isTutorialAnchorFullyVisible(mount(pane, { top: 140, left: 10, width: 200, height: 40 }))).toBe(true);
    // Scrolled under the pane header: an on-screen rect, but not available.
    expect(isTutorialAnchorFullyVisible(mount(pane, { top: 60, left: 10, width: 200, height: 40 }))).toBe(false);
  });

  it("accepts a region taller than its pane while it fills the pane", () => {
    const pane = { top: 100, left: 0, width: 300, height: 400 };
    // An inspector group list with one group expanded: it runs past both pane
    // edges, which is what looking at part of a long region looks like.
    expect(isTutorialAnchorFullyVisible(mount(pane, { top: 40, left: 10, width: 200, height: 900 }))).toBe(true);
    // Scrolled until only its last 20px sit inside the pane: ask for it back.
    expect(isTutorialAnchorFullyVisible(mount(pane, { top: -780, left: 10, width: 200, height: 900 }))).toBe(false);
  });
  it("judges a row wider than its pane by the part the pane shows", () => {
    // A table row runs past the window's right edge in layout, but its
    // horizontally scrolling pane cuts it off inside the window.
    // The desktop around the window scrolls as well, and is narrower than
    // the row's full width reaches.
    const desktop = element({ top: 0, left: 0, width: 1320, height: 860 });
    desktop.style.overflowX = "auto";
    desktop.style.overflowY = "auto";
    const paneElement = element({ top: 100, left: 350, width: 800, height: 400 });
    paneElement.style.overflowX = "auto";
    paneElement.style.overflowY = "auto";
    const row = element({ top: 300, left: 352, width: 1100, height: 20 });
    paneElement.append(row);
    desktop.append(paneElement);
    document.body.append(desktop);
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1320 });
    expect(isTutorialAnchorFullyVisible(row)).toBe(true);
  });
  it("reports the part of a wide row its pane shows, for the ring and the dim's hole", () => {
    const paneElement = element({ top: 100, left: 350, width: 800, height: 400 });
    paneElement.style.overflowX = "auto";
    paneElement.style.overflowY = "auto";
    const row = element({ top: 300, left: 230, width: 1100, height: 20 });
    paneElement.append(row);
    document.body.append(paneElement);
    const shown = visibleClientRect(row);
    expect([shown.left, shown.top, shown.width, shown.height]).toEqual([350, 300, 800, 20]);
  });
  it("is not clipped by a scroll container an absolutely positioned dialog escapes", () => {
    // A dialog in a modal layer inside the encounter window's scrolling
    // tab page, positioned against the window, sits above the page's top edge.
    const windowFrame = element({ top: 80, left: 140, width: 800, height: 770 });
    windowFrame.style.position = "relative";
    const tabPage = element({ top: 380, left: 144, width: 790, height: 470 });
    tabPage.style.overflowX = "auto";
    tabPage.style.overflowY = "auto";
    const layer = element({ top: 84, left: 140, width: 940, height: 768 });
    layer.style.position = "absolute";
    const field = element({ top: 296, left: 390, width: 52, height: 19 });
    layer.append(field);
    tabPage.append(layer);
    windowFrame.append(tabPage);
    document.body.append(windowFrame);
    expect(isTutorialAnchorFullyVisible(field)).toBe(true);
  });
});

