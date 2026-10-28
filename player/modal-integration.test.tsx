// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseTutorialManifest, type TutorialManifest } from "../core/schema";
import { TutorialPlayer } from "./tutorial-player";
import { NEUTRAL_TUTORIAL_DOM_POLICY, type TutorialDomPolicy } from "./dom-policy";

// Keep the real player, overlay and positioning code. happy-dom has no layout;
// supply the viewport clipping rectangle the positioning library would read.
vi.mock("@floating-ui/dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@floating-ui/dom")>();
  return {
    ...actual,
    computePosition: (...[reference, floating, options]: Parameters<typeof actual.computePosition>) => actual.computePosition(reference, floating, {
      ...options,
      platform: { ...actual.platform, getClippingRect: async () => ({ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }) },
    }),
  };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  root = undefined;
  document.body.replaceChildren();
  sessionStorage.clear();
});

function lesson(stepCount = 1): TutorialManifest {
  return parseTutorialManifest({
    schemaVersion: 1, id: "tasks-modal-integration", title: "Tasks", defaultMode: "practice",
    launch: { fixture: "empty-tasks" },
    chapters: [{ id: "tasks", title: "Tasks", steps: Array.from({ length: stepCount }, (_, index) => ({
      id: `task-${index + 1}`, anchor: { id: `tasks.${index + 1}` }, action: { id: `tasks.action${index + 1}` },
      overlay: { title: `Task ${index + 1}`, body: "Follow this instruction." },
    })) }],
  });
}

function anchor(id = "tasks.1") {
  const button = document.createElement("button");
  button.dataset.tutorialId = id;
  button.getBoundingClientRect = () => new DOMRect(100, 120, 80, 40);
  button.getClientRects = () => [button.getBoundingClientRect()] as unknown as DOMRectList;
  return button;
}

function modal() {
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.getClientRects = () => [new DOMRect(40, 40, 500, 400)] as unknown as DOMRectList;
  return dialog;
}

async function flush(ms = 30) {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
}

async function mount(manifest = lesson(), state?: unknown, domPolicy?: TutorialDomPolicy) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const onStop = vi.fn();
  await act(async () => { root!.render(<TutorialPlayer manifest={manifest} state={state} domPolicy={domPolicy} persistProgress={false} onStop={onStop} />); });
  await flush();
  return onStop;
}

const suspended = () => document.querySelector('[data-testid="tutorial-overlay"]')?.getAttribute("data-suspended");
const escape = async () => act(async () => {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
});

