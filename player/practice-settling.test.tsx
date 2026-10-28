// @vitest-environment happy-dom
import { act, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createTutorialActionBus } from "../core/actions";
import { parseTutorialManifest } from "../core/schema";
import { TutorialPlayer } from "./tutorial-player";

// This suite controls the task/animation-frame order of the grading state
// machine. The actual overlay is covered separately by modal-integration.
vi.mock("./tutorial-overlay", () => ({ TutorialOverlay: ({ step, status }: { step: { overlay: { title: string } }; status: string }) =>
  <div data-testid="step" data-status={status}>{step.overlay.title}</div> }));

let root: Root | undefined;
let container: HTMLElement;
let frames: Map<number, FrameRequestCallback>;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  frames = new Map(); let sequence = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { const id = ++sequence; frames.set(id, callback); return id; });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => { frames.delete(id); });
});
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; container.remove(); vi.restoreAllMocks(); });

const tasks = async () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
const frame = async () => act(async () => {
  const callbacks = [...frames.values()]; frames.clear();
  callbacks.forEach((callback) => callback(performance.now()));
});

const manifest = parseTutorialManifest({ schemaVersion: 1, id: "settling-race", title: "Project", defaultMode: "practice", launch: { fixture: "blank" },
  chapters: [{ id: "project", title: "Project", steps: [
    { id: "name", action: { id: "projects.set-name", args: { name: "Launch plan" } }, check: { all: [{ path: "name", equals: "Launch plan" }] }, overlay: { title: "Name the project", body: "Enter a name." } },
    { id: "priority", completion: "continue", overlay: { title: "Choose priority", body: "Continue the workflow." } },
  ] }],
});

async function mount() {
  const bus = createTutorialActionBus();
  const subscribeToActions = bus.subscribe.bind(bus);
  let report!: (name: string) => void;
  function Host() {
    const [state, setState] = useState({ name: "" });
    report = (name) => flushSync(() => setState({ name }));
    return <>
      <button onClick={() => {
        // Real applications may synchronously commit the UI operation before
        // publishing it to recording/Practice (as the Studio example does).
        report("Launch plan");
        bus.observe("projects.set-name", { name: "Launch plan" });
      }}>Enter name</button>
      <TutorialPlayer manifest={manifest} state={state} subscribeToActions={subscribeToActions} persistProgress={false} />
    </>;
  }
  await act(async () => root!.render(<Host />));
  await tasks();
  expect(container.querySelector('[data-testid="step"]')?.getAttribute("data-status")).toBe("waiting");
  await act(async () => (container.querySelector("button") as HTMLButtonElement).click());
  return { report };
}

it("advances an earned Practice outcome when its timer runs before the matching action settles", async () => {
  await mount();
  // Run the zero-delay advance task before either settling animation frame.
  await tasks();
  await frame(); await frame(); await frame(); await tasks();
  expect(container.querySelector('[data-testid="step"]')?.textContent).toBe("Choose priority");
});

it("keeps grading when the reported outcome changes before a matching action settles", async () => {
  const { report } = await mount();
  await tasks();
  await act(async () => report("Unfinished name"));
  await frame(); await frame(); await frame(); await tasks();
  expect(container.querySelector('[data-testid="step"]')?.textContent).toBe("Name the project");
  expect(container.querySelector('[data-testid="step"]')?.getAttribute("data-status")).toBe("waiting");
});
