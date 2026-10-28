import { describe, expect, it } from "vitest";
import { evaluateTutorialCheck } from "../../core/checks";
import { TutorialSemanticActionSchema } from "../../core/schema";
import { applyCaptureToDraft, createTutorialRecordingDraft, tutorialRecordingDraftToManifest } from "../../recording/draft";
import { applyProjectAction, createProjectFixture, ProjectStore, projectAnchor, projectCheckSuggestions, projectContextActions, projectViewContext } from "./project-model";

const operations = [
  { id: "projects.open-create" },
  { id: "projects.set-name", args: { name: "Launch plan" } },
  { id: "projects.set-priority", args: { priority: "high" } },
  { id: "projects.save" },
].map((value) => TutorialSemanticActionSchema.parse(value));

describe("neutral Studio project host", () => {
  it.each(["empty-project-list", "sample-project-list"])("generates meaningful outcomes and replays them from %s", (fixture) => {
    const draft = createTutorialRecordingDraft({ fixture, path: "/nested/studio/stage.html", hash: { tutorialAuthor: 1 } });
    const recorded = applyCaptureToDraft(draft, {
      startedAt: new Date(0).toISOString(), durationMs: 4000, warnings: [],
      actions: operations.map((action, index) => ({ ...action, atMs: index * 1000, anchor: projectAnchor(action.id) })),
    }, "practice", new Date(4000), projectCheckSuggestions);
    const manifest = tutorialRecordingDraftToManifest(recorded);
    expect(manifest.launch.path).toBe("/nested/studio/stage.html");
    expect(manifest.launch.hash).not.toHaveProperty("tutorialAuthor");
    let state = createProjectFixture(fixture);
    for (const step of manifest.chapters.flatMap((chapter) => chapter.steps)) {
      const before = state;
      expect(evaluateTutorialCheck(step.check!, before, before).satisfied).toBe(false);
      state = applyProjectAction(state, step.action!.id, step.action!.args).state;
      expect(evaluateTutorialCheck(step.check!, state, before).satisfied).toBe(true);
    }
    expect(state.projects.at(-1)).toMatchObject({ name: "Launch plan", priority: "high" });
    expect(state.projects).toHaveLength(fixture === "empty-project-list" ? 1 : 2);
  });

  it("restores a dialog without repeating the save or erasing its draft", () => {
    const store = new ProjectStore("empty-project-list");
    store.execute("projects.open-create"); store.execute("projects.set-name", { name: "Retain this" });
    store.execute("projects.close-create");
    const actions = projectContextActions(projectViewContext({ "host.page": "projects", "host.dialog": "create" }));
    for (const action of actions) store.execute(action.id, action.args);
    expect(store.snapshot().draft.name).toBe("Retain this");
    expect(store.snapshot().projects).toEqual([]);
    expect(store.snapshot().host.dialog).toBe("create");
  });

  it("reset restores the selected fixture and publishes a new snapshot", () => {
    const store = new ProjectStore("sample-project-list");
    const initial = store.snapshot();
    let updates = 0; const unsubscribe = store.subscribe(() => { updates++; });
    for (const action of operations) store.execute(action.id, action.args);
    expect(store.snapshot().projects).toHaveLength(2);
    store.reset();
    expect(store.snapshot()).toEqual(initial);
    expect(store.snapshot()).not.toBe(initial);
    expect(updates).toBe(5);
    unsubscribe(); store.reset(); expect(updates).toBe(5);
  });

  it("keeps projections independent and rejects unknown fixtures/actions", () => {
    const launch = { fixture: "empty-project-list", path: "/stage.html", hash: {} };
    const a = projectCheckSuggestions.forLaunch(launch), b = projectCheckSuggestions.forLaunch(launch);
    a.apply(operations[0]); a.apply(operations[1]);
    expect(a.suggest(operations[1]).reason).toBe("already-satisfied");
    expect(b.suggest(operations[1]).check).toBeTruthy();
    expect(() => createProjectFixture("production-projects")).toThrow("Unknown project fixture");
    expect(() => applyProjectAction(createProjectFixture(launch.fixture), "projects.destroy-all")).toThrow("Unsupported project action");
    expect(() => applyProjectAction(createProjectFixture(launch.fixture), "projects.save")).toThrow("Open the New project dialog");
  });
});
