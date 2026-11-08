// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isAutomatedBrowser, placeTip, readDismissedTips, resetTips, Tip } from "./index";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const STORAGE_KEY = "test.tips:user-1";
let root: Root | undefined;
let container: HTMLDivElement | undefined;

async function mount(element: ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(element); });
}
async function rerender(element: ReactNode) {
  await act(async () => { root!.render(element); });
}
async function flush(ms = 20) {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
}
function shownTips() {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-tip]")).map((tip) => tip.dataset.tip);
}
function click(element: Element | null) {
  if (!element) throw new Error("missing element");
  act(() => { (element as HTMLElement).click(); });
}

beforeEach(() => {
  window.localStorage.clear();
  resetTips(STORAGE_KEY);
});
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  root = undefined;
  container?.remove();
  container = undefined;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("placeTip", () => {
  const viewport = { width: 1000, height: 800 };
  const anchor = { top: 100, bottom: 130, left: 200, right: 300, width: 100, height: 30 };

  it("places a bottom tip below the anchor with its tail on the anchor's centre", () => {
    const position = placeTip(anchor, { width: 300, height: 120 }, "bottom", viewport);
    expect(position.top).toBe(142);
    expect(position.left + position.tail).toBe(250);
  });

  it("clamps into the viewport and keeps the tail pointing at the anchor", () => {
    const nearRight = { ...anchor, left: 940, right: 990, width: 50 };
    const position = placeTip(nearRight, { width: 300, height: 120 }, "bottom", viewport);
    expect(position.left).toBe(1000 - 300 - 12);
    expect(position.left + position.tail).toBe(965);
  });
});

describe("Tip", () => {
  it("shows one tip at a time and holds the next one until a later page load", async () => {
    const tips = (
      <>
        <Tip tipKey="first" title="First" storageKey={STORAGE_KEY} suppressed={false}>One</Tip>
        <Tip tipKey="second" title="Second" storageKey={STORAGE_KEY} suppressed={false}>Two</Tip>
      </>
    );
    await mount(tips);
    expect(shownTips()).toEqual(["first"]);

    click(document.querySelector(".tourkit-tip__button--primary"));
    expect(shownTips()).toEqual([]);
    expect(readDismissedTips(STORAGE_KEY)).toEqual(["first"]);

    // A fresh page load (the cool-down cleared) shows the next tip, not the dismissed one.
    await act(async () => { root!.unmount(); });
    resetTipsCooldownOnly();
    root = createRoot(container!);
    await rerender(tips);
    expect(shownTips()).toEqual(["second"]);
  });

  it("keeps dismissals per storage key and brings them back on reset", async () => {
    await mount(<Tip tipKey="hello" title="Hello" storageKey={STORAGE_KEY} suppressed={false} />);
    click(document.querySelector(".tourkit-tip__close"));
    expect(shownTips()).toEqual([]);

    // Another user's dismissals are separate (after the page-wide cool-down, which a reset ends).
    act(() => resetTips("test.tips:user-2"));
    await rerender(<Tip tipKey="hello" title="Hello" storageKey="test.tips:user-2" suppressed={false} />);
    expect(shownTips()).toEqual(["hello"]);

    await rerender(<Tip tipKey="hello" title="Hello" storageKey={STORAGE_KEY} suppressed={false} />);
    expect(shownTips()).toEqual([]);
    act(() => resetTips(STORAGE_KEY));
    expect(shownTips()).toEqual(["hello"]);
  });

  it("dismisses on Escape unless a modal dialog or menu is open", async () => {
    await mount(<Tip tipKey="esc" title="Esc" storageKey={STORAGE_KEY} suppressed={false} />);
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    document.body.appendChild(menu);
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(shownTips()).toEqual(["esc"]);

    menu.remove();
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(shownTips()).toEqual([]);
  });

  it("stays hidden when suppressed", async () => {
    await mount(<Tip tipKey="quiet" title="Quiet" storageKey={STORAGE_KEY} suppressed />);
    expect(shownTips()).toEqual([]);
  });

  it("waits for its anchor, portals beside it and uses the host's class names", async () => {
    await mount(
      <Tip
        tipKey="anchored"
        anchor="[data-target]"
        placement="bottom"
        title="Anchored"
        storageKey={STORAGE_KEY}
        suppressed={false}
        hideAnchoredWhen={null}
        classPrefix="spotlight"
        dismissButtonClassName="btn btn--accent"
        closeIcon={<svg data-icon="x" />}
      >
        Body
      </Tip>,
    );
    expect(shownTips()).toEqual([]);

    const target = document.createElement("button");
    target.dataset.target = "";
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue(DOMRect.fromRect({ x: 200, y: 100, width: 100, height: 30 }));
    document.body.appendChild(target);
    await flush(300);

    const tip = document.querySelector<HTMLElement>('[data-tip="anchored"]');
    expect(tip).not.toBeNull();
    expect(container!.contains(tip)).toBe(false);
    expect(tip!.className).toBe("spotlight spotlight--bottom");
    expect(tip!.querySelector(".spotlight__tail")).not.toBeNull();
    expect(tip!.querySelector("[data-icon='x']")).not.toBeNull();
    expect(tip!.querySelector(".btn.btn--accent")?.textContent).toBe("Got it");
    expect(tip!.style.getPropertyValue("--spotlight-tail")).toMatch(/px$/);
    expect(tip!.getAttribute("aria-labelledby")).toBe(tip!.querySelector("h2")!.id);
  });

  it("runs the call to action and dismisses", async () => {
    const onCta = vi.fn();
    await mount(<Tip tipKey="cta" title="Try it" ctaLabel="Show me" onCta={onCta} storageKey={STORAGE_KEY} suppressed={false} />);
    click(Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "Show me") ?? null);
    expect(onCta).toHaveBeenCalledTimes(1);
    expect(readDismissedTips(STORAGE_KEY)).toEqual(["cta"]);
  });
});

describe("isAutomatedBrowser", () => {
  it("is true under webdriver unless the force flag is set", () => {
    vi.spyOn(navigator, "webdriver", "get").mockReturnValue(true);
    expect(isAutomatedBrowser("test.force")).toBe(true);
    window.localStorage.setItem("test.force", "1");
    expect(isAutomatedBrowser("test.force")).toBe(false);
  });
});

/** The cool-down lasts for the page; a reset is the test's stand-in for a reload. */
function resetTipsCooldownOnly() {
  const saved = window.localStorage.getItem(STORAGE_KEY);
  resetTips(STORAGE_KEY);
  if (saved !== null) window.localStorage.setItem(STORAGE_KEY, saved);
}
