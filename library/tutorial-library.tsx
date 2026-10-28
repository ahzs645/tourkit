"use client";

import { useId, useState, type ReactNode } from "react";
import type { TutorialManifest } from "../core/schema";
import { TUTORIAL_SETUP_KINDS } from "../components/tutorial-setup";
import { BuilderSelect } from "../ui/builder-select";
import { CONTROL_FOCUS } from "../ui/control-styles";
import { SearchInput } from "../ui/search-input";
import { TutorialLessonCard, TutorialLessonRow, type TutorialLibraryLaunch, type TutorialLibraryMenu } from "./lesson";
import { EMPTY_TUTORIAL_LIBRARY_STATUSES, TUTORIAL_LIBRARY_STATUS_FILTERS, filterTutorialLibrarySections, tutorialsInSections, tutorialStatusKind,
  type TutorialLibrarySection, type TutorialLibraryStatuses, type TutorialLibraryStatusFilter } from "./model";

export type TutorialLibraryProps = TutorialLibraryLaunch & {
  sections: readonly TutorialLibrarySection[];
  statuses?: TutorialLibraryStatuses;
  layout?: "cards" | "rows";
  showSearch?: boolean;
  searchLabel?: string;
  showLessonTypeFilter?: boolean;
  showSectionNavigation?: boolean;
  numberLessons?: boolean;
  prerequisitesOf?: (tutorial: TutorialManifest) => readonly string[];
  renderBadge?: (tutorial: TutorialManifest) => ReactNode;
  renderMenu?: TutorialLibraryMenu;
  onNotice?: (message: string) => void;
  emptyMessage?: string;
  noMatchesMessage?: string;
  /** Set this when the host has existing section deep links; otherwise each library has unique IDs. */
  sectionAnchorPrefix?: string;
  getSectionTestId?: (section: TutorialLibrarySection) => string;
};

