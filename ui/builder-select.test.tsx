// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findTutorialAnchor, openListOf } from "../player/anchor";
import { BuilderCombobox, BuilderSelect } from "./builder-select";

let root: Root | undefined;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root?.unmount()); root = undefined; container.remove(); });

const controls = [
  { name: "select", Control: BuilderSelect, tag: "BUTTON" },
  { name: "combobox", Control: BuilderCombobox, tag: "INPUT" },
] as const;
const options = [{ value: "one", label: "One" }, { value: "two", label: "Two" }];

for (const { name, Control, tag } of controls) {
  describe(`${name} tutorial anchors`, () => {
    for (const variant of ["popover", "modal"] as const) {
      it(`anchors the real trigger and follows its ${variant} listbox without changing selection`, async () => {
        const onChange = vi.fn();
        function Fixture() {
          const [value, setValue] = useState("one");
          return <Control id="test-picker" aria-label="Choose a number" value={value} options={options}
            listboxVariant={variant} data-tutorial-id="demo.number" data-tutorial-aliases="demo.legacy demo.old-number"
            onChange={(next) => { onChange(next); setValue(next); }} />;
        }
        await act(async () => root!.render(<Fixture />));
        const trigger = findTutorialAnchor(document, "demo.number")!;
        expect(trigger.tagName).toBe(tag);
        expect(trigger).toBe(document.getElementById("test-picker"));
        expect(findTutorialAnchor(document, "demo.legacy")).toBe(trigger);
        expect(findTutorialAnchor(document, "demo.old-number")).toBe(trigger);
        expect(trigger.getAttribute("aria-expanded")).toBe("false");
        expect(openListOf(trigger)).toBeNull();

        await act(async () => trigger.click());
        const listbox = document.getElementById(trigger.getAttribute("aria-controls")!)!;
        expect(trigger.getAttribute("aria-expanded")).toBe("true");
        expect(listbox?.getAttribute("role")).toBe("listbox");
        expect(container.contains(listbox)).toBe(false);
        expect(openListOf(trigger)).toBe(listbox);
        expect(document.querySelectorAll('[data-tutorial-id="demo.number"]')).toHaveLength(1);

        await act(async () => listbox.querySelectorAll<HTMLElement>('[role="option"]')[1].click());
        expect(onChange).toHaveBeenCalledExactlyOnceWith("two");
        expect(findTutorialAnchor(document, "demo.number")).toBe(trigger);
        expect(trigger.getAttribute("aria-expanded")).toBe("false");
        expect(trigger.hasAttribute("aria-controls")).toBe(false);
        expect(openListOf(trigger)).toBeNull();
        expect(document.getElementById(listbox.id)).toBeNull();
      });
    }
  });
}
