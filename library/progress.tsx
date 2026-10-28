"use client";

import { CircleCheck } from "lucide-react";
import type { TutorialManifest } from "../core/schema";
import { TutorialLaunchControl, type TutorialLibraryLaunch } from "./lesson";
import { tutorialLibrarySummary, type TutorialLibraryStatuses } from "./model";

export type TutorialLibraryProgressProps = TutorialLibraryLaunch & {
  tutorials: readonly TutorialManifest[];
  statuses: TutorialLibraryStatuses;
  variant?: "card" | "compact";
  label?: string;
  startLabel?: string;
};

export function TutorialLibraryProgress({ tutorials, statuses, variant = "card", label = "Learning progress", startLabel = "Start", ...launch }: TutorialLibraryProgressProps) {
  const { total, completedCount, inProgress, suggested } = tutorialLibrarySummary(tutorials, statuses);
  const progress = (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={total || 1} aria-valuenow={completedCount}
      className={variant === "card" ? "mt-3 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800" : "h-1.5 w-32 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"}>
      <div className="h-full rounded-full bg-emerald-500 transition-[width]" style={{ width: `${total ? completedCount / total * 100 : 0}%` }} />
    </div>
  );
  if (variant === "compact") return (
    <div className="mt-2 flex flex-wrap items-center justify-between gap-4" aria-label={label}>
      <div className="flex items-center gap-3 text-sm text-slate-500"><span>{completedCount} of {total} completed</span>{progress}</div>
      {suggested ? <TutorialLaunchControl {...launch} tutorial={suggested} mode="practice" className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700">{inProgress ? "Continue" : completedCount ? "Next lesson" : startLabel}</TutorialLaunchControl> : null}
    </div>
  );
  return (
    <aside aria-label={label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Your progress</p>
      <p className="mt-2 text-2xl font-semibold">{completedCount}<span className="text-base font-normal text-slate-500"> of {total} completed</span></p>
      {progress}
      {suggested ? (
        <TutorialLaunchControl {...launch} tutorial={suggested} mode="practice" className="mt-4 flex w-full items-center justify-center rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700">
          {inProgress ? `Continue: ${suggested.title}` : completedCount ? `Next: ${suggested.title}` : startLabel}
        </TutorialLaunchControl>
      ) : total > 0 ? <p className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-300"><CircleCheck className="h-4 w-4" aria-hidden="true" />You have finished every tutorial.</p> : null}
    </aside>
  );
}
