// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { StepFocusHighlights } from "./step-focus-highlights";
import type { TutorialFocusHighlight } from "../core/schema";
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { document.body.replaceChildren(); });
it("authors mixed element/relative focus areas and removes one independently", async () => {
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  let highlights: TutorialFocusHighlight[] | undefined;
  const render = () => root.render(<StepFocusHighlights defaultAnchor="report.window" highlights={highlights} onChange={(next) => { highlights = next; render(); }} />);
  const click = async (text: string) => { const button = [...container.querySelectorAll("button")].find((item) => item.textContent === text)!; expect(button).toBeTruthy(); await act(async () => { button.click(); }); };
  try {
    await act(async () => { render(); });
    await click("Add element by ID"); await click("Add relative area");
    expect(highlights).toHaveLength(2); expect(new Set(highlights!.map((item) => item.id)).size).toBe(2);
    expect(highlights![0].target).toEqual({ kind: "element", anchor: "report.window" });
    expect(highlights![1].target.kind).toBe("area");
    const remove = container.querySelector<HTMLButtonElement>('[aria-label="Remove highlight 1"]')!;
    await act(async () => { remove.click(); });
    expect(highlights).toHaveLength(1); expect(highlights![0].target.kind).toBe("area");
  } finally { await act(async () => { root.unmount(); }); }
});

