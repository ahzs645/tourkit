"use client";

import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { CONTROL_FOCUS } from "../ui/control-styles";
import { cn } from "../shared/cn";
import { useTutorialStudioEnvironment } from "../studio/environment";

export interface TutorialHubView { id: string; label: string }
export interface TutorialHubLink { label: string; href: string; icon?: ReactNode }

/**
 * The tutorial pages' two-tier bar: application areas on top,
 * then the current area's name and its views.
 * Areas are links between pages; views switch the panel below in place.
 */
export function TutorialHubNav({ area, showEmulators = true, context, views = [], view, onViewChange, links = [], trailing }: {
  /** An application area id, or null on a page outside every area. */
  area: string | null;
  showEmulators?: boolean;
  context: string;
  views?: readonly TutorialHubView[];
  view?: string;
  onViewChange?: (view: string) => void;
  /** Sub-tab-styled links that leave the page, such as opening a stage. */
  links?: readonly TutorialHubLink[];
  trailing?: ReactNode;
}) {
  const environment = useTutorialStudioEnvironment();
  const currentIsStage = environment.hubAreas.some((entry) => entry.id === area && entry.stage);
  const areas = environment.hubAreas.filter((entry) => !entry.stage || showEmulators || currentIsStage)
    .map((entry) => ({ ...entry, href: environment.resolvePath(entry.href) }));
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = event.key === "ArrowRight" ? index + 1 : event.key === "ArrowLeft" ? index - 1 : event.key === "Home" ? 0 : event.key === "End" ? views.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    const target = views[(next + views.length) % views.length];
    onViewChange?.(target.id);
    event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-view="${target.id}"]`)?.focus();
  };
  return <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
    <div className="mx-auto flex max-w-6xl items-center gap-2 px-3 sm:px-5">
      <nav aria-label="Tutorial areas" className="-mb-px flex min-w-0 flex-1 overflow-x-auto overflow-y-hidden scrollbar-hidden">
        {areas.map((entry) => {
          const active = entry.id === area;
          return <a key={entry.id} href={entry.href} aria-current={active ? "page" : undefined} data-testid={`tutorial-area:${entry.id}`}
            className={cn(CONTROL_FOCUS, "relative shrink-0 whitespace-nowrap px-3.5 py-3.5 text-sm font-medium transition-colors",
              active ? "text-slate-900 dark:text-white" : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white")}>
            {entry.label}
            {active ? <span aria-hidden="true" className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-sky-500 dark:bg-sky-400" /> : null}
          </a>;
        })}
      </nav>
      <div className="flex shrink-0 items-center gap-1">
        {trailing}
        {environment.homeLink && <a href={environment.resolvePath(environment.homeLink.href)} className={cn(CONTROL_FOCUS, "rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white")}>
          {environment.homeLink.label}
        </a>}
      </div>
    </div>
    <div className="border-t border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/60">
      <div className="mx-auto flex max-w-6xl items-stretch overflow-x-auto overflow-y-hidden scrollbar-hidden px-3 sm:px-5">
        <span className="flex shrink-0 items-center whitespace-nowrap py-3 pl-3 pr-4 text-sm font-semibold text-slate-900 dark:text-white">{context}</span>
        {views.length ? <div role="tablist" aria-label={`${context} views`} className="-mb-px flex">
          {views.map((entry, index) => {
            const active = entry.id === view;
            return <button key={entry.id} type="button" role="tab" id={`tutorial-view-tab-${entry.id}`} aria-selected={active} aria-controls="tutorial-view-panel"
              tabIndex={active ? 0 : -1} data-view={entry.id} onClick={() => onViewChange?.(entry.id)} onKeyDown={(event) => onTabKey(event, index)}
              className={cn(CONTROL_FOCUS, "relative shrink-0 whitespace-nowrap px-4 py-3 text-sm font-medium transition-colors",
                active ? "bg-white text-slate-900 dark:bg-slate-800/70 dark:text-white" : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white")}>
              {entry.label}
              {active ? <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-0.5 bg-sky-500 dark:bg-sky-400" /> : null}
            </button>;
          })}
        </div> : null}
        {links.map((link) => <a key={link.href} href={link.href}
          className={cn(CONTROL_FOCUS, "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap px-4 py-3 text-sm font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white")}>
          {link.icon}{link.label}<ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
        </a>)}
      </div>
    </div>
  </header>;
}

/** The selected view, kept in `?view=` so a reload or shared link opens the same one. */
export function useTutorialHubView<T extends string>(views: readonly T[], fallback: T): [T, (view: string) => void] {
  const [view, setView] = useState<T>(fallback);
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("view");
    if (requested && (views as readonly string[]).includes(requested)) setView(requested as T);
  }, [views]);
  const select = (next: string) => {
    if (!(views as readonly string[]).includes(next)) return;
    setView(next as T);
    const url = new URL(window.location.href);
    if (next === fallback) url.searchParams.delete("view"); else url.searchParams.set("view", next);
    window.history.replaceState(window.history.state, "", url);
  };
  return [view, select];
}

