// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TutorialManifestSchema, type TutorialViewContext } from "../core/schema";
import { TUTORIAL_IFRAME_PROTOCOL } from "../player/iframe-protocol";
import { MemoryTutorialDraftStore } from "../recording/draft-store";
import { tutorialManifestToRecordingDraft } from "../recording/draft";
import {
  DEFAULT_TUTORIAL_SESSION_INTEGRATION as defaults,
  forgetTutorialRun,
  readTutorialLocationState,
  useTutorialAuthoringBridge,
  useTutorialDraftManifest,
  type TutorialSessionIntegration,
} from "./tutorial-session";

let root: Root | undefined;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root?.unmount()); root = undefined; container.remove(); vi.restoreAllMocks(); });
const render = async (node: ReactNode) => { await act(async () => root!.render(node)); };
const manifest = TutorialManifestSchema.parse({
  schemaVersion: 1, id: "example", title: "Example tutorial",
  launch: { path: "/example/", fixture: "example", hash: {} },
  chapters: [{ id: "one", title: "One", steps: [{ id: "save", action: { id: "example.save" }, overlay: { title: "Save", body: "Save the example." } }] }],
});

describe("portable tutorial sessions", () => {
  it.each(["#/projects/active", "#chapter-2", "#route=%2Fprojects%2Factive"])(
    "preserves the unrelated fragment %s when removing query run parameters",
    (fragment) => {
      const before = window.location.href;
      try {
        window.history.replaceState(null, "", `/training/?locale=en&tutorial=lesson&tutorialMode=practice&tutorialRun=once${fragment}`);
        expect(readTutorialLocationState()).toMatchObject({ tutorialId: "lesson", mode: "practice", run: "once", fixture: null });
        forgetTutorialRun();
        expect(window.location.pathname + window.location.search + window.location.hash).toBe(`/training/?locale=en${fragment}`);
      } finally { window.history.replaceState(null, "", before); }
    },
  );

  it("removes legacy hash run parameters while retaining the fixture and workspace", () => {
    const before = window.location.href;
    try {
      window.history.replaceState(null, "", "/training/?locale=en#tutorial=legacy&fixture=blank&tab=preview&tutorialMode=practice");
      forgetTutorialRun();
      expect(window.location.pathname + window.location.search + window.location.hash).toBe("/training/?locale=en#fixture=blank&tab=preview");
    } finally { window.history.replaceState(null, "", before); }
  });

  it("restores a view through the provided navigation adapter and ignores unrelated senders", async () => {
    const parent = { postMessage: vi.fn() };
    vi.spyOn(window, "parent", "get").mockReturnValue(parent as unknown as Window);
    const action = { id: "example.selectTab", args: { tab: "details" }, match: "subset" as const };
    const resolveContextActions = vi.fn(() => [action]);
    const execute = vi.fn(async () => {});
    const integration = { ...defaults, resolveContextActions };
    function Bridge() { useTutorialAuthoringBridge(true, {}, execute, true, undefined, integration); return null; }
    await render(<Bridge />);
    const context: TutorialViewContext = { label: "Details", all: [{ path: "workspace.activeTab", equals: "details" }] };
    const data = { protocol: TUTORIAL_IFRAME_PROTOCOL, type: "tutorial:view-restore", id: "restore", context };
    await act(async () => { window.dispatchEvent(new MessageEvent("message", { source: window, origin: window.location.origin, data })); });
    expect(execute).not.toHaveBeenCalled();
    await act(async () => { window.dispatchEvent(new MessageEvent("message", { source: parent as unknown as Window, origin: window.location.origin, data })); });
    expect(resolveContextActions).toHaveBeenCalledWith(context);
    expect(execute).toHaveBeenCalledWith(action);
    expect(parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: "tutorial:view-restored", id: "restore" }), window.location.origin);
  });

  it("reads local drafts from the supplied store and shared links from the supplied codec", async () => {
    const store = new MemoryTutorialDraftStore();
    await store.put(tutorialManifestToRecordingDraft(manifest));
    const createDraftStore = vi.fn(() => store);
    const decodeTutorialShare = vi.fn(async () => ({ ...manifest, title: "Shared example" }));
    const integration: TutorialSessionIntegration = { ...defaults, createDraftStore, decodeTutorialShare };
    function Probe({ id }: { id: string }) { const tutorial = useTutorialDraftManifest(id, 0, integration); return <p>{tutorial?.title ?? "Loading"}</p>; }
    await render(<Probe id="draft:example" />);
    await act(async () => { await vi.waitFor(() => expect(container.textContent).toBe("Example tutorial")); });
    expect(createDraftStore).toHaveBeenCalledTimes(1);
    await render(<Probe id="link:example-token" />);
    expect(decodeTutorialShare).toHaveBeenCalledWith("example-token");
    expect(container.textContent).toBe("Shared example");
    expect(createDraftStore).toHaveBeenCalledTimes(1);
  });
});

