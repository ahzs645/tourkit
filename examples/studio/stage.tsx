"use client";

import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { createTutorialActionRegistry, tutorialActionBus } from "../../core/actions";
import type { TutorialSemanticAction, TutorialValue } from "../../core/schema";
import { TutorialCaptureRun } from "../../components/tutorial-capture-run";
import { forgetTutorialRun, useTutorialAuthoringBridge, useTutorialDraftManifest, useTutorialLocation, type TutorialLocationState } from "../../components/tutorial-session";
import { flattenTutorialSteps, TutorialPlayer, type TutorialExecutionContext } from "../../player";
import { BuilderSelect, Button, Input, Modal } from "../../ui";
import { createProjectIntegration } from "./integration";
import { PROJECT_DOM_POLICY } from "./project-dom-policy";
import { PROJECT_ACTIONS, PROJECT_FIXTURES, PROJECT_PRIORITIES, ProjectStore, projectContextActions } from "./project-model";

const integration = createProjectIntegration(window.location.href);
const settledFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

function ProjectRun({ location, runKey }: { location: TutorialLocationState; runKey: number }) {
  const [store] = useState(() => new ProjectStore(location.fixture ?? "empty-project-list"));
  const state = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  const [registry] = useState(() => {
    const value = createTutorialActionRegistry(tutorialActionBus);
    for (const id of PROJECT_ACTIONS) value.register(id, (args) => store.execute(id, args));
    return value;
  });
  const [finished, setFinished] = useState(false);
  const [message, setMessage] = useState("");
  const nameInput = useRef<HTMLInputElement>(null);
  const editedName = useRef(false);
  const draftManifest = useTutorialDraftManifest(location.tutorialId, runKey, integration.session);
  const manifest = location.tutorialId === integration.lesson.id ? integration.lesson : draftManifest;
  const execute = useCallback(async (action: TutorialSemanticAction, context?: TutorialExecutionContext) => {
    context?.signal.throwIfAborted();
    const event = await registry.execute(action, context?.signal);
    await settledFrame();
    context?.signal.throwIfAborted();
    return event.result;
  }, [registry]);
  const reset = useCallback(async () => {
    editedName.current = false;
    registry.aliases.clear();
    store.reset();
    setFinished(false);
    setMessage("");
    // The bridge awaits DOM/snapshot readiness, not only a scheduled React update.
    await settledFrame();
  }, [registry, store]);
  useTutorialAuthoringBridge(location.authoring, state, execute, true, reset, integration.session);

  const perform = (id: string, args?: Record<string, TutorialValue>) => {
    try {
      const result = store.execute(id, args);
      tutorialActionBus.observe(id, args, result);
      setMessage("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "The operation failed."); }
  };
  const commitName = () => {
    if (!editedName.current) return;
    editedName.current = false;
    // One committed field edit is recorded, rather than one tutorial step per keystroke.
    tutorialActionBus.observe("projects.set-name", { name: store.snapshot().draft.name });
  };
  const complete = useCallback(() => { setFinished(true); setMessage("Tutorial complete. Your project is saved."); forgetTutorialRun(); }, []);
  const stop = useCallback(() => { setFinished(true); setMessage("Tutorial stopped. The sample work remains visible."); forgetTutorialRun(); }, []);
  const startIndex = manifest ? Math.max(0, flattenTutorialSteps(manifest).findIndex(({ step }) => step.id === location.startStep)) : 0;

  return <>
    <main className="mx-auto min-h-dvh max-w-3xl px-5 py-8 text-slate-900 dark:text-slate-100" data-testid="project-stage">
      <p className="text-sm font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">Project workspace</p>
      <h1 className="mt-2 text-2xl font-bold">Plan a small project</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-400">Create a project, give it a priority and save it. This workspace uses synthetic, temporary data. Restarting a run restores the selected fixture.</p>
      <p className="mt-2 text-xs text-slate-500" data-testid="project-fixture">Fixture: {PROJECT_FIXTURES.find((entry) => entry.id === store.fixture)?.label}</p>
      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-700 dark:bg-slate-900" aria-label="Project list">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">My projects</h2>
          <Button data-tutorial-id="projects.add" onClick={() => perform("projects.open-create")}>New project</Button>
        </div>
        {state.projects.length ? <ul className="space-y-3">{state.projects.map((project) => <li key={project.id} data-project={project.id} className="flex items-center justify-between gap-4 rounded-lg bg-slate-50 p-4 dark:bg-slate-800">
          <span className="min-w-0 break-words font-medium">{project.name}</span>
          <span className="shrink-0 rounded-full bg-brand-50 px-3 py-1 text-xs text-brand-700 dark:bg-brand-500/10 dark:text-brand-200">{PROJECT_PRIORITIES.find((entry) => entry.value === project.priority)?.label} priority</span>
        </li>)}</ul> : <p className="py-5 text-sm text-slate-500">No projects yet. Create your first project.</p>}
      </section>
      {message && <p className="mt-4 text-sm" role="status">{message}</p>}
      {!location.authoring && !location.tutorialId && <div className="mt-5 flex gap-3">
        <Button onClick={() => void reset()}>Reset fixture</Button>
        <a className="rounded-lg px-3 py-2 text-sm underline" href={integration.paths.studio}>Open Tutorial Studio</a>
      </div>}
    </main>
    <Modal open={state.surfaces.create.open} onClose={() => { commitName(); perform("projects.close-create"); }} initialFocusRef={nameInput} respectPickerEscape size="sm">
      <Modal.Header title="New project" description="Closing the dialog preserves your draft. Saving adds the project to the sample list." />
      <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => { event.preventDefault(); commitName(); perform("projects.save"); }}>
        <Modal.Body className="space-y-5">
          <div className="space-y-2">
            <label htmlFor="project-name" className="block text-sm font-medium">Project name</label>
            <Input ref={nameInput} id="project-name" data-tutorial-id="projects.name" value={state.draft.name}
              onChange={(event) => { store.execute("projects.set-name", { name: event.target.value }); editedName.current = true; }}
              onBlur={commitName} required maxLength={80} autoComplete="off" placeholder="e.g. Launch plan" />
          </div>
          <div className="space-y-2">
            <label htmlFor="project-priority" className="block text-sm font-medium">Project priority</label>
            <BuilderSelect id="project-priority" aria-label="Project priority" data-tutorial-id="projects.priority" value={state.draft.priority} options={PROJECT_PRIORITIES}
              onChange={(priority) => perform("projects.set-priority", { priority })} />
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button data-tutorial-id="projects.close" onClick={() => { commitName(); perform("projects.close-create"); }}>Close</Button>
          <Button type="submit" variant="primary" data-tutorial-id="projects.save" disabled={!state.draft.name.trim()}>Save project</Button>
        </Modal.Footer>
      </form>
    </Modal>
    {manifest && !location.authoring && !finished && (location.capture
      ? <TutorialCaptureRun manifest={manifest} token={location.capture} before={location.captureBefore} execute={execute} state={state} resolveContextActions={projectContextActions} domPolicy={PROJECT_DOM_POLICY} />
      : <TutorialPlayer manifest={manifest} state={state} mode={location.mode} spotlightStyle={location.spotlightStyle} domPolicy={PROJECT_DOM_POLICY}
        startAt={startIndex} catchUp={startIndex > 0} persistProgress={false} onExecuteAction={execute}
        resolveContextActions={projectContextActions} resolveReturnAction={(step) => ["projects.name", "projects.priority", "projects.save"].includes(step.anchor?.id ?? "") ? { id: "projects.open-create", match: "subset" } : null}
        onComplete={complete} onStop={stop} />)}
  </>;
}

export function ProjectStage() {
  const { locationState, runKey } = useTutorialLocation();
  if (locationState.fixture && !PROJECT_FIXTURES.some((entry) => entry.id === locationState.fixture)) return <p role="alert">Unknown project fixture: {locationState.fixture}</p>;
  return <ProjectRun key={runKey} location={locationState} runKey={runKey} />;
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<ProjectStage />);
