// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTutorialRecordingDraft, insertDraftStep } from "../recording/draft";
import type { TutorialExportSource } from "../export";
import { DEFAULT_TUTORIAL_EXPORT_OPTIONS } from "../export/options";
import { DEFAULT_TUTORIAL_STUDIO_ENVIRONMENT, TutorialStudioEnvironmentProvider } from "../studio/environment";

const mocks = vi.hoisted(() => ({ run: vi.fn(), download: vi.fn(), create: vi.fn(), revoke: vi.fn() }));
vi.mock("./tutorial-export-runner", () => ({ runTutorialExport: mocks.run, tutorialScreenshotCacheKey: () => "cache", stepsNeedingScreenshots: () => 0,
  tutorialSourceTitle: () => "Test guide", tutorialSourceSteps: () => [] }));
vi.mock("../export", async (original) => ({ ...await original<typeof import("../export")>(), downloadTutorialFile: mocks.download }));
vi.mock("./tutorial-export-settings", () => ({ TutorialExportSettings: ({ onOptionsChange }: { onOptionsChange: (patch: { includeCover: boolean }) => void }) =>
  <button onClick={() => onOptionsChange({ includeCover: true })}>Change cover</button> }));
import { TutorialExportDialog } from "./tutorial-export-dialog";

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear(); vi.clearAllMocks(); mocks.create.mockReturnValue("about:blank#test-preview");
  URL.createObjectURL = mocks.create; URL.revokeObjectURL = mocks.revoke;
});
let root: Root | undefined;
afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.innerHTML = ""; vi.restoreAllMocks(); });
const render = async (node: React.ReactNode) => {
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(node));
};
const click = async (name: string) => {
  const button = Array.from(document.querySelectorAll("button")).find((element) => element.textContent?.trim() === name);
  expect(button).toBeTruthy(); await act(async () => button!.click());
};
const preview = () => document.querySelector('iframe[title="PDF export preview"]');
const source = (): TutorialExportSource => ({ draft: insertDraftStep(createTutorialRecordingDraft({ title: "Test" }), null) });

describe("exact tutorial PDF preview", () => {
  it("previews and downloads the same generated Blob, then invalidates and revokes it when options change", async () => {
    const blob = new Blob(["%PDF-test"], { type: "application/pdf" });
    mocks.run.mockResolvedValue({ blob, filename: "test.pdf" });
    await render(<TutorialExportDialog source={source()} onClose={() => {}} />);
    await click("Preview PDF");
    expect(preview()?.getAttribute("src")).toBe("about:blank#test-preview");
    expect(mocks.download).not.toHaveBeenCalled();
    await click("Download PDF");
    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(mocks.download).toHaveBeenCalledWith(blob, "test.pdf");
    await click("Change cover");
    expect(preview()).toBeNull();
    expect(mocks.revoke).toHaveBeenCalledWith("about:blank#test-preview");
    await click("Preview PDF");
    expect(mocks.run).toHaveBeenCalledTimes(2);
    act(() => root!.unmount()); root = undefined;
  });
  it("uses the host's existing export preferences for preview and saves", async () => {
    const saved = { ...DEFAULT_TUTORIAL_EXPORT_OPTIONS, branding: { ...DEFAULT_TUTORIAL_EXPORT_OPTIONS.branding, author: "Existing application" } };
    const read = vi.fn(() => saved);
    const save = vi.fn();
    const environment = { ...DEFAULT_TUTORIAL_STUDIO_ENVIRONMENT, exportPreferences: { defaults: saved, read, save } };
    mocks.run.mockResolvedValue({ blob: new Blob(["%PDF-test"]), filename: "test.pdf" });
    await render(<TutorialStudioEnvironmentProvider environment={environment}><TutorialExportDialog source={source()} onClose={() => {}} /></TutorialStudioEnvironmentProvider>);
    await click("Preview PDF");
    expect(read).toHaveBeenCalledTimes(1);
    expect(mocks.run.mock.calls[0][0].options.branding.author).toBe("Existing application");
    await click("Change cover");
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ includeCover: true, branding: expect.objectContaining({ author: "Existing application" }) }));
  });

  it("preserves a preview when the source wrapper changes and invalidates when the draft changes", async () => {
    const original = source();
    mocks.run.mockResolvedValue({ blob: new Blob(["%PDF-test"]), filename: "test.pdf" });
    await render(<TutorialExportDialog source={original} onClose={() => {}} />);
    await click("Preview PDF");
    await act(async () => root!.render(<TutorialExportDialog source={{ ...original }} onClose={() => {}} />));
    expect(preview()?.getAttribute("src")).toBe("about:blank#test-preview");
    expect(mocks.revoke).not.toHaveBeenCalled();
    await click("Download PDF");
    expect(mocks.run).toHaveBeenCalledTimes(1);
    await act(async () => root!.render(<TutorialExportDialog source={source()} onClose={() => {}} />));
    expect(preview()).toBeNull();
    expect(mocks.revoke).toHaveBeenCalledWith("about:blank#test-preview");
  });

  it("ignores a completed build after cancellation and creates no preview URL", async () => {
    let resolve!: (value: { blob: Blob; filename: string }) => void;
    mocks.run.mockImplementation(() => new Promise((done) => { resolve = done; }));
    await render(<TutorialExportDialog source={source()} onClose={() => {}} />);
    await click("Preview PDF");
    await click("Cancel");
    await act(async () => resolve({ blob: new Blob(["%PDF-test"]), filename: "cancelled.pdf" }));
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.download).not.toHaveBeenCalled();
    expect(document.querySelector('[role="status"]')?.textContent).toContain("Export cancelled");
    act(() => root!.unmount()); root = undefined;
  });
});

