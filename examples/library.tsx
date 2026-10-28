"use client";

import { useCallback, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { parseTutorialManifest, type TutorialManifest, type TutorialMode, type TutorialSemanticAction } from "../core";
import { TutorialPlayer, createTutorialCompletionStore, createTutorialProgressStore } from "../player";
import { createTutorialLibraryStatusSource, TutorialLibrary, TutorialLibraryProgress, useTutorialLibraryStatuses, type TutorialLibrarySection } from "../library";
import { Button } from "../ui/button";

type CollectionId = "warehouse" | "observatory";
type TrainingState = { orderCreated: boolean; orderApproved: boolean; stockReceived: boolean; stockShelved: boolean; sessionPlanned: boolean; sessionReady: boolean; mountAligned: boolean; mountCalibrated: boolean };
const emptyTraining = (): TrainingState => ({ orderCreated: false, orderApproved: false, stockReceived: false, stockShelved: false, sessionPlanned: false, sessionReady: false, mountAligned: false, mountCalibrated: false });
const ACTION_FIELDS: Record<string, keyof TrainingState> = {
  "warehouse.order.create": "orderCreated", "warehouse.order.approve": "orderApproved", "warehouse.stock.receive": "stockReceived", "warehouse.stock.shelve": "stockShelved",
  "observatory.session.plan": "sessionPlanned", "observatory.session.prepare": "sessionReady", "observatory.mount.align": "mountAligned", "observatory.mount.calibrate": "mountCalibrated",
};

function applyAction(state: TrainingState, action: TutorialSemanticAction): TrainingState {
  const field = ACTION_FIELDS[action.id];
  if (!field) throw new Error(`Unknown training action: ${action.id}`);
  return { ...state, [field]: true };
}

function makeLesson(id: string, title: string, goal: string, actions: readonly [string, string], captions: readonly [string, string]): TutorialManifest {
  return parseTutorialManifest({
    schemaVersion: 1, id, title, description: goal, estimatedMinutes: 1, launch: { fixture: "empty-training", path: "/" },
    setup: { kind: "task", goal, audience: [actions[0].startsWith("warehouse") ? "Warehouse team" : "Observatory team"], access: ["This sample workspace"], startingScreen: "Training workspace", sources: [], limitations: ["Uses temporary demonstration data"] },
    chapters: [{ id: "exercise", title, steps: actions.map((action, index) => ({
      id: `step-${index + 1}`, anchor: { id: action }, action: { id: action }, check: { all: [{ path: ACTION_FIELDS[action], equals: true }] },
      overlay: { title: captions[index], body: `Press ${captions[index]}. Practice and Watch use the same application operation.` }, advanceDelayMs: 300,
    })) }],
  });
}

// Identical lesson IDs deliberately live in two different catalogs/persistence
// scopes. Their domain actions, sections and titles belong to each consumer.
const COLLECTIONS: Record<CollectionId, { label: string; sections: readonly TutorialLibrarySection[] }> = {
  warehouse: { label: "Warehouse", sections: [
    { id: "purchasing", title: "Purchasing", description: "Manage a new supply order.", tutorials: [makeLesson("starter", "Create and approve an order", "Create a supply order and approve it for purchase.", ["warehouse.order.create", "warehouse.order.approve"], ["Create order", "Approve order"])] },
    { id: "stock-control", title: "Stock control", tutorials: [makeLesson("next-task", "Receive and shelve supplies", "Receive a shipment and mark it as shelved.", ["warehouse.stock.receive", "warehouse.stock.shelve"], ["Receive supplies", "Shelve supplies"])] },
  ] },
  observatory: { label: "Observatory", sections: [
    { id: "observing", title: "Observing sessions", description: "Prepare for a night of observing.", tutorials: [makeLesson("starter", "Plan and prepare an observing session", "Plan a session and prepare the observing equipment.", ["observatory.session.plan", "observatory.session.prepare"], ["Plan session", "Prepare equipment"])] },
    { id: "calibration", title: "Equipment calibration", tutorials: [makeLesson("next-task", "Align and calibrate the mount", "Align the telescope mount and finish its calibration.", ["observatory.mount.align", "observatory.mount.calibrate"], ["Align mount", "Calibrate mount"])] },
  ] },
};

function createCollectionStores(namespace: string) {
  const completion = createTutorialCompletionStore({ namespace });
  const progress = createTutorialProgressStore({ namespace });
  const source = createTutorialLibraryStatusSource({ readCompletions: completion.read, readProgress: progress.peek, subscribe(listener) {
    const a = completion.subscribe(listener); const b = progress.subscribe(listener);
    return () => { a(); b(); };
  } });
  return { completion, progress, source };
}
const STORES = { warehouse: createCollectionStores("library-example:warehouse"), observatory: createCollectionStores("library-example:observatory") };

function LibraryExample() {
  const [collectionId, setCollectionId] = useState<CollectionId>("warehouse");
  const [layout, setLayout] = useState<"cards" | "rows">("rows");
  const [state, setState] = useState(emptyTraining);
  const [active, setActive] = useState<{ tutorial: TutorialManifest; mode: TutorialMode; key: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const collection = COLLECTIONS[collectionId];
  const stores = STORES[collectionId];
  const tutorials = useMemo(() => collection.sections.flatMap((section) => section.tutorials), [collection]);
  const statuses = useTutorialLibraryStatuses(tutorials.map((tutorial) => tutorial.id), stores.source);
  const execute = useCallback((action: TutorialSemanticAction) => setState((current) => applyAction(current, action)), []);
  const stop = useCallback(() => setActive(null), []);
  const complete = useCallback(() => {
    if (!active) return;
    stores.completion.mark(active.tutorial.id, active.mode);
    setMessage(`Completed: ${active.tutorial.title}`);
    setActive(null);
  }, [active, stores]);
  const start = (tutorial: TutorialManifest, mode: TutorialMode) => {
    const steps = tutorial.chapters.flatMap((chapter) => chapter.steps);
    const saved = stores.progress.read(tutorial.id, mode, steps.length);
    // Resume from a deterministic training fixture, restoring prior operations
    // before the player resumes its saved step. Never replay into real data.
    const fixture = steps.slice(0, saved?.stepIndex ?? 0).reduce((current, step) => step.action ? applyAction(current, step.action) : current, emptyTraining());
    setState(fixture); setMessage(null);
    setActive({ tutorial, mode, key: Date.now() });
  };
  const changeCollection = (id: CollectionId) => { setActive(null); setState(emptyTraining()); setMessage(null); setCollectionId(id); };
  const reset = () => {
    setActive(null); setState(emptyTraining()); setMessage(null);
    stores.completion.clear();
    for (const tutorial of tutorials) stores.progress.clear(tutorial.id);
  };
  const actionButton = (id: string, label: string, disabled = false) => <Button data-tutorial-id={id} disabled={disabled || state[ACTION_FIELDS[id]]} onClick={() => execute({ id, match: "subset" })}>{state[ACTION_FIELDS[id]] ? `${label} ✓` : label}</Button>;

  return <main className="mx-auto min-h-dvh max-w-6xl px-5 py-8 text-slate-900 dark:text-slate-100">
    <p className="text-sm font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">Tourkit example</p>
    <h1 className="mt-2 text-3xl font-bold">A reusable learning library</h1>
    <p className="mt-3 max-w-2xl text-sm text-slate-600 dark:text-slate-400">Two unrelated collections share the same interface. Each keeps its own progress. Practice and Watch operate the sample workspace below.</p>
    <div role="group" aria-label="Lesson collection" className="my-5 flex flex-wrap gap-2">{Object.entries(COLLECTIONS).map(([id, value]) => <Button key={id} aria-pressed={collectionId === id} onClick={() => changeCollection(id as CollectionId)}>{value.label}</Button>)}</div>
    <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_18rem]">
      <section aria-label="Training workspace" className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
        <h2 className="text-lg font-semibold">{collection.label} workspace</h2>
        <p className="mt-1 text-sm text-slate-500">Only temporary demonstration data changes.</p>
        <div className="mt-5 flex flex-wrap gap-2">
          {collectionId === "warehouse" ? <>
            {actionButton("warehouse.order.create", "Create order")}{actionButton("warehouse.order.approve", "Approve order", !state.orderCreated)}
            {actionButton("warehouse.stock.receive", "Receive supplies")}{actionButton("warehouse.stock.shelve", "Shelve supplies", !state.stockReceived)}
          </> : <>
            {actionButton("observatory.session.plan", "Plan session")}{actionButton("observatory.session.prepare", "Prepare equipment", !state.sessionPlanned)}
            {actionButton("observatory.mount.align", "Align mount")}{actionButton("observatory.mount.calibrate", "Calibrate mount", !state.mountAligned)}
          </>}
        </div>
      </section>
      <TutorialLibraryProgress tutorials={tutorials} statuses={statuses} onLaunch={start} label={`${collection.label} progress`} />
    </div>
    <div role="group" aria-label="Library display" className="mt-6 flex flex-wrap gap-2"><Button aria-pressed={layout === "rows"} onClick={() => setLayout("rows")}>Rows</Button><Button aria-pressed={layout === "cards"} onClick={() => setLayout("cards")}>Cards</Button><Button variant="ghost" onClick={reset}>Reset this collection</Button></div>
    {message ? <p role="status" className="mt-4 font-medium text-success-700 dark:text-success-300">{message}</p> : null}
    <TutorialLibrary key={collectionId} sections={collection.sections} statuses={statuses} onLaunch={start} layout={layout} showSectionNavigation sectionAnchorPrefix={collectionId} />
    {active ? <TutorialPlayer key={active.key} manifest={active.tutorial} mode={active.mode} state={state} onExecuteAction={execute} progressStore={stores.progress} onComplete={complete} onStop={stop} /> : null}
  </main>;
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<LibraryExample />);
