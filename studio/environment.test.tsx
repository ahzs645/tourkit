// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TutorialManifestSchema } from "../core/schema";
import { MemoryTutorialDraftStore } from "../recording/draft-store";
import { createTutorialRecordingDraft } from "../recording/draft";
import { TutorialHubNav } from "../components/tutorial-hub-nav";
import { MyTutorials } from "./my-tutorials";
import { TutorialStudio } from "./tutorial-studio";
import { createBlankStudioDraft, draftPlayHref, studioHref } from "./studio-drafts";
import {
  DEFAULT_TUTORIAL_STUDIO_ENVIRONMENT as defaults,
  TutorialStudioEnvironmentProvider,
  useEnvironmentTutorial,
  type TutorialStudioEnvironment,
} from "./environment";

let root: Root | undefined;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root?.unmount()); root = undefined; container.remove(); vi.restoreAllMocks(); });
const render = async (node: ReactNode) => { await act(async () => root!.render(node)); };
const environmentFor = (name: string): TutorialStudioEnvironment => ({
  ...defaults,
  defaultStageLabel: name,
  studioPath: "/author/",
  resolvePath: (path) => `/apps/${name}${path}`,
  hubAreas: [{ id: name, label: `${name} lessons`, href: "/lessons/" }],
  homeLink: { label: `Open ${name}`, href: "/" },
});

describe("application-provided Studio environment", () => {
  it("renders two independent navigation trees without changing shared configuration", async () => {
    const first = environmentFor("alpha");
    const second = environmentFor("beta");
    await render(<>
      <TutorialStudioEnvironmentProvider environment={first}><TutorialHubNav area="alpha" context="Alpha" /></TutorialStudioEnvironmentProvider>
      <TutorialStudioEnvironmentProvider environment={second}><TutorialHubNav area="beta" context="Beta" /></TutorialStudioEnvironmentProvider>
    </>);
    expect(container.querySelector('[data-testid="tutorial-area:alpha"]')?.getAttribute("href")).toBe("/apps/alpha/lessons/");
    expect(container.querySelector('[data-testid="tutorial-area:beta"]')?.getAttribute("href")).toBe("/apps/beta/lessons/");
    expect(defaults.hubAreas.some((area) => area.id === "alpha")).toBe(false);
    expect(container.textContent).not.toMatch(/Webforms|MOIS|PowerChart|AlayaCare/);
  });

  it("opens the custom authoring fixture when only createDraft overrides the defaults", async () => {
    const store = new MemoryTutorialDraftStore();
    const createDraft = vi.fn(() => createTutorialRecordingDraft({
      title: "Custom first draft", path: "/sample-stage/", fixture: "empty-board",
      hash: { tutorialAuthor: 1, tab: "board" },
    }));
    const environment = { ...defaults, createDraft, createDraftStore: () => store };
    await render(<TutorialStudioEnvironmentProvider environment={environment}><TutorialStudio /></TutorialStudioEnvironmentProvider>);
    const frame = container.querySelector('iframe[title="Tutorial recording fixture"]');
    expect(frame?.getAttribute("src")).toBe("/sample-stage/#tutorialAuthor=1&tab=board&fixture=empty-board");
    expect(createDraft).toHaveBeenCalledTimes(1);
  });

  it("uses the supplied draft factory, launch path, store and editor route", async () => {
    const store = new MemoryTutorialDraftStore();
    const environment = {
      ...environmentFor("sample"),
      createDraftStore: () => store,
      createDraft: () => createTutorialRecordingDraft({ title: "Sample workflow", path: "/sample/", fixture: "sample", hash: { tutorialAuthor: 1 } }),
    };
    const draft = createBlankStudioDraft(undefined, environment);
    await store.put(draft);
    await render(<TutorialStudioEnvironmentProvider environment={environment}><MyTutorials /></TutorialStudioEnvironmentProvider>);
    expect(container.textContent).toContain("Sample workflow");
    expect(studioHref(draft.id, environment)).toBe(`/apps/sample/author/?open=${draft.id}`);
    const play = draftPlayHref(draft, "practice", environment);
    expect(play).toContain("/apps/sample/sample/#");
    expect(play).toContain("tutorialMode=practice");
    expect(play).not.toContain("tutorialAuthor");
    expect(await store.get(draft.id)).toBeTruthy();
  });

  it("loads catalog entries through the adapter and does not reuse another environment's result", async () => {
    const tutorial = (title: string) => TutorialManifestSchema.parse({
      schemaVersion: 1, id: "shared-id", title,
      launch: { path: "/", fixture: "demo", hash: {} },
      chapters: [{ id: "one", title: "One", steps: [{ id: "step", action: { id: "demo.save" }, overlay: { title: "Save", body: "Save the demo." } }] }],
    });
    const alpha = { ...environmentFor("alpha"), isDeferredTutorialId: () => true, loadTutorial: vi.fn(async () => tutorial("Alpha tutorial")) };
    let resolve!: (value: ReturnType<typeof tutorial>) => void;
    const beta = { ...environmentFor("beta"), isDeferredTutorialId: () => true, loadTutorial: vi.fn(() => new Promise<ReturnType<typeof tutorial>>((done) => { resolve = done; })) };
    function Probe() { const value = useEnvironmentTutorial("shared-id"); return <p>{value.loading ? "Loading" : value.tutorial?.title}</p>; }
    await render(<TutorialStudioEnvironmentProvider environment={alpha}><Probe /></TutorialStudioEnvironmentProvider>);
    expect(container.textContent).toBe("Alpha tutorial");
    await render(<TutorialStudioEnvironmentProvider environment={beta}><Probe /></TutorialStudioEnvironmentProvider>);
    expect(container.textContent).toBe("Loading");
    await act(async () => resolve(tutorial("Beta tutorial")));
    expect(container.textContent).toBe("Beta tutorial");
    expect(alpha.loadTutorial).toHaveBeenCalledTimes(1);
    expect(beta.loadTutorial).toHaveBeenCalledTimes(1);
  });
});
