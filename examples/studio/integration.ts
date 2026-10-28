import { buildTutorialLaunchUrl, parseTutorialManifest } from "../../core/schema";
import { createTutorialRecordingDraft, IndexedDbTutorialDraftStore } from "../../recording";
import { createTutorialShareCodec } from "../../share";
import type { TutorialSessionIntegration } from "../../components/tutorial-session";
import { projectActionChangesView, projectContextActions, projectViewContext } from "./project-model";

export const PROJECT_DRAFT_DATABASE = "tourkit-project-studio-example";
export const createProjectDraftStore = () => new IndexedDbTutorialDraftStore(PROJECT_DRAFT_DATABASE, "drafts");

/** Every URL is resolved once here. The same build can be served beneath any directory. */
export function projectPaths(pageUrl: string) {
  const base = new URL(".", pageUrl);
  return { studio: new URL("index.html", base).pathname, stage: new URL("stage.html", base).pathname };
}

export function createProjectIntegration(pageUrl: string) {
  const paths = projectPaths(pageUrl);
  const shareCodec = createTutorialShareCodec({ allowedLaunchPaths: () => new Set([paths.stage]), allowedHashKeys: [] });
  const session: TutorialSessionIntegration = {
    createDraftStore: createProjectDraftStore,
    decodeTutorialShare: shareCodec.decodeTutorialShare,
    viewContext: projectViewContext,
    resolveContextActions: projectContextActions,
    actionChangesView: projectActionChangesView,
  };
  const createDraft = () => createTutorialRecordingDraft({
    title: "Create a project", description: "Record a project name and priority, then save the project.",
    fixture: "empty-project-list", path: paths.stage, hash: { tutorialAuthor: 1 },
  });
  const lesson = parseTutorialManifest({
    schemaVersion: 1, id: "project-studio-introduction", title: "Create a project", estimatedMinutes: 2,
    description: "Open a dialog, enter a project name, select its priority and save.", spotlightStyle: "glow",
    launch: { fixture: "empty-project-list", path: paths.stage },
    chapters: [{ id: "first-project", title: "Your first project", steps: [
      { id: "open", anchor: { id: "projects.add" }, action: { id: "projects.open-create" }, check: { all: [{ path: "surfaces.create.open", equals: true }] }, overlay: { title: "Open New project", body: "Press New project to open its editor." } },
      { id: "name", anchor: { id: "projects.name" }, action: { id: "projects.set-name", args: { name: "Launch plan" } }, check: { all: [{ path: "draft.name", equals: "Launch plan" }] }, overlay: { title: "Name the project", body: "Enter Launch plan in Project name." } },
      { id: "priority", anchor: { id: "projects.priority" }, action: { id: "projects.set-priority", args: { priority: "high" } }, check: { all: [{ path: "draft.priority", equals: "high" }] }, overlay: { title: "Choose High priority", body: "Open Project priority and choose High." } },
      { id: "save", anchor: { id: "projects.save" }, action: { id: "projects.save" }, check: { all: [{ path: "projects", where: { name: "Launch plan", priority: "high" }, count: { min: 1 }, mode: "delta", watch: true }] }, overlay: { title: "Save the project", body: "Press Save project. A new project must appear in the list." } },
    ] }],
  });
  return { paths, session, shareCodec, createDraft, lesson, sourceUrl: (draft: ReturnType<typeof createDraft>) => buildTutorialLaunchUrl(draft.launch) };
}
