import { describe, expect, it } from "vitest";
import {
  createTutorialActionBus,
  createTutorialActionRegistry,
  evaluateTutorialCheck,
  parseTutorialManifest,
  replayTutorialSeek,
  TutorialAliasStore,
  type TutorialSeekEntry,
} from "./index";

describe("Tourkit core without an application", () => {
  it("executes and grades another application's data while preserving created-object aliases", async () => {
    const aliases = new TutorialAliasStore();
    const bus = createTutorialActionBus();
    const registry = createTutorialActionRegistry(bus, aliases);
    const observed: string[] = [];
    bus.subscribe((event) => observed.push(event.action));
    let state = { tasks: [] as { id: string; kind: string; done: boolean }[] };
    const baseline = state;
    registry.register("tasks.create", () => {
      const task = { id: "task-1", kind: "todo", done: false };
      state = { tasks: [...state.tasks, task] };
      return task;
    });
    registry.register("tasks.finish", (args) => {
      state = { tasks: state.tasks.map((task) => task.id === args.id ? { ...task, done: true } : task) };
    });
    const lesson = parseTutorialManifest({
      schemaVersion: 1, id: "task-demo", title: "Create and finish a task",
      launch: { fixture: "empty-tasks" },
      chapters: [{ id: "tasks", title: "Tasks", steps: [{
        id: "create",
        action: { id: "tasks.create", resultAlias: "created" },
        check: { all: [{ path: "tasks", where: { kind: "todo" }, mode: "delta", count: { min: 1 }, captureAlias: "task" }] },
        overlay: { title: "Create a task", body: "Use your application's task control." },
      }, {
        id: "finish",
        action: { id: "tasks.finish", args: { id: { $ref: "created.id" } } },
        check: { all: [{ path: "tasks", where: { id: { $ref: "created.id" }, done: true } }] },
        overlay: { title: "Finish the task", body: "Mark the created task complete." },
      }] }],
    });
    const [create, finish] = lesson.chapters[0].steps;
    expect(evaluateTutorialCheck(create.check!, state, baseline, aliases).satisfied).toBe(false);
    await registry.execute(create.action!);
    expect(evaluateTutorialCheck(create.check!, state, baseline, aliases)).toMatchObject({
      satisfied: true, captures: { task: { id: "task-1" } },
    });
    await registry.execute(finish.action!);
    expect(evaluateTutorialCheck(finish.check!, state, undefined, aliases).satisfied).toBe(true);
    expect(observed).toEqual(["tasks.create", "tasks.finish"]);
  });

  it("replays a stage using only its supplied navigation resolver", async () => {
    let state = { workspace: { activeTab: "home" }, revision: 0 };
    const executed: string[] = [];
    const entries: TutorialSeekEntry[] = [{
      context: { label: "Inbox", all: [{ path: "workspace.activeTab", equals: "inbox" }] },
      action: { id: "mail.compose", match: "subset" },
    }];
    await replayTutorialSeek(entries, {
      readState: () => state,
      resolveContextActions: () => [{ id: "mail.openInbox", match: "subset" }],
      execute: (action) => {
        executed.push(action.id);
        state = { workspace: { activeTab: action.id === "mail.openInbox" ? "inbox" : state.workspace.activeTab }, revision: state.revision + 1 };
      },
    });
    expect(executed).toEqual(["mail.openInbox", "mail.compose"]);
  });
});

