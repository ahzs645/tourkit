// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";

import { findTutorialAnchor, openListOf, resolveRingElement, topmostApplicationDialog, visibleBoxOf } from "./anchor";

afterEach(() => {
  document.body.innerHTML = "";
});

/* A drop-down whose list is portalled away from it, the way desktop-style
   emulated selects and menu bars draw theirs. */
function dropDown({ open }: { open: boolean }) {
  document.body.innerHTML = `
    <span data-tutorial-id="field.type">
      <select aria-haspopup="listbox" aria-expanded="${open}" ${open ? 'aria-controls="list-1"' : ""}></select>
    </span>
    <div data-tutorial-id="elsewhere"></div>
    ${open ? '<div id="list-1" role="listbox"><div role="option">Next of Kin</div></div>' : ""}
  `;
  return document.querySelector<HTMLElement>('[data-tutorial-id="field.type"]')!;
}

describe("ring hand-off to an open list", () => {
  it("rings the field while its list is closed", () => {
    const field = dropDown({ open: false });
    expect(openListOf(field)).toBeNull();
    expect(resolveRingElement(field, null)).toBe(field);
  });

  it("rings the list, found through the control's aria-controls, while it is open", () => {
    const field = dropDown({ open: true });
    const list = document.getElementById("list-1");
    expect(openListOf(field)).toBe(list);
    expect(resolveRingElement(field, null)).toBe(list);
  });

  it("follows the step's target, not its anchor, when the step names one", () => {
    dropDown({ open: true });
    const region = document.querySelector<HTMLElement>('[data-tutorial-id="elsewhere"]')!;
    expect(resolveRingElement(region, "field.type")).toBe(document.getElementById("list-1"));
  });

  it("accepts the control itself carrying the anchor", () => {
    dropDown({ open: true });
    const select = document.querySelector<HTMLElement>("select")!;
    expect(openListOf(select)).toBe(document.getElementById("list-1"));
  });

  it("looks past driver.js's own aria-controls on the spotlit element", () => {
    const field = dropDown({ open: true });
    field.setAttribute("aria-expanded", "true");
    field.setAttribute("aria-controls", "driver-popover-content");
    expect(openListOf(field)).toBe(document.getElementById("list-1"));
  });

  it("finds no list for an anchorless step, whatever is expanded elsewhere on the page", () => {
    dropDown({ open: true });
    expect(openListOf(document.body)).toBeNull();
    expect(resolveRingElement(document.body, null)).toBe(document.body);
  });

  it("keeps a region whose own open list sits inside it", () => {
    // The Palette: a search box that always reports its results list open,
    // with that list inside the Palette itself.
    document.body.innerHTML = `
      <div data-tutorial-id="palette">
        <input role="combobox" aria-expanded="true" aria-controls="results">
        <div id="results" role="listbox"><button data-tutorial-id="add-text">Text</button></div>
      </div>`;
    const palette = document.querySelector<HTMLElement>('[data-tutorial-id="palette"]')!;
    expect(openListOf(palette)).toBeNull();
    expect(resolveRingElement(palette, "add-text")).toBe(document.querySelector('[data-tutorial-id="add-text"]'));
  });

  it("ignores a controls id that is not on the page", () => {
    const field = dropDown({ open: true });
    document.getElementById("list-1")!.remove();
    expect(resolveRingElement(field, null)).toBe(field);
  });
});

describe("the visible box of a styled checkbox", () => {
  const sized = (el: Element, width: number, height: number) => {
    el.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, width, height, right: width, bottom: height, toJSON: () => ({}) });
  };

  it("rings the label when the anchored input itself has no size", () => {
    document.body.innerHTML = '<label class="pb-check"><input type="checkbox" data-tutorial-id="cell.x"><span></span></label>';
    const input = document.querySelector<HTMLElement>("input")!;
    const label = document.querySelector("label")!;
    sized(input, 0, 0);
    sized(label, 13, 13);
    expect(visibleBoxOf(input)).toBe(label);
    expect(resolveRingElement(input, null)).toBe(label);
  });

  it("keeps an element that has a size of its own", () => {
    document.body.innerHTML = '<label><input type="checkbox"></label>';
    const input = document.querySelector<HTMLElement>("input")!;
    sized(input, 13, 13);
    expect(visibleBoxOf(input)).toBe(input);
  });
});

describe("the application dialog an anchorless step lights", () => {
  it("resolves the foreground emulated window above duplicate chart controls and a lower modal", () => {
    document.body.innerHTML = `
      <button data-tutorial-id="host.mois.lookup.chart" id="chart">Chart lookup</button>
      <div class="pb-modal-layer" style="z-index:90"><div class="pb-window" id="foreground">
        <button data-tutorial-id="host.mois.lookup.chart" id="lookup">Patient lookup</button>
      </div></div>
      <div class="pb-modal-layer" style="z-index:70"><div class="pb-window" id="under">
        <button data-tutorial-id="host.mois.lookup.chart">Underlying lookup</button>
      </div></div>`;
    for (const element of document.querySelectorAll<HTMLElement>(".pb-window, button")) {
      element.getClientRects = () => [{ width: 10, height: 10 }] as unknown as DOMRectList;
    }
    expect(topmostApplicationDialog(document)?.id).toBe("foreground");
    expect(findTutorialAnchor(document, "host.mois.lookup.chart")?.id).toBe("lookup");
    document.querySelector("#foreground")!.insertAdjacentHTML("beforeend", '<button data-tutorial-id="host.mois.lookup.chart">Duplicate in same window</button>');
    const duplicate = document.querySelector<HTMLElement>("#foreground button:last-child")!;
    duplicate.getClientRects = () => [{ width: 10, height: 10 }] as unknown as DOMRectList;
    expect(findTutorialAnchor(document, "host.mois.lookup.chart")).toBeNull();
  });

  it("is the topmost open modal, never the tutorial's own card", () => {
    document.body.innerHTML = `
      <div role="dialog" aria-modal="true" id="under">Settings</div>
      <div role="dialog" aria-modal="true" id="gallery">Select component</div>
      <div data-tutorial-surface><div role="dialog" aria-modal="true" id="card">Step 2</div></div>
    `;
    // happy-dom reports no layout boxes; give the dialogs one.
    for (const dialog of document.querySelectorAll<HTMLElement>('[role="dialog"]')) {
      dialog.getClientRects = () => [{ width: 10, height: 10 }] as unknown as DOMRectList;
    }
    expect(topmostApplicationDialog(document)?.id).toBe("gallery");
  });

  it("is absent when no modal is open", () => {
    document.body.innerHTML = `<main>Workspace</main>`;
    expect(topmostApplicationDialog(document)).toBeNull();
  });
});

