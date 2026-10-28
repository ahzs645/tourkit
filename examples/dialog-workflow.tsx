"use client";

import { useCallback, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  createTutorialActionBus,
  parseTutorialManifest,
  type TutorialValue,
} from "../core";
import {
  TutorialPlayer,
  type TutorialActionSubscription,
  type TutorialMode,
  type TutorialPlayerActionExecutor,
  type TutorialStep,
} from "../player";
import { BuilderSelect, Button, Input, Modal } from "../ui";

// Browser entrypoint, like task-list.tsx. Use the standalone example's
// Tailwind/theme build pipeline; this host needs no application provider or route.
const TRAINING_PROJECT_NAME = "Launch plan";
const PRIORITIES = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
] as const;
type Priority = (typeof PRIORITIES)[number]["value"];
type Project = { id: string; name: string; priority: Priority };
type ProjectState = {
  projects: Project[];
  draft: { name: string; priority: Priority };
  surfaces: { create: { open: boolean } };
};

function emptyProjectFixture(): ProjectState {
  return {
    projects: [],
    draft: { name: "", priority: "medium" },
    surfaces: { create: { open: false } },
  };
}

export const projectLesson = parseTutorialManifest({
  schemaVersion: 1,
  id: "project-dialog-introduction",
  title: "Create a project in a dialog",
  description: "Open a dialog, name a project, choose its priority, and save it.",
  estimatedMinutes: 1,
  launch: { fixture: "empty-project-list", path: "/" },
  spotlightStyle: "glow",
  interaction: "free",
  chapters: [{
    id: "create-project",
    title: "Your first project",
    steps: [{
      id: "open-project-dialog",
      anchor: { id: "projects.add" },
      action: { id: "projects.open-create" },
      check: {
        description: "the New project dialog is open",
        all: [{ path: "surfaces.create.open", equals: true }],
      },
      overlay: {
        title: "Open the creation dialog",
        body: "Press New project. You will enter the project details in the dialog.",
      },
      advanceDelayMs: 900,
    }, {
      id: "name-project",
      anchor: { id: "projects.name" },
      action: { id: "projects.set-name", args: { name: TRAINING_PROJECT_NAME } },
      check: {
        description: `the project name is ${TRAINING_PROJECT_NAME}`,
        all: [{ path: "draft.name", equals: TRAINING_PROJECT_NAME }],
      },
      overlay: {
        title: "Name your project",
        body: `Enter “${TRAINING_PROJECT_NAME}” in Project name. If you close the dialog, Take me back reopens the same draft.`,
      },
      advanceDelayMs: 900,
    }, {
      id: "choose-project-priority",
      anchor: { id: "projects.priority" },
      action: { id: "projects.set-priority", args: { priority: "high" } },
      check: {
        description: "the project priority is High",
        all: [{ path: "draft.priority", equals: "high" }],
      },
      overlay: {
        title: "Choose a priority",
        body: "Open Project priority and select High. You can also use the arrow keys and Enter to choose it.",
      },
      advanceDelayMs: 900,
    }, {
      id: "save-project",
      anchor: { id: "projects.save" },
      action: { id: "projects.save", resultAlias: "created-project" },
      check: {
        description: `${TRAINING_PROJECT_NAME} is saved with High priority and the dialog is closed`,
        all: [{
          path: "projects",
          where: { name: TRAINING_PROJECT_NAME, priority: "high" },
          count: { min: 1 },
          mode: "delta",
          captureAlias: "created-project",
          watch: true,
        }, { path: "surfaces.create.open", equals: false }],
      },
      overlay: {
        title: "Save your project",
        body: "Press Save project, or submit the form with Enter. The lesson checks for a newly saved project in your list.",
      },
      advanceDelayMs: 900,
    }],
  }],
});

// Navigation only: reopening a draft preserves the work already performed.
// No view-context adapter is necessary for this single-screen example.
function returnToProjectDialog(step: TutorialStep) {
  return ["projects.name", "projects.priority", "projects.save"].includes(step.anchor?.id ?? "")
    ? { id: "projects.open-create", match: "subset" as const }
    : null;
}

