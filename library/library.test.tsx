// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { parseTutorialManifest } from "../core/schema";
import { TutorialLibrary } from "./tutorial-library";
import { TutorialLibraryProgress } from "./progress";
import { createTutorialLibraryStatusSource, useTutorialLibraryStatuses } from "./status-source";
import { filterTutorialLibrarySections, tutorialLibraryExportGroups, tutorialLibrarySummary, tutorialStatusKind, tutorialsInSections, type TutorialLibrarySection } from "./model";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function lesson(id: string, title: string, setup = false) {
  return parseTutorialManifest({
    schemaVersion: 1, id, title, description: `Learn ${title.toLowerCase()}`, estimatedMinutes: 7,
    launch: { path: "/training", fixture: "empty" },
    ...(setup ? { setup: { kind: "task", goal: "Create a purchase order", audience: ["Storekeepers"], access: ["Training workspace"], startingScreen: "Inventory",
      sources: [{ title: "Operations guide", version: "1", articleIds: ["receiving-42"] }], limitations: ["Practice only"] } } : {}),
    chapters: [{ id: "start", title: "Start", steps: [{ id: "read", completion: "continue", overlay: { title, body: "Read the introduction" } }] }],
  });
}

const inventory = lesson("inventory.create-order", "Create an order", true);
const astronomy = lesson("astronomy.plan-session", "Plan an observing session");
const collections: readonly TutorialLibrarySection[] = [
  { id: "supply-chain", title: "Warehouse training", description: "Receiving supplies", tutorials: [inventory] },
  { id: "night-sky", title: "Observatory training", tutorials: [astronomy] },
];

describe("published tutorial library model", () => {
  it("combines word search, status and setup filters without relying on manifest track IDs", () => {
    const statuses = { [inventory.id]: { completedAt: 17 }, [astronomy.id]: { inProgressStep: 1 } };
    expect(filterTutorialLibrarySections(collections, statuses, { query: "STOREKEEPERS receiving-42", status: "done", lessonKind: "task" }).map((section) => section.id)).toEqual(["supply-chain"]);
    expect(filterTutorialLibrarySections(collections, statuses, { query: "order", status: "in-progress" })).toEqual([]);
    expect(filterTutorialLibrarySections(collections, statuses, { status: "in-progress" })[0].shown).toEqual([astronomy]);
    expect(tutorialLibraryExportGroups(collections)).toEqual(collections.map(({ id, title, tutorials }) => ({ id, title, tutorials })));
  });

  it("counts lessons once and suggests unfinished progress ahead of new lessons, never completed progress", () => {
    const duplicate = [...collections, { id: "featured", title: "Featured", tutorials: [inventory] }];
    expect(tutorialsInSections(duplicate)).toEqual([inventory, astronomy]);
    const statuses = { [inventory.id]: { completedAt: 0, inProgressStep: 1 }, [astronomy.id]: { inProgressStep: 1 } };
    expect(tutorialStatusKind(statuses[inventory.id])).toBe("done");
    expect(tutorialLibrarySummary([inventory, inventory, astronomy], statuses)).toMatchObject({ total: 2, completedCount: 1, suggested: astronomy, inProgress: astronomy });
    expect(tutorialLibrarySummary([inventory], statuses).suggested).toBeNull();
  });
});

