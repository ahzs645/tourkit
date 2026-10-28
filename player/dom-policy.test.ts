// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { TutorialFocusHighlightsSchema } from "../core/schema";
import { findTutorialAnchor, observeTutorialAnchor, resolveRingElement, topmostApplicationDialog, waitForTutorialAnchor } from "./anchor";
import { DEFAULT_TUTORIAL_DOM_POLICY, LEGACY_TUTORIAL_DOM_POLICY, NEUTRAL_TUTORIAL_DOM_POLICY, type TutorialDomPolicy } from "./dom-policy";
import { drawFocusHighlights, resolveFocusHighlights } from "./focus-highlights";

afterEach(() => { document.body.replaceChildren(); });

function sized(element: HTMLElement, x = 40): HTMLElement {
  element.getBoundingClientRect = () => new DOMRect(x, 40, 100, 40);
  element.getClientRects = () => [element.getBoundingClientRect()] as unknown as DOMRectList;
  return element;
}

function fixture() {
  document.body.innerHTML = `
    <button id="background" data-tutorial-id="project.edit">Background</button>
    <div class="pb-modal-layer"><div class="pb-window" id="legacy-window">
      <button id="legacy" data-tutorial-id="project.edit">Legacy</button>
    </div></div>
    <div data-project-window="active" id="project-window">
      <button id="project" data-tutorial-id="project.edit">Project</button>
    </div>`;
  for (const [index, element] of Array.from(document.querySelectorAll<HTMLElement>("div, button")).entries()) sized(element, index * 120);
  const projectWindow = document.getElementById("project-window")!;
  const project = document.getElementById("project")!;
  const domPolicy: TutorialDomPolicy = {
    ...NEUTRAL_TUTORIAL_DOM_POLICY,
    floatingWindowSelector: '[data-project-window="active"]',
  };
  return { projectWindow, project, domPolicy };
}

describe("per-consumer DOM policies", () => {
  it("retains the legacy default while neutral hosts ignore private window classes", () => {
    fixture();
    expect(DEFAULT_TUTORIAL_DOM_POLICY).toBe(LEGACY_TUTORIAL_DOM_POLICY);
    expect(topmostApplicationDialog(document)?.id).toBe("legacy-window");
    expect(findTutorialAnchor(document, "project.edit")?.id).toBe("legacy");
    expect(topmostApplicationDialog(document, { domPolicy: NEUTRAL_TUTORIAL_DOM_POLICY })).toBeNull();
    expect(findTutorialAnchor(document, "project.edit", NEUTRAL_TUTORIAL_DOM_POLICY)).toBeNull();
  });

  it("shares the supplied foreground policy across anchors, targets and focus annotations", async () => {
    const { projectWindow, project, domPolicy } = fixture();
    expect(topmostApplicationDialog(document, { domPolicy })).toBe(projectWindow);
    expect(topmostApplicationDialog(document, { domPolicy, includeFloatingWindows: false })).toBeNull();
    expect(findTutorialAnchor(document, "project.edit", domPolicy)).toBe(project);
    expect(await waitForTutorialAnchor(document, "project.edit", { domPolicy })).toBe(project);
    expect(resolveRingElement(document.body, "project.edit", domPolicy)).toBe(project);
    const highlights = TutorialFocusHighlightsSchema.parse([{ id: "edit", target: { kind: "element", anchor: "project.edit" }, style: "box" }]);
    expect(resolveFocusHighlights(document, highlights, domPolicy)[0].rect.x).toBe(project.getBoundingClientRect().x);
    expect(resolveFocusHighlights(document, highlights, NEUTRAL_TUTORIAL_DOM_POLICY)).toHaveLength(0);
    const root = document.createElement("div");
    document.body.append(root);
    expect(drawFocusHighlights(document, root, highlights, domPolicy)).toBe(1);
    expect(root.querySelectorAll("[data-tutorial-focus]")).toHaveLength(1);
  });

  it("continues to use the host policy when an observed anchor is replaced", async () => {
    const { project, domPolicy } = fixture();
    const changed = vi.fn();
    const disconnect = observeTutorialAnchor(document, "project.edit", changed, domPolicy);
    try {
      const replacement = sized(document.createElement("button"));
      replacement.dataset.tutorialId = "project.edit";
      project.replaceWith(replacement);
      await vi.waitFor(() => expect(changed).toHaveBeenCalledWith(replacement));
      expect(findTutorialAnchor(document, "project.edit", domPolicy)).toBe(replacement);
    } finally { disconnect(); }
  });

  it("waits for a uniquely scoped anchor instead of accepting an unrelated duplicate", async () => {
    const { projectWindow, project, domPolicy } = fixture();
    project.remove();
    const controller = new AbortController();
    const pending = waitForTutorialAnchor(document, "project.edit", { domPolicy, signal: controller.signal, timeoutMs: 1500 });
    try {
      const replacement = sized(document.createElement("button"));
      replacement.dataset.tutorialId = "project.edit";
      projectWindow.append(replacement);
      expect(await pending).toBe(replacement);
    } finally { controller.abort(); }
  });
});