export function ProjectListExample() {
  const [state, setState] = useState(emptyProjectFixture);
  const stateRef = useRef(state);
  const [bus] = useState(createTutorialActionBus);
  const [mode, setMode] = useState<TutorialMode | null>(null);
  const [run, setRun] = useState(0);
  const [completed, setCompleted] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Both UI gestures and Watch call these same synchronous domain operations.
  // The ref makes consecutive operations see the latest snapshot, even before
  // React commits a render; each mutation still publishes a new state object.
  const executeProjectAction = useCallback((
    id: string,
    args: Readonly<Record<string, unknown>> = {},
  ): Project | undefined => {
    const current = stateRef.current;
    let next: ProjectState;
    let result: Project | undefined;
    switch (id) {
      case "projects.open-create":
        next = { ...current, surfaces: { create: { open: true } } };
        break;
      case "projects.close-create":
        next = { ...current, surfaces: { create: { open: false } } };
        break;
      case "projects.set-name":
        if (!current.surfaces.create.open) throw new Error("Open the project dialog before entering a name.");
        if (typeof args.name !== "string" || args.name.length > 80) throw new Error("Enter a project name of at most 80 characters.");
        next = { ...current, draft: { ...current.draft, name: args.name } };
        break;
      case "projects.set-priority":
        if (!current.surfaces.create.open) throw new Error("Open the project dialog before choosing a priority.");
        if (args.priority !== "low" && args.priority !== "medium" && args.priority !== "high") throw new Error("Choose a valid project priority.");
        next = { ...current, draft: { ...current.draft, priority: args.priority } };
        break;
      case "projects.save": {
        if (!current.surfaces.create.open) throw new Error("Open the project dialog before saving.");
        const name = current.draft.name.trim();
        if (!name) throw new Error("Enter a project name before saving.");
        result = { id: `project-${current.projects.length + 1}`, name, priority: current.draft.priority };
        next = {
          projects: [...current.projects, result],
          draft: { name: "", priority: "medium" },
          surfaces: { create: { open: false } },
        };
        break;
      }
      default:
        throw new Error(`Unsupported project action: ${id}`);
    }
    stateRef.current = next;
    setState(next);
    return result;
  }, []);

  const performUserAction = (id: string, args?: Record<string, TutorialValue>) => {
    const result = executeProjectAction(id, args);
    bus.observe(id, args, result);
  };
  const execute: TutorialPlayerActionExecutor = useCallback(async (action, context) => {
    context.signal.throwIfAborted();
    return executeProjectAction(action.id, action.args);
  }, [executeProjectAction]);
  const subscribe: TutorialActionSubscription = useCallback((listener) => bus.subscribe(listener), [bus]);
  // Stable callbacks prevent the overlay's focus effect from rerunning on
  // every name edit or priority change.
  const stop = useCallback(() => setMode(null), []);
  const complete = useCallback(() => {
    setCompleted(true);
    setMode(null);
  }, []);

  const reset = () => {
    setMode(null);
    setCompleted(false);
    const fresh = emptyProjectFixture();
    stateRef.current = fresh;
    setState(fresh);
    setRun((current) => current + 1);
  };
  const start = (nextMode: TutorialMode) => {
    reset();
    setMode(nextMode);
  };

  return <>
    <main className="mx-auto min-h-dvh max-w-3xl px-5 py-10 text-slate-900 sm:px-8 sm:py-16 dark:text-slate-100">
      <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">Tourkit example</p>
      <h1 className="text-3xl font-bold">A small project list</h1>
      <p className="mt-4 max-w-2xl text-slate-600 dark:text-slate-400">
        Create a project in a modal and choose its priority. Practice guides you through the form; Watch demonstrates the same steps.
      </p>
      <div className="mt-6 flex flex-wrap gap-3" aria-label="Tutorial controls">
        <Button variant="primary" onClick={() => start("practice")}>Practice</Button>
        <Button onClick={() => start("autoplay")}>Watch</Button>
        <Button variant="ghost" onClick={reset}>Reset demo</Button>
      </div>
      <p className="mb-8 mt-3 text-sm text-slate-500 dark:text-slate-400">
        This is a temporary demo. Practice, Watch, and Reset demo clear this sample list and any draft.
      </p>
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs sm:p-6 dark:border-slate-700 dark:bg-slate-900" aria-label="Project list">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">My projects</h2>
          <Button data-tutorial-id="projects.add" onClick={() => performUserAction("projects.open-create")}>New project</Button>
        </div>
        {state.projects.length === 0
          ? <p className="py-6 text-slate-500 dark:text-slate-400">Your project list is empty. Create a project to get started.</p>
          : <ul className="space-y-3">
            {state.projects.map((project) => <li key={project.id} className="flex items-center justify-between gap-4 rounded-lg bg-slate-50 p-4 dark:bg-slate-800">
              <span className="min-w-0 break-words font-medium">{project.name}</span>
              <span className="shrink-0 rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 dark:bg-brand-500/10 dark:text-brand-200">
                {PRIORITIES.find((priority) => priority.value === project.priority)?.label} priority
              </span>
            </li>)}
          </ul>}
      </section>
      {completed && <p role="status" className="mt-6 font-medium text-success-700 dark:text-success-300">
        Tutorial complete. {TRAINING_PROJECT_NAME} is saved with High priority.
      </p>}
    </main>

    <Modal open={state.surfaces.create.open} onClose={() => performUserAction("projects.close-create")}
      initialFocusRef={nameInputRef} respectPickerEscape size="sm">
      <Modal.Header title="New project" description="Add a name and priority. Closing the dialog keeps your draft until you save or reset the demo." />
      <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => {
        event.preventDefault();
        performUserAction("projects.save");
      }}>
        <Modal.Body className="space-y-5">
          <div className="space-y-2">
            <label htmlFor="project-name" className="block text-sm font-medium text-slate-700 dark:text-slate-200">Project name</label>
            <Input ref={nameInputRef} id="project-name" data-tutorial-id="projects.name" value={state.draft.name}
              onChange={(event) => performUserAction("projects.set-name", { name: event.target.value })}
              required maxLength={80} autoComplete="off" placeholder="e.g. Launch plan" />
          </div>
          <div className="space-y-2">
            <label htmlFor="project-priority" className="block text-sm font-medium text-slate-700 dark:text-slate-200">Project priority</label>
            <BuilderSelect id="project-priority" data-tutorial-id="projects.priority" aria-label="Project priority" value={state.draft.priority} options={PRIORITIES}
              onChange={(priority) => performUserAction("projects.set-priority", { priority })} />
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button onClick={() => performUserAction("projects.close-create")}>Close</Button>
          <Button type="submit" variant="primary" data-tutorial-id="projects.save" disabled={!state.draft.name.trim()}>Save project</Button>
        </Modal.Footer>
      </form>
    </Modal>

    {mode && <TutorialPlayer key={run} manifest={projectLesson} mode={mode} state={state}
      onExecuteAction={execute} subscribeToActions={subscribe} resolveReturnAction={returnToProjectDialog} persistProgress={false}
      onComplete={complete} onStop={stop} />}
  </>;
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<ProjectListExample />);
