// @vitest-environment node
import { describe, expect, it } from "vitest";
import { Window } from "happy-dom";
import { buildNativeCaptureAnchorScript, buildNativeCaptureBoundsScript } from "./native-capture-helper.mjs";

describe("portable native crop adapter", () => {
  it("runs in a fresh browser context and applies an explicit host region policy", async () => {
    const browser = new Window({ width: 1200, height: 800 });
    browser.document.body.innerHTML = '<div data-capture="workspace"></div>';
    const region = browser.document.querySelector("div")!;
    region.getBoundingClientRect = () => new browser.DOMRect(100, 80, 500, 400);
    Object.defineProperty(region, "checkVisibility", { value: () => true });
    browser.eval(await buildNativeCaptureBoundsScript({ regionSelector: '[data-capture="workspace"]' }));
    const bounds = (browser as unknown as { __wfNativeBounds: (doc: unknown, margin: number) => unknown }).__wfNativeBounds(browser.document, 20);
    expect(bounds).toEqual({ x: 80, y: 60, width: 540, height: 440 });
    await browser.happyDOM.close();
  });
  it("defaults to the full viewport without assuming a host window class", async () => {
    const browser = new Window({ width: 1200, height: 800 });
    browser.eval(await buildNativeCaptureBoundsScript());
    expect((browser as unknown as { __wfNativeBounds: (doc: unknown, margin: number) => unknown }).__wfNativeBounds(browser.document, 16)).toEqual({ x: 0, y: 0, width: 1200, height: 800 });
    await browser.happyDOM.close();
  });
});

describe("portable native highlight adapter", () => {
  function page(html: string) {
    const browser = new Window({ width: 1200, height: 800 });
    browser.document.body.innerHTML = html;
    for (const element of browser.document.body.querySelectorAll("*")) {
      const box = new browser.DOMRect(100, 80, 200, 40);
      element.getBoundingClientRect = () => box;
      Object.defineProperty(element, "getClientRects", { value: () => [box] });
    }
    return browser;
  }
  function ringElement(browser: Window, anchor: string, target?: string) {
    return (browser as unknown as {
      __wfNativeRingElement: (document: unknown, step: { anchor: { id: string }; target?: { id: string } }) => HTMLElement | null;
    }).__wfNativeRingElement(browser.document, { anchor: { id: anchor }, ...(target ? { target: { id: target } } : {}) });
  }

  it("uses the live anchor when a hidden duplicate precedes it", async () => {
    const browser = page('<div hidden><button data-tutorial-id="save">Hidden save</button></div><button id="visible" data-tutorial-id="save">Save</button>');
    try {
      browser.eval(await buildNativeCaptureAnchorScript());
      expect(ringElement(browser, "save")).toBe(browser.document.getElementById("visible"));
    } finally { await browser.happyDOM.close(); }
  });

  it("uses the target in the foreground host window, including aliases, without replacing the crop adapter", async () => {
    const browser = page(`
      <button data-tutorial-id="save">Page save</button>
      <section class="capture-window" style="z-index:30"><button id="foreground" data-tutorial-aliases="save submit">Save</button></section>
      <section class="capture-window" style="z-index:10"><button data-tutorial-id="save">Background save</button></section>
      <button data-tutorial-id="fallback">Fallback</button>
    `);
    try {
      browser.eval("window.__wfNativeBounds = () => ({ x: 7, y: 8, width: 90, height: 100 });");
      browser.eval(await buildNativeCaptureAnchorScript({ domPolicy: {
        applicationDialogSelector: "",
        floatingWindowSelector: ".capture-window",
        stepExpectsDialog: () => { throw new Error("A highlight must not serialize or execute host outcome predicates."); },
      } }));
      expect(ringElement(browser, "fallback", "save")).toBe(browser.document.getElementById("foreground"));
      expect(browser.eval("window.__wfNativeBounds()")).toEqual({ x: 7, y: 8, width: 90, height: 100 });
    } finally { await browser.happyDOM.close(); }
  });

  it("does not choose an arbitrary live duplicate and follows an anchored control's open popup", async () => {
    const browser = page(`
      <button data-tutorial-id="ambiguous">One</button><button data-tutorial-id="ambiguous">Two</button>
      <button data-tutorial-id="priority" aria-expanded="true" aria-controls="options">Priority</button>
      <div id="options" role="listbox">High</div>
    `);
    try {
      browser.eval(await buildNativeCaptureAnchorScript());
      expect(ringElement(browser, "ambiguous")).toBeNull();
      expect(ringElement(browser, "priority")).toBe(browser.document.getElementById("options"));
    } finally { await browser.happyDOM.close(); }
  });
});
