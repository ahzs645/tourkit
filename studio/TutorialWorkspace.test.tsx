// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTutorialRecordingDraft } from "../recording/draft";
import { MemoryTutorialDraftStore } from "../recording/draft-store";
import { TutorialWorkspace } from "./TutorialWorkspace";
import { DEFAULT_TUTORIAL_STUDIO_ENVIRONMENT, TutorialStudioEnvironmentProvider } from "./environment";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  window.history.replaceState(null, "", "/?open=unrelated-url-draft");
});
afterEach(() => { act(() => root.unmount()); container.remove(); window.history.replaceState(null, "", "/"); vi.restoreAllMocks(); });

describe("controlled TutorialWorkspace", () => {
  it("opens the controlled ID and replaces the editor when navigation selects another draft", async () => {
    const store = new MemoryTutorialDraftStore();
    await store.put(createTutorialRecordingDraft({ id: "alpha", title: "Alpha project lesson", path: "/alpha/", fixture: "alpha" }));
    await store.put(createTutorialRecordingDraft({ id: "beta", title: "Beta project lesson", path: "/beta/", fixture: "beta" }));
    await store.put(createTutorialRecordingDraft({ id: "unrelated-url-draft", title: "Unrelated draft", path: "/wrong/", fixture: "wrong" }));
    const environment = { ...DEFAULT_TUTORIAL_STUDIO_ENVIRONMENT, createDraftStore: () => store };
    const render = (id: string | null | undefined) => act(async () => root.render(<TutorialStudioEnvironmentProvider environment={environment}>
      <TutorialWorkspace openDraftId={id} header={<h1>Example library</h1>} loadingContent={<p>Loading route</p>} />
    </TutorialStudioEnvironmentProvider>));
    await render(undefined); expect(container.textContent).toBe("Loading route");
    await render("alpha");
    expect(container.querySelector("iframe")?.getAttribute("src")).toContain("/alpha/");
    expect(container.textContent).toContain("Alpha project lesson");
    expect(container.textContent).not.toContain("Unrelated draft");
    await render("beta");
    expect(container.querySelector("iframe")?.getAttribute("src")).toContain("/beta/");
    expect(container.textContent).toContain("Beta project lesson");
    await render(null); expect(container.textContent).toContain("Example library");
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("creates and opens drafts through the host callback while preserving ordinary link URLs", async () => {
    const store = new MemoryTutorialDraftStore();
    const environment = { ...DEFAULT_TUTORIAL_STUDIO_ENVIRONMENT, createDraftStore: () => store, studioPath: "/nested/author.html", createDraft: () => createTutorialRecordingDraft({ id: "created", title: "Project guide" }) };
    const open = vi.fn();
    await act(async () => root.render(<TutorialStudioEnvironmentProvider environment={environment}><TutorialWorkspace openDraftId={null} onOpenDraft={open} /></TutorialStudioEnvironmentProvider>));
    const create = [...container.querySelectorAll("button")].find((button) => button.textContent === "New tutorial")!;
    await act(async () => create.click());
    expect(open).toHaveBeenCalledWith("created");
    expect((await store.get("created"))?.title).toBe("Project guide");
    expect(window.location.search).toBe("?open=unrelated-url-draft");
    await act(async () => window.dispatchEvent(new Event("focus")));
    const link = container.querySelector<HTMLAnchorElement>('a[href="/nested/author.html?open=created"]')!;
    expect(link).toBeTruthy();
    await act(async () => link.click());
    expect(open).toHaveBeenCalledTimes(2);
  });
});
