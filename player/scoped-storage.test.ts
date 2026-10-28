// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTutorialCompletionStore, markTutorialCompleted, readTutorialCompletions, subscribeTutorialCompletions } from "./completion-store";
import { createTutorialProgressStore, peekTutorialProgress, saveTutorialProgress, subscribeTutorialProgress } from "./progress";
import { createTutorialExportPreferences } from "../export/options";
import { createTutorialExportPresetProfile } from "../export/presets";
import { createTutorialContentTemplateStore } from "../recording/content-blocks";
import { createTutorialSurfaceRegistry } from "./surfaces";

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

describe("scope isolation and compatibility", () => {
  it("retains historical completion and progress records and notifies same-document readers", () => {
    const completed = vi.fn(); const progressing = vi.fn();
    const offCompleted = subscribeTutorialCompletions(completed); const offProgress = subscribeTutorialProgress(progressing);
    try {
      markTutorialCompleted("lesson", "practice");
      saveTutorialProgress("lesson", { mode: "practice", stepIndex: 2, aliases: {} });
      expect(JSON.parse(localStorage.getItem("tourkit:completions")!)).toHaveProperty("lesson.mode", "practice");
      expect(sessionStorage.getItem("tourkit:progress:lesson")).toContain('"stepIndex":2');
      expect(readTutorialCompletions().lesson.mode).toBe("practice");
      expect(peekTutorialProgress("lesson")?.stepIndex).toBe(2);
      expect(completed).toHaveBeenCalledTimes(1); expect(progressing).toHaveBeenCalledTimes(1);
    } finally { offCompleted(); offProgress(); }
    markTutorialCompleted("second", "autoplay");
    expect(completed).toHaveBeenCalledTimes(1);
  });

  it("isolates reused lesson IDs and broadcasts between store instances in the same scope", () => {
    const a = createTutorialCompletionStore({ namespace: "account-a" });
    const same = createTutorialCompletionStore({ namespace: "account-a" });
    const b = createTutorialCompletionStore({ namespace: "account-b" });
    const changed = vi.fn(); const unrelated = vi.fn();
    const off = same.subscribe(changed); const offB = b.subscribe(unrelated);
    try {
      a.mark("shared-id", "practice");
      expect(same.read()["shared-id"].mode).toBe("practice");
      expect(b.read()).toEqual({}); expect(readTutorialCompletions()).toEqual({});
      expect(changed).toHaveBeenCalledTimes(1); expect(unrelated).not.toHaveBeenCalled();
      a.clear("shared-id"); expect(same.read()).toEqual({}); expect(changed).toHaveBeenCalledTimes(2);
    } finally { off(); offB(); }
  });

  it("escapes namespaces so structured lesson IDs cannot collide with another scope", () => {
    const a = createTutorialProgressStore({ namespace: "a" });
    const b = createTutorialProgressStore({ namespace: "a:tutorial:progress:x" });
    const changedB = vi.fn();
    const off = b.subscribe(changedB);
    try {
      a.save("x:tutorial:progress:lesson", { stepIndex: 1, mode: "practice", aliases: { owner: "a" } });
      expect(b.peek("lesson")).toBeNull();
      expect(changedB).not.toHaveBeenCalled();
      b.save("lesson", { stepIndex: 2, mode: "practice", aliases: { owner: "b" } });
      expect(a.read("x:tutorial:progress:lesson", "practice", 4)?.aliases).toEqual({ owner: "a" });
      expect(b.read("lesson", "practice", 4)?.aliases).toEqual({ owner: "b" });
      expect(sessionStorage.getItem("a%3Atutorial%3Aprogress%3Ax:tutorial:progress:lesson")).toContain('"owner":"b"');
    } finally { off(); }
  });

  it("notifies cross-tab clear/change events but ignores other namespaces", () => {
    const store = createTutorialCompletionStore({ namespace: "shared" }); const changed = vi.fn();
    const off = store.subscribe(changed);
    try {
      window.dispatchEvent(new StorageEvent("storage", { key: "other:tutorial:completions" }));
      expect(changed).not.toHaveBeenCalled();
      window.dispatchEvent(new StorageEvent("storage", { key: "shared:tutorial:completions" }));
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
      expect(changed).toHaveBeenCalledTimes(2);
    } finally { off(); }
  });

  it("validates resumed progress and survives inaccessible or exhausted storage", () => {
    const a = createTutorialProgressStore({ namespace: "a" }); const b = createTutorialProgressStore({ namespace: "b" });
    a.save("lesson", { stepIndex: 2, mode: "practice", aliases: { created: "p-1" } });
    expect(a.read("lesson", "practice", 4)?.aliases).toEqual({ created: "p-1" });
    expect(a.read("lesson", "autoplay", 4)).toBeNull(); expect(b.peek("lesson")).toBeNull();
    expect(a.read("lesson", "practice", 2)).toBeNull();
    const unavailable = createTutorialProgressStore({ storage: () => { throw new Error("Blocked"); } });
    expect(() => unavailable.save("lesson", { stepIndex: 1, mode: "practice", aliases: {} })).not.toThrow();
    expect(unavailable.peek("lesson")).toBeNull();
    expect(() => createTutorialCompletionStore({ namespace: " " })).toThrow("namespace");
  });

  it("scopes export preferences, presets and author text blocks", () => {
    const a = createTutorialExportPreferences({ namespace: "a" }); const b = createTutorialExportPreferences({ namespace: "b" });
    a.save({ ...a.defaults, paperSize: "LETTER" });
    expect(a.read().paperSize).toBe("LETTER"); expect(b.read().paperSize).toBe("A4");
    const presetsA = createTutorialExportPresetProfile(undefined, { namespace: "a" });
    const presetsB = createTutorialExportPresetProfile(undefined, { namespace: "b" });
    presetsA.saveTutorialExportPresets([presetsA.makeTutorialExportPreset("Office", a.read())]);
    expect(presetsB.readTutorialExportPresets()).toEqual([]);
    const templatesA = createTutorialContentTemplateStore({ namespace: "a" });
    const templatesB = createTutorialContentTemplateStore({ namespace: "b" });
    templatesA.save([{ id: "note", name: "Notice", contentKind: "note", title: "Notice", instruction: "Example" }]);
    expect(templatesA.read()).toHaveLength(1); expect(templatesB.read()).toEqual([]);
  });

  it("keeps application surface registries independent", () => {
    const a = createTutorialSurfaceRegistry(); const b = createTutorialSurfaceRegistry();
    a.report("editor", { open: true });
    expect(a.snapshot()).toEqual({ editor: { open: true } }); expect(b.snapshot()).toEqual({});
  });
});
