// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { tutorialPlacementRegion } from "./placement-region";

describe("tutorial card working region", () => {
  it("avoids the whole table of a checkbox, retaining headers and option labels", () => {
    const fieldset = document.createElement("fieldset");
    fieldset.innerHTML = '<table><tbody><tr><td><label><input type="checkbox"></label></td><td>Primary care assistant</td></tr></tbody></table>';
    expect(tutorialPlacementRegion(fieldset.querySelector("input")!)).toBe(fieldset.querySelector("table"));
  });
  it("uses labelled field groups and semantic grids", () => {
    for (const region of ['<fieldset><input></fieldset>', '<div role="group"><input></div>', '<div role="grid"><input></div>']) {
      const wrapper = document.createElement("div"); wrapper.innerHTML = region;
      expect(tutorialPlacementRegion(wrapper.querySelector("input")!)).toBe(wrapper.firstElementChild);
    }
  });
  it("lets the host explicitly identify a wider working panel", () => {
    const panel = document.createElement("div"); panel.dataset.tutorialCardRegion = "";
    panel.innerHTML = '<table><tbody><tr><td><button>Choose</button></td></tr></tbody></table>';
    expect(tutorialPlacementRegion(panel.querySelector("button")!)).toBe(panel);
  });
  it("keeps ordinary standalone controls as their own region", () => {
    const button = document.createElement("button");
    expect(tutorialPlacementRegion(button)).toBe(button);
  });
});