/** Published-lesson browsing. Catalogs, routes, storage and export menus are supplied by the host. */
export function TutorialLibrary({
  sections, statuses = EMPTY_TUTORIAL_LIBRARY_STATUSES, layout = "cards", showSearch = true, searchLabel = "Search tutorials",
  showLessonTypeFilter = true, showSectionNavigation = layout === "rows", numberLessons = false, prerequisitesOf,
  renderBadge, renderMenu, onNotice, emptyMessage = "There are no tutorials yet.", noMatchesMessage = "No tutorials match.",
  sectionAnchorPrefix, getSectionTestId, ...launch
}: TutorialLibraryProps) {
  const instanceId = useId();
  const prefix = sectionAnchorPrefix ?? `tutorial-library-${instanceId}`;
  const [status, setStatus] = useState<TutorialLibraryStatusFilter>("all");
  const [query, setQuery] = useState("");
  const [lessonKind, setLessonKind] = useState("all");
  const [notice, setNotice] = useState<string | null>(null);
  const all = tutorialsInSections(sections);
  const shown = filterTutorialLibrarySections(sections, statuses, { status, query: showSearch ? query : "", lessonKind: showLessonTypeFilter ? lessonKind : "all" });
  const titles = new Map(all.map((tutorial) => [tutorial.id, tutorial.title]));
  const positions = new Map(all.map((tutorial, index) => [tutorial.id, index + 1]));
  const reportNotice = (message: string) => { setNotice(message); onNotice?.(message); };
  const sectionLinks = (
    <ul className="mt-2 flex flex-col gap-0.5">
      {sections.map((section) => {
        const match = shown.find((entry) => entry.id === section.id);
        const done = section.tutorials.filter((tutorial) => tutorialStatusKind(statuses[tutorial.id]) === "done").length;
        return (
          <li key={section.id}>
            <a href={match ? `#${prefix}-${section.id}` : undefined} aria-disabled={!match}
              className={`flex items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-sm ${CONTROL_FOCUS} ${match ? "text-slate-700 hover:bg-white dark:text-slate-200 dark:hover:bg-slate-900" : "text-slate-400 dark:text-slate-600"}`}>
              <span className="min-w-0 leading-5">{section.title}</span>
              <span className="shrink-0 text-xs tabular-nums text-slate-500">{match && match.shown.length !== section.tutorials.length ? `${match.shown.length}/${section.tutorials.length}` : done > 0 ? `${done}/${section.tutorials.length}` : section.tutorials.length}</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
  const filters = (
    <>
      {showSearch ? <SearchInput aria-label={searchLabel} placeholder="Search tutorials" value={query} onChange={(event) => setQuery(event.target.value)} onClear={() => setQuery("")} /> : null}
      {showLessonTypeFilter ? <BuilderSelect aria-label="Filter tutorials by lesson type" value={lessonKind} onChange={setLessonKind}
        options={[{ value: "all", label: "All lesson types" }, ...Object.entries(TUTORIAL_SETUP_KINDS).map(([value, label]) => ({ value, label }))]} /> : null}
      <div role="group" aria-label="Filter tutorials by status" className="flex flex-wrap gap-1.5">
        {TUTORIAL_LIBRARY_STATUS_FILTERS.map((option) => {
          const active = option.id === status;
          const count = option.id === "all" ? all.length : all.filter((tutorial) => tutorialStatusKind(statuses[tutorial.id]) === option.id).length;
          return <button key={option.id} type="button" aria-pressed={active} onClick={() => setStatus(option.id)}
            className={`${CONTROL_FOCUS} ${active ? "rounded-full bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white dark:bg-white dark:text-slate-900" : "rounded-full border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-white dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"}`}>
            {option.label} <span className="opacity-60">{count}</span>
          </button>;
        })}
      </div>
      {showSectionNavigation && sections.length > 1 ? (
        <nav aria-label="Sections">
          <details className="rounded-xl border border-slate-200 bg-white px-3 py-2 md:hidden dark:border-slate-800 dark:bg-slate-900"><summary className="cursor-pointer text-sm font-semibold">Jump to a section ({sections.length})</summary>{sectionLinks}</details>
          <div className="hidden md:block"><h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sections</h2>{sectionLinks}</div>
        </nav>
      ) : null}
    </>
  );

  if (all.length === 0) return <p className="mt-10 text-sm text-slate-500">{emptyMessage}</p>;
  return (
    <div className="mt-8">
      {notice ? <p role="status" className="mb-4 text-sm text-slate-600 dark:text-slate-300">{notice}</p> : null}
      <div className={showSectionNavigation ? "grid gap-8 md:grid-cols-[16rem_minmax(0,1fr)]" : "space-y-8"}>
        <aside aria-label="Tutorial filters" className={showSectionNavigation ? "flex flex-col gap-4 md:sticky md:top-6 md:max-h-[calc(100vh-3rem)] md:self-start md:overflow-y-auto md:pb-2" : "flex flex-wrap items-center gap-4"}>{filters}</aside>
        <div className="min-w-0">
          {shown.length === 0 ? <p className="text-sm text-slate-500">{noMatchesMessage}</p> : null}
          {shown.map((section) => {
            const done = section.tutorials.filter((tutorial) => tutorialStatusKind(statuses[tutorial.id]) === "done").length;
            const Lesson = layout === "rows" ? TutorialLessonRow : TutorialLessonCard;
            const lessons = section.shown.map((tutorial) => (
              <Lesson key={tutorial.id} {...launch} tutorial={tutorial} status={statuses[tutorial.id]} renderMenu={renderMenu} onNotice={reportNotice}
                prerequisites={prerequisitesOf ? prerequisitesOf(tutorial) : tutorial.prerequisites.map((id) => titles.get(id) ?? id)}
                badge={renderBadge ? renderBadge(tutorial) : numberLessons ? <span aria-label={`Step ${positions.get(tutorial.id)} of the learning path`} className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{positions.get(tutorial.id)}</span> : null} />
            ));
            return (
              <section key={section.id} id={`${prefix}-${section.id}`} aria-labelledby={`${prefix}-title-${section.id}`} data-testid={getSectionTestId?.(section)} className="mb-10 scroll-mt-6">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"><h2 id={`${prefix}-title-${section.id}`} className="text-lg font-semibold tracking-tight">{section.title}</h2><span className="text-xs font-medium text-slate-500">{done} of {section.tutorials.length} completed</span></div>
                {section.description ? <p className="mt-1 max-w-2xl text-sm text-slate-600 dark:text-slate-300">{section.description}</p> : null}
                {layout === "rows" ? <ol className="mt-4 divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">{lessons}</ol> : <div className="mt-4 grid gap-4 md:grid-cols-2">{lessons}</div>}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
