import { TutorialCheckSchema, type TutorialSemanticAction, type TutorialValue, type TutorialViewContext } from "../../core/schema";
import type { TutorialViewState } from "../../core/view-context";
import type { TutorialCheckSuggestionProvider } from "../../recording/check-suggestions";

export const PROJECT_ACTIONS = [
  "projects.open-create", "projects.close-create", "projects.set-name",
  "projects.set-priority", "projects.save",
] as const;
export const PROJECT_FIXTURES = [
  { id: "empty-project-list", label: "Empty project list", description: "Start with no projects and a blank draft." },
  { id: "sample-project-list", label: "One sample project", description: "A synthetic project is already saved; new work must add another." },
] as const;
export const PROJECT_PRIORITIES = [
  { value: "low", label: "Low" }, { value: "medium", label: "Medium" }, { value: "high", label: "High" },
] as const;
export type ProjectPriority = (typeof PROJECT_PRIORITIES)[number]["value"];
export type Project = { id: string; name: string; priority: ProjectPriority };
export type ProjectState = {
  projects: Project[];
  draft: { name: string; priority: ProjectPriority };
  host: { page: "projects"; dialog: "create" | null };
  surfaces: { create: { open: boolean } };
};

export function createProjectFixture(fixture: string): ProjectState {
  if (!PROJECT_FIXTURES.some((entry) => entry.id === fixture)) throw new Error(`Unknown project fixture: ${fixture}`);
  return {
    projects: fixture === "sample-project-list" ? [{ id: "project-1", name: "Website refresh", priority: "low" }] : [],
    draft: { name: "", priority: "medium" },
    host: { page: "projects", dialog: null }, surfaces: { create: { open: false } },
  };
}

/** The same domain operation is used by the real controls, Watch, seek and capture. */
export function applyProjectAction(state: ProjectState, id: string, args: Readonly<Record<string, unknown>> = {}): { state: ProjectState; result?: Project } {
  const show = (open: boolean) => ({ ...state, host: { page: "projects" as const, dialog: open ? "create" as const : null }, surfaces: { create: { open } } });
  if (id === "projects.open-create") return { state: show(true) };
  if (id === "projects.close-create") return { state: show(false) };
  if (!PROJECT_ACTIONS.includes(id as (typeof PROJECT_ACTIONS)[number])) throw new Error(`Unsupported project action: ${id}`);
  if (!state.surfaces.create.open) throw new Error("Open the New project dialog first.");
  if (id === "projects.set-name") {
    if (typeof args.name !== "string" || args.name.length > 80) throw new Error("Enter a project name of at most 80 characters.");
    return { state: { ...state, draft: { ...state.draft, name: args.name } } };
  }
  if (id === "projects.set-priority") {
    if (args.priority !== "low" && args.priority !== "medium" && args.priority !== "high") throw new Error("Choose a valid project priority.");
    return { state: { ...state, draft: { ...state.draft, priority: args.priority } } };
  }
  const name = state.draft.name.trim();
  if (!name) throw new Error("Enter a project name before saving.");
  const result: Project = { id: `project-${state.projects.length + 1}`, name, priority: state.draft.priority };
  return { result, state: { ...show(false), projects: [...state.projects, result], draft: { name: "", priority: "medium" } } };
}

/** Synchronous snapshots make sequential replay deterministic; React observes new identities. */
export class ProjectStore {
  private state: ProjectState;
  private readonly listeners = new Set<() => void>();
  constructor(readonly fixture: string) { this.state = createProjectFixture(fixture); }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(state: ProjectState) { this.state = state; for (const listener of this.listeners) listener(); }
  reset() { this.publish(createProjectFixture(this.fixture)); }
  execute(id: string, args?: Readonly<Record<string, unknown>>) {
    const next = applyProjectAction(this.state, id, args);
    this.publish(next.state);
    return next.result;
  }
}

const ANCHORS: Readonly<Record<string, string>> = {
  "projects.open-create": "projects.add", "projects.close-create": "projects.close",
  "projects.set-name": "projects.name", "projects.set-priority": "projects.priority", "projects.save": "projects.save",
};
export const projectAnchor = (id: string) => ANCHORS[id];
export const projectActionChangesView = (action: Pick<TutorialSemanticAction, "id">) =>
  ["projects.open-create", "projects.close-create", "projects.save"].includes(action.id);
export function projectViewContext(state: TutorialViewState): TutorialViewContext {
  return { label: state["host.dialog"] === "create" ? "New project dialog" : "Project list", all: [
    { path: "host.page", equals: "projects" }, { path: "host.dialog", equals: state["host.dialog"] === "create" ? "create" : null },
  ] };
}
export function projectContextActions(context: TutorialViewContext): readonly TutorialSemanticAction[] {
  const dialog = context.all.find((part) => part.path === "host.dialog");
  return dialog ? [{ id: dialog.equals === "create" ? "projects.open-create" : "projects.close-create", match: "subset" }] : [];
}

/** Projection sessions belong to one recording, so separate editors cannot share state. */
export const projectCheckSuggestions: TutorialCheckSuggestionProvider = {
  forLaunch(launch) {
    let projected = createProjectFixture(launch.fixture);
    return {
      suggest(action) {
        if (!action) return { reason: "no-action" };
        let path: string;
        let equals: TutorialValue;
        let description: string;
        switch (action.id) {
          case "projects.open-create": path = "surfaces.create.open"; equals = true; description = "the New project dialog is open"; break;
          case "projects.close-create": path = "surfaces.create.open"; equals = false; description = "the New project dialog is closed"; break;
          case "projects.set-name":
            if (typeof action.args?.name !== "string") return { reason: "unsupported-action" };
            if (projected.draft.name === action.args.name) return { reason: "already-satisfied" };
            path = "draft.name"; equals = action.args.name; description = `the name is ${equals}`; break;
          case "projects.set-priority":
            if (typeof action.args?.priority !== "string") return { reason: "unsupported-action" };
            if (projected.draft.priority === action.args.priority) return { reason: "already-satisfied" };
            path = "draft.priority"; equals = action.args.priority; description = `the priority is ${equals}`; break;
          case "projects.save": return { check: TutorialCheckSchema.parse({ description: "a new project with these details is saved", all: [
            { path: "projects", where: { name: projected.draft.name.trim(), priority: projected.draft.priority }, count: { min: 1 }, mode: "delta", watch: true },
            { path: "surfaces.create.open", equals: false },
          ] }) };
          default: return { reason: "unsupported-action" };
        }
        return { check: TutorialCheckSchema.parse({ description, all: [{ path, equals }] }) };
      },
      apply(action) { if (action && PROJECT_ACTIONS.includes(action.id as (typeof PROJECT_ACTIONS)[number])) projected = applyProjectAction(projected, action.id, action.args).state; },
    };
  },
};
