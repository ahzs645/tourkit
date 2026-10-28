// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { Tooltip } from "./tooltip";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(async () => { await act(async () => root?.unmount()); host?.remove(); });

async function openBubble(props: { content: string; nowrap?: boolean }) {
  host = document.createElement("div"); document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(
    <TooltipPrimitive.Provider delayDuration={0}>
      <Tooltip {...props}><button type="button">?</button></Tooltip>
    </TooltipPrimitive.Provider>
  ));
  // Focus opens the bubble immediately.
  await act(async () => { host!.querySelector("span")!.dispatchEvent(new FocusEvent("focusin", { bubbles: true })); });
  const bubble = [...document.querySelectorAll<HTMLElement>("[data-side]")].find((el) => el.textContent?.includes(props.content));
  expect(bubble, "tooltip bubble").toBeDefined();
  return bubble!;
}

describe("Tooltip width", () => {
  it("wraps long explanations at the shared width by default", async () => {
    const bubble = await openBubble({ content: "Hidden from the person filling the form. Its answer is still saved." });
    expect(bubble.className).toContain("max-w-[240px]");
    expect(bubble.className).toContain("whitespace-normal");
    expect(bubble.className).not.toContain("whitespace-nowrap");
  });

  it("keeps one line only when asked", async () => {
    const bubble = await openBubble({ content: "Ctrl+K", nowrap: true });
    expect(bubble.className).toContain("whitespace-nowrap");
    expect(bubble.className).not.toContain("max-w-[240px]");
  });
});

