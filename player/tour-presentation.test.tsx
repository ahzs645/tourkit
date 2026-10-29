// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parseTutorialManifest } from "../core/schema";
import { tutorialManifestToRecordingDraft, tutorialRecordingDraftToManifest } from "../recording/draft";
import { TutorialPlayer } from "./tutorial-player";
import type { TutorialPlayerActionExecutor, TutorialPlayerProps } from "./types";

// A product tour: reading steps over a host whose second control lives in a
// drawer that only the host's own navigation opens.
const tour = parseTutorialManifest({
  schemaVersion: 1, id: "product-tour", title: "Product tour", launch: { fixture: "app" },
  interaction: "guided", card: { size: "compact" },
  chapters: [{ id: "tour", title: "Tour", steps: [
    { id: "intro", completion: "continue", anchor: { id: "app.toolbar", placement: "bottom", align: "start" },
      overlay: { title: "The toolbar", body: "Everything starts here." } },
    { id: "drawer", completion: "continue", anchor: { id: "drawer.item" },
      prepare: [{ id: "drawer.open", args: { panel: "files" } }],
      overlay: { title: "Your files", body: "The drawer lists them." } },
  ] }],
});

let root: Root | undefined;
let container: HTMLElement;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container.remove();
  vi.restoreAllMocks();
});

const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
const title = () => document.querySelector('[data-testid="tutorial-overlay"] h2')?.textContent;
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('[data-testid="tutorial-overlay"] button')]
  .find((candidate) => candidate.textContent?.trim() === name);

async function mount(props: Partial<TutorialPlayerProps> = {}) {
  const executed: { id: string; args?: unknown }[] = [];
  function Host() {
    const [drawerOpen, setDrawerOpen] = useState(false);
    const execute: TutorialPlayerActionExecutor = (action) => {
      executed.push({ id: action.id, args: action.args });
      if (action.id === "drawer.open") setDrawerOpen(true);
    };
    return <>
      <div data-tutorial-id="app.toolbar">Toolbar <input aria-label="Search" /></div>
      {drawerOpen ? <aside><button data-tutorial-id="drawer.item">report.pdf</button></aside> : null}
      <TutorialPlayer manifest={tour} state={{ drawerOpen }} onExecuteAction={execute} persistProgress={false} {...props} />
    </>;
  }
  await act(async () => root!.render(<Host />));
  await flush();
  return { executed };
}

it("runs a step's prepare actions before locating its anchor, and again on every entry", async () => {
  const { executed } = await mount();
  expect(title()).toBe("The toolbar");
  expect(executed).toEqual([]);

  await act(async () => button("Next")!.click());
  await flush();
  expect(title()).toBe("Your files");
  expect(executed).toEqual([{ id: "drawer.open", args: { panel: "files" } }]);

  await act(async () => button("Back")!.click());
  await flush();
  await act(async () => button("Next")!.click());
  await flush();
  expect(title()).toBe("Your files");
  expect(executed).toHaveLength(2);
});

it("localises the card and offers a Skip button that stops the run", async () => {
  const onStop = vi.fn();
  await mount({
    onStop,
    labels: { practice: "", progress: "{current}/{total}", next: "Weiter", previous: "Zurück", skip: "Überspringen", stop: "Tour schließen" },
    appearance: { showSkip: true, ring: false, overlayOpacity: 0.7, closeIcon: "close" },
  });
  expect(document.querySelector('[data-testid="tutorial-card-heading"]')?.textContent).toBe("1/2");
  expect(button("Weiter")?.getAttribute("aria-label")).toBe("Weiter");
  expect(document.querySelector('[aria-label="Tour schließen"] svg.lucide-x')).not.toBeNull();
  expect(document.querySelector('[data-testid="tutorial-spotlight"]')).toBeNull();

  await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="tutorial-skip"]')!.click());
  await flush();
  expect(onStop).toHaveBeenCalledTimes(1);
  expect(document.querySelector('[data-testid="tutorial-overlay"]')).toBeNull();
});

it("moves with the arrow keys when asked, but never out of an editable field", async () => {
  await mount({ keyboardNavigation: true });
  const press = (key: string, target: EventTarget = document.body) =>
    act(async () => { target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); });

  await press("ArrowRight", container.querySelector("input")!);
  await flush();
  expect(title()).toBe("The toolbar");

  await press("ArrowRight");
  await flush();
  expect(title()).toBe("Your files");

  await press("ArrowLeft");
  await flush();
  expect(title()).toBe("The toolbar");
});

it("ignores the arrow keys unless keyboard navigation is on", async () => {
  await mount();
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  await flush();
  expect(title()).toBe("The toolbar");
});

it("keeps prepare actions and card alignment through a Studio draft", () => {
  const draft = tutorialManifestToRecordingDraft(tour, new Date("2026-01-01T00:00:00.000Z"));
  expect(draft.steps[0].anchorAlign).toBe("start");
  expect(draft.steps[1].prepare).toEqual([{ id: "drawer.open", args: { panel: "files" }, match: "subset" }]);
  const roundTrip = tutorialRecordingDraftToManifest(draft);
  expect(roundTrip.chapters[0].steps[0].anchor).toMatchObject({ placement: "bottom", align: "start" });
  expect(roundTrip.chapters[0].steps[1].prepare).toEqual(tour.chapters[0].steps[1].prepare);
  expect(roundTrip.card.size).toBe("compact");
});
