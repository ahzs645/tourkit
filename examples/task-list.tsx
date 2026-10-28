"use client";

import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { parseTutorialManifest, type TutorialSemanticAction } from "../core";
import { TutorialPlayer } from "../player";
import { Button, Checkbox } from "../ui";

// A different application's state and actions: no route, catalog, fixture,
// registry, application store or Next.js provider from another host is involved.
const lesson = parseTutorialManifest({
  schemaVersion: 1,
  id: "task-list-introduction",
  title: "Create and finish a task",
  launch: { fixture: "empty-task-list", path: "/" },
  spotlightStyle: "glow",
  chapters: [{ id: "tasks", title: "Your task list", steps: [{
    id: "create-task",
    anchor: { id: "tasks.add" },
    action: { id: "tasks.create" },
    check: { all: [{ path: "tasks", count: { min: 1 } }] },
    overlay: { title: "Add your first task", body: "Press Add task. The tutorial checks your task list to see when you have done it." },
  }, {
    id: "finish-task",
    anchor: { id: "tasks.finish" },
    action: { id: "tasks.finish" },
    check: { all: [{ path: "tasks", where: { done: true }, count: { min: 1 } }] },
    overlay: { title: "Finish your task", body: "Check the task to finish it. The same lesson can also demonstrate these actions in Watch mode." },
  }] }],
});

function TaskListExample() {
  const [tasks, setTasks] = useState<{ id: string; title: string; done: boolean }[]>([]);
  const [mode, setMode] = useState<"practice" | "autoplay" | null>(null);
  const [run, setRun] = useState(0);
  const [completed, setCompleted] = useState(false);
  const state = useMemo(() => ({ tasks }), [tasks]);
  const execute = (action: TutorialSemanticAction) => {
    if (action.id === "tasks.create") setTasks([{ id: "first-task", title: "Try the reusable tutorial interface", done: false }]);
    if (action.id === "tasks.finish") setTasks((current) => current.map((task) => ({ ...task, done: true })));
  };
  const start = (nextMode: "practice" | "autoplay") => {
    setTasks([]);
    setCompleted(false);
    setRun((current) => current + 1);
    setMode(nextMode);
  };
  return <main className="mx-auto max-w-3xl px-8 py-16 text-slate-900">
    <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-brand-700">Tourkit example</p>
    <h1 className="text-3xl font-bold">A small task list, with a guided lesson</h1>
    <p className="mt-4 max-w-2xl text-slate-600">Try Practice to perform the steps yourself, or Watch to let the tutorial demonstrate them.</p>
    <div className="my-8 flex gap-3">
      <Button onClick={() => start("practice")}>Practice</Button>
      <Button variant="secondary" onClick={() => start("autoplay")}>Watch</Button>
    </div>
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs" aria-label="Task list">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-lg font-semibold">My tasks</h2>
        <Button data-tutorial-id="tasks.add" onClick={() => execute({ id: "tasks.create", match: "subset" })}>Add task</Button>
      </div>
      {tasks.length === 0 ? <p className="py-6 text-slate-500">Your task list is empty.</p> : tasks.map((task) => <label key={task.id} className="flex items-center gap-3 rounded-lg bg-slate-50 p-4">
        <Checkbox data-tutorial-id="tasks.finish" checked={task.done} onChange={() => execute({ id: "tasks.finish", match: "subset" })} />
        <span className={task.done ? "text-slate-500 line-through" : ""}>{task.title}</span>
      </label>)}
    </section>
    {completed && <p role="status" className="mt-6 font-medium text-success-700">Tutorial complete. Your task is finished.</p>}
    {mode && <TutorialPlayer key={run} manifest={lesson} mode={mode} state={state} onExecuteAction={execute} persistProgress={false}
      onComplete={() => { setCompleted(true); setMode(null); }} onStop={() => setMode(null)} />}
  </main>;
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<TaskListExample />);
