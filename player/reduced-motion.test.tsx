// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parseTutorialManifest } from "../core/schema";
import { TutorialPlayer } from "./tutorial-player";

const configs = vi.hoisted(() => [] as { animate?: boolean; smoothScroll?: boolean; duration?: number }[]);
vi.mock("driver.js", async (original) => {
  const actual = await original<typeof import("driver.js")>();
  return { ...actual, driver: (config: (typeof configs)[number]) => {
    configs.push(config);
    return actual.driver(config);
  } };
});

const tour = parseTutorialManifest({
  schemaVersion: 1, id: "motion", title: "Motion", launch: { fixture: "app" }, interaction: "guided",
  chapters: [{ id: "tour", title: "Tour", steps: [
    { id: "one", completion: "continue", anchor: { id: "target" }, overlay: { title: "One", body: "Read this." } },
  ] }],
});

let root: Root;
let container: HTMLElement;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  configs.length = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const play = async (reduce: boolean) => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: reduce && query.includes("reduce"), media: query }));
  await act(async () => root.render(<>
    <button data-tutorial-id="target">Target</button>
    <TutorialPlayer manifest={tour} persistProgress={false} transitionMs={250} />
  </>));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
  return configs.at(-1)!;
};

it("glides the spotlight between steps by default", async () => {
  expect(await play(false)).toMatchObject({ animate: true, smoothScroll: true, duration: 250 });
});

it("keeps the spotlight still for learners who asked for reduced motion", async () => {
  expect(await play(true)).toMatchObject({ animate: false, smoothScroll: false, duration: undefined });
});