describe("library status source", () => {
  it("keys snapshots by actual IDs and invalidates through the host's same-document subscription", () => {
    let changed: (() => void) | undefined;
    const dispose = vi.fn();
    const completions: Record<string, { completedAt: number }> = { first: { completedAt: 17 } };
    const source = createTutorialLibraryStatusSource({
      readCompletions: () => completions,
      readProgress: (id) => id === "second" ? { stepIndex: 2 } : null,
      subscribe: (listener) => { changed = listener; return dispose; },
    });
    const notify = vi.fn();
    const stop = source.subscribe(notify);
    const first = source.getSnapshot(["first"]);
    expect(source.getSnapshot(["first"])).toBe(first);
    expect(source.getSnapshot(["second"])).toEqual({ second: { inProgressStep: 3 } });
    completions.second = { completedAt: 23 };
    changed?.();
    expect(notify).toHaveBeenCalledOnce();
    expect(source.getSnapshot(["second"])).toEqual({ second: { completedAt: 23, inProgressStep: 3 } });
    stop();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("updates mounted consumers on writes, catalog replacement and persistence-scope replacement", async () => {
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    const completions: Record<string, { completedAt: number }> = {};
    const first = createTutorialLibraryStatusSource({ readCompletions: () => completions, readProgress: () => null });
    const second = createTutorialLibraryStatusSource({ readCompletions: () => ({}), readProgress: () => null });
    function Consumer({ ids, source }: { ids: string[]; source: typeof first }) {
      const statuses = useTutorialLibraryStatuses(ids, source);
      return <output>{JSON.stringify(statuses)}</output>;
    }
    try {
      await act(async () => root.render(<Consumer ids={[inventory.id]} source={first} />));
      expect(host.textContent).toBe("{}");
      completions[inventory.id] = { completedAt: 42 };
      await act(async () => first.invalidate());
      expect(host.textContent).toContain('"completedAt":42');
      await act(async () => root.render(<Consumer ids={[astronomy.id]} source={first} />));
      expect(host.textContent).toBe("{}");
      await act(async () => root.render(<Consumer ids={[inventory.id]} source={second} />));
      expect(host.textContent).toBe("{}");
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
});

describe("library interface", () => {
  it("renders unrelated collections, metadata and callback launches without an application environment", async () => {
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    const launch = vi.fn();
    const ordered = { ...astronomy, prerequisites: [inventory.id] };
    try {
      await act(async () => root.render(<TutorialLibrary sections={[collections[0], { ...collections[1], tutorials: [ordered] }]} onLaunch={launch} layout="rows" showSectionNavigation showLessonTypeFilter={false} />));
      expect(host.textContent).toContain("Warehouse training");
      expect(host.textContent).toContain("Observatory training");
      expect(host.textContent).toContain("7 min");
      expect(host.textContent).toContain("Best after: Create an order");
      expect(host.querySelector('[data-testid="tutorial-setup"]')?.textContent).toContain("Create a purchase order");
      const row = host.querySelector(`[data-tutorial-card="${astronomy.id}"]`)!;
      const watch = Array.from(row.querySelectorAll("button")).find((button) => button.textContent === "Watch")!;
      await act(async () => watch.click());
      expect(launch).toHaveBeenCalledWith(ordered, "autoplay");
      const statusFilter = host.querySelector('[role="group"][aria-label="Filter tutorials by status"]')!;
      const done = Array.from(statusFilter.querySelectorAll("button")).find((button) => button.textContent?.startsWith("Completed"))!;
      await act(async () => done.click());
      expect(host.querySelectorAll("[data-tutorial-card]")).toHaveLength(0);
      expect(host.textContent).toContain("No tutorials match.");
      expect(host.querySelector('[aria-disabled="true"]')?.hasAttribute("href")).toBe(false);
    } finally { await act(async () => root.unmount()); host.remove(); }
  });

  it("keeps link routing and menu actions supplied by the consumer and uses completed-state labels", async () => {
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    const statuses = { [inventory.id]: { completedAt: 17, inProgressStep: 1 } };
    try {
      await act(async () => root.render(<>
        <TutorialLibraryProgress tutorials={[inventory, astronomy]} statuses={statuses} launchHref={(tutorial, mode) => `/academy/${tutorial.id}?mode=${mode}`} />
        <TutorialLibrary sections={collections} statuses={statuses} launchHref={(tutorial, mode) => `/academy/${tutorial.id}?mode=${mode}`} numberLessons
          renderMenu={(tutorial, notify) => <button type="button" onClick={() => notify(`Exported ${tutorial.title}`)}>Export</button>} />
      </>));
      const progress = host.querySelector("aside")!;
      expect(progress.querySelector("a")?.getAttribute("href")).toBe(`/academy/${astronomy.id}?mode=practice`);
      const card = host.querySelector(`[data-tutorial-card="${inventory.id}"]`)!;
      expect(card.textContent).toContain("Try again");
      expect(card.querySelector("a")?.getAttribute("href")).toBe(`/academy/${inventory.id}?mode=practice`);
      await act(async () => card.querySelector("button")!.click());
      expect(host.querySelector('[role="status"]')?.textContent).toBe("Exported Create an order");
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
});
