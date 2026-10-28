// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { parseTutorialManifest } from "../core/schema";
import { createTutorialProgressStore } from "./progress";
import { TutorialPlayer } from "./tutorial-player";
import type { TutorialPlayerActionExecutor } from "./types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const lesson = parseTutorialManifest({
  schemaVersion: 1, id: "scope-switch-demo", title: "A scoped lesson", launch: { fixture: "empty-demo" },
  chapters: [{ id: "intro", title: "Introduction", steps: [0, 1, 2].map((index) => ({
    id: `step-${index}`, completion: "continue", overlay: { title: `Step ${index + 1}`, body: "Read this step, then continue." },
  })) }],
});
const continueButton = () => document.querySelector<HTMLButtonElement>('[data-testid="tutorial-resume-continue"]');
const prompt = () => document.querySelector('[data-testid="tutorial-resume-prompt"]');
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });

it("remounts on store changes before old progress or aliases can enter the next account", async () => {
  const a = createTutorialProgressStore({ namespace: "switch-a" });
  const b = createTutorialProgressStore({ namespace: "switch-b" });
  a.save(lesson.id, { mode: "practice", stepIndex: 1, aliases: { draft: { id: "a-only" } } });
  b.save(lesson.id, { mode: "practice", stepIndex: 2, aliases: { draft: { id: "b-only" } } });
  const readA = vi.spyOn(a, "read");
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<TutorialPlayer manifest={lesson} state={{}} progressStore={a} />));
    expect(prompt()?.textContent).toContain("step 2 of 3");
    await act(async () => continueButton()?.click());
    await flush();
    expect(prompt()).toBeNull();
    expect(a.read(lesson.id, "practice", 3)?.aliases).toEqual({ draft: { id: "a-only" } });
    const readsBeforeRerender = readA.mock.calls.length;
    await act(async () => root.render(<TutorialPlayer manifest={lesson} state={{ updated: true }} progressStore={a} />));
    expect(prompt()).toBeNull();
    expect(readA).toHaveBeenCalledTimes(readsBeforeRerender);
    const beforeA = a.read(lesson.id, "practice", 3);
    const beforeB = b.read(lesson.id, "practice", 3);
    await act(async () => root.render(<TutorialPlayer manifest={lesson} state={{}} progressStore={b} />));
    expect(prompt()?.textContent).toContain("step 3 of 3");
    expect(a.read(lesson.id, "practice", 3)).toEqual(beforeA);
    expect(b.read(lesson.id, "practice", 3)).toEqual(beforeB);
    await act(async () => continueButton()?.click());
    await flush();
    expect(b.read(lesson.id, "practice", 3)).toMatchObject({ stepIndex: 2, aliases: { draft: { id: "b-only" } } });
    await act(async () => root.render(<TutorialPlayer manifest={lesson} state={{}} progressStore={a} />));
    expect(prompt()?.textContent).toContain("step 2 of 3");
    expect(a.read(lesson.id, "practice", 3)?.aliases).toEqual({ draft: { id: "a-only" } });
  } finally {
    await act(async () => root.unmount());
    host.remove();
    a.clear(lesson.id); b.clear(lesson.id);
  }
});

it("aborts the old in-flight action when changing store identity", async () => {
  const a = createTutorialProgressStore({ namespace: "abort-a" });
  const b = createTutorialProgressStore({ namespace: "abort-b" });
  const autoplay = parseTutorialManifest({ schemaVersion: 1, id: "abort-scope", title: "An async action", defaultMode: "autoplay", launch: { fixture: "empty" },
    chapters: [{ id: "run", title: "Run", steps: [{ id: "load", action: { id: "demo.load" }, overlay: { title: "Loading", body: "Wait for the result." } }] }] });
  const signals: AbortSignal[] = [];
  const execute: TutorialPlayerActionExecutor = (_action, context) => new Promise((_resolve, reject) => {
    signals.push(context.signal);
    context.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<TutorialPlayer manifest={autoplay} state={{}} progressStore={a} onExecuteAction={execute} />));
    await flush();
    expect(signals).toHaveLength(1);
    await act(async () => root.render(<TutorialPlayer manifest={autoplay} state={{}} progressStore={b} onExecuteAction={execute} />));
    await flush();
    expect(signals).toHaveLength(2);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
  expect(signals[1].aborted).toBe(true);
});