describe("application modal integration", () => {
  const hiddenCases: { name: string; hide: (dialog: HTMLElement) => void }[] = [
    { name: "hidden", hide: (dialog) => { dialog.hidden = true; } },
    { name: "aria-hidden", hide: (dialog) => { dialog.setAttribute("aria-hidden", "true"); } },
    { name: "inert", hide: (dialog) => { dialog.setAttribute("inert", ""); } },
    { name: "visibility hidden", hide: (dialog) => { dialog.style.visibility = "hidden"; } },
    { name: "display none", hide: (dialog) => {
      dialog.style.display = "none";
      dialog.getClientRects = () => [] as unknown as DOMRectList;
    } },
  ];

  it.each(hiddenCases)("ignores a mounted $name modal for playback and Escape", async ({ hide }) => {
    const dialog = modal();
    hide(dialog);
    document.body.append(anchor(), dialog);
    const onStop = await mount();
    expect(suspended()).toBe("false");
    await escape();
    expect(onStop).toHaveBeenCalledOnce();
  });

  it("pauses for a visible unrelated modal and resumes when it is hidden without unmounting", async () => {
    document.body.append(anchor());
    const onStop = await mount();
    expect(suspended()).toBe("false");
    const dialog = modal();
    await act(async () => { document.body.append(dialog); });
    await flush();
    expect(suspended()).toBe("true");
    await escape();
    expect(onStop).not.toHaveBeenCalled();

    await act(async () => { dialog.hidden = true; });
    // The connectivity/visibility sweep also handles CSS-only modal closure.
    await flush(300);
    expect(dialog.isConnected).toBe(true);
    expect(suspended()).toBe("false");
    await escape();
    expect(onStop).toHaveBeenCalledOnce();
  });

  it("keeps an anchor inside a visible modal usable", async () => {
    const dialog = modal();
    dialog.append(anchor());
    document.body.append(dialog);
    await mount();
    expect(suspended()).toBe("false");
  });

  it("keeps the opening step active when the visible modal contains its next anchor", async () => {
    const dialog = modal();
    dialog.append(anchor("tasks.2"));
    document.body.append(anchor(), dialog);
    await mount(lesson(2));
    expect(suspended()).toBe("false");
  });

  it("keeps an explicit surface-opening outcome active while its dialog is visible", async () => {
    document.body.append(anchor(), modal());
    const manifest = lesson();
    manifest.chapters[0].steps[0].check = { all: [{ path: "surfaces.settings.open", equals: true, mode: "absolute" }] };
    await mount(manifest, { surfaces: { settings: { open: false } } });
    expect(suspended()).toBe("false");
  });

  it("does not infer a host snapshot convention under the neutral policy", async () => {
    document.body.append(anchor(), modal());
    const manifest = lesson();
    manifest.chapters[0].steps[0].check = { all: [{ path: "surfaces.settings.open", equals: true, mode: "absolute" }] };
    await mount(manifest, { surfaces: { settings: { open: false } } }, NEUTRAL_TUTORIAL_DOM_POLICY);
    expect(suspended()).toBe("true");
  });

  it("accepts a host's own dialog-opening outcome without surfaces.* keys", async () => {
    document.body.append(anchor(), modal());
    const manifest = lesson();
    manifest.chapters[0].steps[0].check = { all: [{ path: "workspace.editorOpen", equals: true, mode: "absolute" }] };
    const domPolicy: TutorialDomPolicy = {
      ...NEUTRAL_TUTORIAL_DOM_POLICY,
      stepExpectsDialog: (step) => step.check?.all.some((clause) => clause.path === "workspace.editorOpen" && clause.equals === true) ?? false,
    };
    await mount(manifest, { workspace: { editorOpen: false } }, domPolicy);
    expect(suspended()).toBe("false");
  });

  it("uses a supplied dialog selector for both player blocking and Escape ownership", async () => {
    const dialog = modal();
    dialog.removeAttribute("role");
    dialog.removeAttribute("aria-modal");
    dialog.setAttribute("data-project-dialog", "open");
    document.body.append(anchor(), dialog);
    const domPolicy: TutorialDomPolicy = {
      ...NEUTRAL_TUTORIAL_DOM_POLICY,
      applicationDialogSelector: '[data-project-dialog="open"]',
    };
    const onStop = await mount(lesson(), undefined, domPolicy);
    expect(suspended()).toBe("true");
    await escape();
    expect(onStop).not.toHaveBeenCalled();
    await act(async () => { dialog.hidden = true; });
    await flush(300);
    expect(suspended()).toBe("false");
    await escape();
    expect(onStop).toHaveBeenCalledOnce();
  });
});

describe("player focus lifecycle", () => {
  it("keeps typing focus on a snapshot/callback update and uses the latest Stop callback", async () => {
    const input = document.createElement("input");
    input.dataset.tutorialId = "tasks.1";
    input.getBoundingClientRect = () => new DOMRect(100, 120, 180, 40);
    input.getClientRects = () => [input.getBoundingClientRect()] as unknown as DOMRectList;
    const container = document.createElement("div");
    document.body.append(input, container);
    root = createRoot(container);
    const manifest = lesson();
    const stopped = vi.fn();
    const render = (title: string) => root!.render(
      <TutorialPlayer manifest={manifest} state={{ title }} persistProgress={false}
        onStop={() => stopped(title)} />,
    );

    await act(async () => { render(""); });
    await flush();
    expect(document.querySelector('[data-tutorial-surface]')).toBe(document.activeElement);
    input.focus();
    input.value = "Draft";
    input.setSelectionRange(5, 5);
    await act(async () => { render("Draft"); });
    await flush();

    const focusedAfterUpdate = document.activeElement;
    await escape();
    expect(focusedAfterUpdate).toBe(input);
    expect(input.selectionStart).toBe(5);
    expect(stopped.mock.calls).toEqual([["Draft"]]);
  });
});

describe("player anchor lifecycle", () => {
  it("moves the real Driver highlight to a replacement and removes it from the detached anchor", async () => {
    const original = anchor();
    document.body.append(original);
    await mount();
    expect(original.classList.contains("driver-active-element")).toBe(true);

    // A lazy tooltip, virtualized row or host rerender can replace the actual
    // control while preserving its semantic anchor. Driver's document query
    // cannot remove classes from the old node after it has left the document.
    const replacement = anchor();
    await act(async () => {
      original.replaceWith(replacement);
      // Also cover happy-dom losing a mutation and the 500ms connectivity
      // sweep finding the new node; keep the actual player/overlay/Driver.
      await new Promise((resolve) => setTimeout(resolve, 700));
    });

    expect(original.isConnected).toBe(false);
    expect(replacement.classList.contains("driver-active-element")).toBe(true);
    expect(original.classList.contains("driver-active-element")).toBe(false);
    expect(document.querySelectorAll(".driver-active-element")).toHaveLength(1);
  });
});

