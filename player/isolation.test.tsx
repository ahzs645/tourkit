// @vitest-environment happy-dom

import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseTutorialManifest, type TutorialCheckClause, type TutorialManifest, type TutorialSemanticAction } from "../core/schema";
import { TutorialPlayer } from "./tutorial-player";
import type { TutorialPlayerProps } from "./types";

// A direct kit consumer must never load a host application's registry, including transitively.
vi.mock("../../../lib/host-emulators/registry", () => {
  throw new Error("The isolated player imported an application registry.");
});

// The existing player/geometry suites exercise the real overlay. These cases
// exercise the new host boundary without a particular presentation dependency.
vi.mock("./tutorial-overlay", () => ({
  TutorialOverlay: ({ step, status }: { step: { id: string }; status: string }) =>
    <div data-testid="kit-step" data-step={step.id} data-status={status}>{step.id}</div>,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

async function mount(element: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(element); });
}
async function flush(ms = 20) {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
}
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  root = undefined;
  container?.remove();
  container = undefined;
  sessionStorage.clear();
});

function contextLesson(): TutorialManifest {
  return parseTutorialManifest({
    schemaVersion: 1, id: "mail-demo", title: "Compose a message",
    defaultMode: "autoplay", launch: { fixture: "empty-inbox" },
    chapters: [{ id: "mail", title: "Mail", steps: [{
      id: "compose", action: { id: "mail.compose" }, advanceDelayMs: 60_000,
      context: { label: "Inbox", all: [{ path: "workspace.activeTab", equals: "inbox" }] },
      overlay: { title: "Compose", body: "Create a draft." },
    }] }],
  });
}

describe("isolated player host policies", () => {
  it("does not infer host navigation when no resolver was supplied", async () => {
    const execute = vi.fn();
    await mount(<TutorialPlayer manifest={contextLesson()} state={{ workspace: { activeTab: "home" } }}
      onExecuteAction={execute} persistProgress={false} />);
    await flush();
    expect(container?.querySelector('[data-testid="tutorial-error"]')?.textContent).toContain("Open Inbox before this step.");
    expect(execute).not.toHaveBeenCalled();
  });

  it("restores a view through the consuming application's actions", async () => {
    const executed: string[] = [];
    const lesson = contextLesson();
    const resolveContextActions = () => [{ id: "mail.openInbox", match: "subset" as const }];
    function MailApplication() {
      const [state, setState] = useState({ workspace: { activeTab: "home" } });
      const execute = (action: TutorialSemanticAction) => {
        executed.push(action.id);
        if (action.id === "mail.openInbox") setState({ workspace: { activeTab: "inbox" } });
      };
      return <TutorialPlayer manifest={lesson} state={state} onExecuteAction={execute}
        resolveContextActions={resolveContextActions} persistProgress={false} />;
    }
    await mount(<MailApplication />);
    await flush(80);
    expect(executed).toEqual(["mail.openInbox", "mail.compose"]);
    expect(container?.querySelector('[data-testid="kit-step"]')?.getAttribute("data-step")).toBe("compose");
  });

  const cases: { name: string; path: string; watch?: boolean; policy?: (clause: TutorialCheckClause) => boolean; regresses: boolean }[] = [
    { name: "does not assume builder fields are durable", path: "builder.fields", regresses: false },
    { name: "watches an explicit outcome in another application", path: "tasks", watch: true, regresses: true },
    { name: "accepts the consuming application's durability policy", path: "tasks", policy: (clause) => clause.path === "tasks", regresses: true },
  ];
  it.each(cases)("$name", async ({ path, watch, policy, regresses }) => {
    const lesson = parseTutorialManifest({
      schemaVersion: 1, id: "durability-demo", title: "Keep a task",
      launch: { fixture: "empty-tasks" },
      chapters: [{ id: "tasks", title: "Tasks", steps: [{
        id: "create", check: { all: [{ path, count: { min: 1 }, ...(watch === undefined ? {} : { watch }) }] },
        overlay: { title: "Create", body: "Create one task." },
      }, {
        id: "confirm", check: { all: [{ path: "confirmed", equals: true }] },
        overlay: { title: "Confirm", body: "Confirm when ready." },
      }] }],
    });
    const snapshot = (items: { id: string }[]) => path === "builder.fields"
      ? { builder: { fields: items }, confirmed: false }
      : { tasks: items, confirmed: false };
    const props: TutorialPlayerProps = { manifest: lesson, state: snapshot([]), persistProgress: false,
      regressionGraceMs: 1, isDurableCheckClause: policy };
    await mount(<TutorialPlayer {...props} />);
    await flush();
    await act(async () => { root!.render(<TutorialPlayer {...props} state={snapshot([{ id: "task-1" }])} />); });
    await flush();
    expect(container?.querySelector('[data-testid="kit-step"]')?.getAttribute("data-step")).toBe("confirm");
    await act(async () => { root!.render(<TutorialPlayer {...props} state={snapshot([])} />); });
    await flush();
    expect(Boolean(container?.querySelector('[data-testid="tutorial-regression"]'))).toBe(regresses);
  });
});

