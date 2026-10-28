import { buildTutorialLaunchUrl } from "../../core/schema";
import { DEFAULT_TUTORIAL_STUDIO_ENVIRONMENT, type TutorialStudioEnvironment } from "../../studio/environment";
import { createProjectDraftStore, createProjectIntegration } from "./integration";
import { PROJECT_FIXTURES, projectActionChangesView, projectAnchor, projectCheckSuggestions, projectContextActions, projectViewContext } from "./project-model";

export function createProjectStudioEnvironment(pageUrl: string): TutorialStudioEnvironment {
  const integration = createProjectIntegration(pageUrl);
  const stage = {
    id: "workspace", label: "Project workspace", path: integration.paths.stage,
    defaultFixture: PROJECT_FIXTURES[0].id, fixtures: PROJECT_FIXTURES,
    snapshotPaths: ["projects", "draft.name", "draft.priority", "surfaces.create.open", "host.dialog"],
  };
  const catalog = [integration.lesson];
  return {
    ...DEFAULT_TUTORIAL_STUDIO_ENVIRONMENT,
    builtInTutorials: catalog, peekAllTutorials: () => catalog, loadAllTutorials: async () => catalog,
    isBuiltInTutorialId: (id) => id === integration.lesson.id,
    peekTutorial: (id) => id === integration.lesson.id ? integration.lesson : null,
    loadTutorial: async (id) => id === integration.lesson.id ? integration.lesson : null,
    defaultStageId: stage.id, defaultStageLabel: stage.label,
    // The default stage already has a picker entry. Additional stages would go here.
    stages: [], getStage: (id) => id === stage.id ? stage : null,
    stageOfLaunch: () => stage.id, readPreferredStage: () => stage.id, writePreferredStage: () => {},
    launchForStage: (_id, current) => ({ ...current, path: stage.path, fixture: stage.defaultFixture, hash: { ...current.hash, tutorialAuthor: 1 } }),
    canSeek: (id) => id === stage.id, defaultSnapshotPaths: stage.snapshotPaths,
    createDraft: integration.createDraft, createDraftStore: createProjectDraftStore,
    resolvePath: (path) => path, studioPath: integration.paths.studio,
    buildTutorialHref: (tutorial, mode) => buildTutorialLaunchUrl({ ...tutorial.launch, hash: { ...tutorial.launch.hash, tutorial: tutorial.id, tutorialMode: mode } }),
    viewContext: projectViewContext, resolveContextActions: projectContextActions,
    actionChangesView: projectActionChangesView, inferAnchor: projectAnchor, suggestions: projectCheckSuggestions,
    selectedStepView: (step) => step.context ?? projectViewContext({ "host.page": "projects", "host.dialog": ["projects.set-name", "projects.set-priority", "projects.save", "projects.close-create"].includes(step.action?.id ?? "") ? "create" : null }),
    shareCodec: integration.shareCodec,
    captureRuntime: { resolveLaunchUrl: buildTutorialLaunchUrl },
    actionExample: "projects.open-create",
    hubAreas: [{ id: "studio", label: "Project Studio", href: integration.paths.studio }],
    homeLink: { label: "Open project workspace", href: integration.paths.stage },
  };
}
