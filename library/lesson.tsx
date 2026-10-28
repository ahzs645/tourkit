"use client";

import type { ReactNode } from "react";
import { CircleCheck, Clock3, Play } from "lucide-react";
import type { TutorialManifest, TutorialMode } from "../core/schema";
import { TutorialSetupDetails } from "../components/tutorial-setup";
import { CONTROL_FOCUS } from "../ui/control-styles";
import { tutorialStatusKind, tutorialStepCount, type TutorialLibraryStatus } from "./model";

export type TutorialLibraryLaunch = {
  launchHref: (tutorial: TutorialManifest, mode: TutorialMode) => string;
  onLaunch?: never;
} | {
  launchHref?: never;
  onLaunch: (tutorial: TutorialManifest, mode: TutorialMode) => void;
};

export type TutorialLibraryMenu = (tutorial: TutorialManifest, onNotice: (message: string) => void) => ReactNode;
export type TutorialLessonProps = TutorialLibraryLaunch & {
  tutorial: TutorialManifest;
  status?: TutorialLibraryStatus;
  badge?: ReactNode;
  prerequisites?: readonly string[];
  renderMenu?: TutorialLibraryMenu;
  onNotice?: (message: string) => void;
};

const LEVEL_LABEL = { beginner: "Beginner", intermediate: "Intermediate" };
const ignoreNotice = () => {};

export function TutorialLaunchControl({ tutorial, mode, children, className, ...launch }: TutorialLibraryLaunch & {
  tutorial: TutorialManifest;
  mode: TutorialMode;
  children: ReactNode;
  className?: string;
}) {
  const classes = `${className ?? ""} ${CONTROL_FOCUS}`;
  return launch.launchHref
    ? <a href={launch.launchHref(tutorial, mode)} className={classes}>{children}</a>
    : <button type="button" className={classes} onClick={() => launch.onLaunch(tutorial, mode)}>{children}</button>;
}

function LessonStatus({ tutorial, status }: Pick<TutorialLessonProps, "tutorial" | "status">) {
  const kind = tutorialStatusKind(status);
  if (kind === "done") return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200">
      <CircleCheck className="h-3.5 w-3.5" aria-hidden="true" />Completed
    </span>
  );
  if (kind === "in-progress") return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">
      Step {Math.min(status!.inProgressStep!, tutorialStepCount(tutorial))} of {tutorialStepCount(tutorial)}
    </span>
  );
  return null;
}

function LessonLaunches({ tutorial, status, compact = false, ...launch }: TutorialLibraryLaunch & {
  tutorial: TutorialManifest;
  status?: TutorialLibraryStatus;
  compact?: boolean;
}) {
  const kind = tutorialStatusKind(status);
  const spacing = compact ? "px-3 py-1.5" : "px-4 py-2";
  return <>
    <TutorialLaunchControl {...launch} tutorial={tutorial} mode="practice" className={`rounded-lg bg-sky-600 ${spacing} text-sm font-semibold text-white hover:bg-sky-700`}>
      {kind === "done" ? "Try again" : kind === "in-progress" ? "Continue" : "Try it"}
    </TutorialLaunchControl>
    <TutorialLaunchControl {...launch} tutorial={tutorial} mode="autoplay" className={`inline-flex items-center gap-1.5 rounded-lg border border-slate-300 ${spacing} text-sm font-semibold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800`}>
      <Play className="h-3.5 w-3.5" aria-hidden="true" />Watch
    </TutorialLaunchControl>
  </>;
}

export function TutorialLessonCard({ tutorial, status, badge, prerequisites = [], renderMenu, onNotice = ignoreNotice, ...launch }: TutorialLessonProps) {
  return (
    <article data-tutorial-card={tutorial.id} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">{badge}<h3 className="text-base font-semibold leading-6">{tutorial.title}</h3></div>
        <div className="flex shrink-0 items-center gap-1"><LessonStatus tutorial={tutorial} status={status} />{renderMenu?.(tutorial, onNotice)}</div>
      </div>
      {tutorial.description ? <p className="mt-3 flex-1 text-sm leading-6 text-slate-600 dark:text-slate-300">{tutorial.description}</p> : null}
      <TutorialSetupDetails setup={tutorial.setup} />
      <dl className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-medium text-slate-500">
        <div className="inline-flex items-center gap-1"><dt className="sr-only">Estimated time</dt><Clock3 className="h-3.5 w-3.5" aria-hidden="true" /><dd>{tutorial.estimatedMinutes} min</dd></div>
        <div><dt className="sr-only">Level</dt><dd>{LEVEL_LABEL[tutorial.level]}</dd></div>
        <div><dt className="sr-only">Length</dt><dd>{tutorial.chapters.length} chapter{tutorial.chapters.length === 1 ? "" : "s"} · {tutorialStepCount(tutorial)} steps</dd></div>
      </dl>
      {prerequisites.length > 0 ? <p className="mt-2 text-xs text-slate-500">Best after: {prerequisites.join(", ")}</p> : null}
      <div className="mt-5 flex gap-2"><LessonLaunches {...launch} tutorial={tutorial} status={status} /></div>
    </article>
  );
}

export function TutorialLessonRow({ tutorial, status, badge, prerequisites = [], renderMenu, onNotice = ignoreNotice, ...launch }: TutorialLessonProps) {
  return (
    <li data-tutorial-card={tutorial.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">{badge}<h3 className="text-sm font-semibold leading-6">{tutorial.title}</h3><LessonStatus tutorial={tutorial} status={status} /></div>
        {tutorial.description ? <p className="mt-0.5 line-clamp-2 text-sm text-slate-600 dark:text-slate-300">{tutorial.description}</p> : null}
        <TutorialSetupDetails setup={tutorial.setup} />
        <p className="mt-1 inline-flex flex-wrap items-center gap-3 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" aria-hidden="true" />{tutorial.estimatedMinutes} min</span>
          <span>{LEVEL_LABEL[tutorial.level]}</span><span>{tutorialStepCount(tutorial)} steps</span>
        </p>
        {prerequisites.length > 0 ? <p className="mt-2 text-xs text-slate-500">Best after: {prerequisites.join(", ")}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2"><LessonLaunches {...launch} tutorial={tutorial} status={status} compact />{renderMenu?.(tutorial, onNotice)}</div>
    </li>
  );
}
