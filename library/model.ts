import type { TutorialManifest } from "../core/schema";

/** Ordered, application-owned collections; section IDs need not be manifest tracks. */
export interface TutorialLibrarySection {
  id: string;
  title: string;
  description?: string;
  tutorials: readonly TutorialManifest[];
}

export interface TutorialLibraryStatus {
  completedAt?: number;
  /** 1-based step reached by an interrupted run. */
  inProgressStep?: number;
}

export type TutorialLibraryStatuses = Readonly<Record<string, TutorialLibraryStatus>>;
export type TutorialLibraryStatusFilter = "all" | "todo" | "in-progress" | "done";

export const EMPTY_TUTORIAL_LIBRARY_STATUSES: TutorialLibraryStatuses = Object.freeze({});
export const TUTORIAL_LIBRARY_STATUS_FILTERS: ReadonlyArray<{ id: TutorialLibraryStatusFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "todo", label: "Not started" },
  { id: "in-progress", label: "In progress" },
  { id: "done", label: "Completed" },
];

export function tutorialStatusKind(status: TutorialLibraryStatus | undefined): Exclude<TutorialLibraryStatusFilter, "all"> {
  if (status?.completedAt !== undefined) return "done";
  if (status?.inProgressStep && status.inProgressStep > 0) return "in-progress";
  return "todo";
}

export function tutorialStepCount(tutorial: TutorialManifest): number {
  return tutorial.chapters.reduce((count, chapter) => count + chapter.steps.length, 0);
}

export function tutorialMatchesQuery(tutorial: TutorialManifest, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = [tutorial.title, tutorial.description, tutorial.id, tutorial.setup?.goal,
    ...(tutorial.setup?.audience ?? []), ...(tutorial.setup?.sources.flatMap((source) => source.articleIds) ?? [])]
    .filter(Boolean).join(" ").toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/** A repeated lesson can appear in several collections, but counts once in overall progress. */
export function tutorialsInSections(sections: readonly TutorialLibrarySection[]): TutorialManifest[] {
  return Array.from(new Map(sections.flatMap((section) => section.tutorials).map((tutorial) => [tutorial.id, tutorial])).values());
}

export function tutorialLibrarySummary(tutorials: readonly TutorialManifest[], statuses: TutorialLibraryStatuses) {
  const unique = Array.from(new Map(tutorials.map((tutorial) => [tutorial.id, tutorial])).values());
  const completedCount = unique.filter((tutorial) => tutorialStatusKind(statuses[tutorial.id]) === "done").length;
  // A retained progress record must not suggest a lesson that is already complete.
  const inProgress = unique.find((tutorial) => tutorialStatusKind(statuses[tutorial.id]) === "in-progress");
  const suggested = inProgress ?? unique.find((tutorial) => tutorialStatusKind(statuses[tutorial.id]) === "todo") ?? null;
  return { total: unique.length, completedCount, inProgress, suggested };
}

export function filterTutorialLibrarySections(
  sections: readonly TutorialLibrarySection[],
  statuses: TutorialLibraryStatuses,
  { status = "all", query = "", lessonKind = "all" }: {
    status?: TutorialLibraryStatusFilter;
    query?: string;
    lessonKind?: string;
  } = {},
) {
  return sections.map((section) => ({
    ...section,
    shown: section.tutorials.filter((tutorial) =>
      (status === "all" || tutorialStatusKind(statuses[tutorial.id]) === status)
      && (lessonKind === "all" || tutorial.setup?.kind === lessonKind)
      && tutorialMatchesQuery(tutorial, query)),
  })).filter((section) => section.shown.length > 0);
}

/** The same ordered sections can be handed to TutorialBulkExport by the consumer. */
export function tutorialLibraryExportGroups(sections: readonly TutorialLibrarySection[]) {
  return sections.map(({ id, title, tutorials }) => ({ id, title, tutorials }));
}
