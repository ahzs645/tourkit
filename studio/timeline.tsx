"use client";

import clsx from "clsx";
import type { ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

import { CONTROL_FOCUS } from "../ui/control-styles";

import type { TutorialRecordingDraft, TutorialRecordingStep } from "../recording";
import { stepChapterId } from "../recording";

/** One hue per chapter, cycling; enough to tell neighbours apart. */
const CHAPTER_HUES = [
  "bg-sky-200 text-sky-900 dark:bg-sky-500/30 dark:text-sky-100",
  "bg-violet-200 text-violet-900 dark:bg-violet-500/30 dark:text-violet-100",
  "bg-emerald-200 text-emerald-900 dark:bg-emerald-500/30 dark:text-emerald-100",
  "bg-amber-200 text-amber-900 dark:bg-amber-500/30 dark:text-amber-100",
  "bg-rose-200 text-rose-900 dark:bg-rose-500/30 dark:text-rose-100",
];

export function chapterHue(index: number): string {
  return CHAPTER_HUES[index % CHAPTER_HUES.length];
}

/** Each step's span on the timeline: from its own time to the next step's. */
export function stepSpans(draft: TutorialRecordingDraft): Array<{ step: TutorialRecordingStep; startMs: number; durationMs: number }> {
  const steps = draft.steps;
  const total = Math.max(draft.durationMs, steps.length ? steps[steps.length - 1].atMs + 1_000 : 0);
  return steps.map((step, index) => {
    const startMs = step.narration?.startMs ?? step.atMs;
    const endMs = step.narration?.endMs ?? steps[index + 1]?.atMs ?? total;
    return { step, startMs, durationMs: Math.max(250, endMs - startMs) };
  });
}

/**
 * The filmstrip under the stage: one block per step, sized by how long it
 * lasted in the recording, coloured by chapter, with the narration playhead
 * drawn across it while audio plays. Click a block to focus that step.
 */
export function Timeline({
  draft,
  selectedStepId,
  playheadMs,
  onSelect,
  collapsed = false,
  onCollapsedChange,
  trailing,
}: {
  draft: TutorialRecordingDraft;
  selectedStepId: string | null;
  /** Narration position in ms while the audio plays; undefined hides the playhead. */
  playheadMs?: number;
  onSelect: (stepId: string) => void;
  /** Folds the strip to its header line, giving the stage the height. */
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  /** Stage controls shown at the end of the header line (the studio's zoom). */
  trailing?: ReactNode;
}) {
  const spans = stepSpans(draft);
  const total = spans.reduce((sum, span) => sum + span.durationMs, 0);
  const chapterIndex = new Map(draft.chapters.map((chapter, index) => [chapter.id, index]));
  const playhead =
    playheadMs !== undefined && total > 0 && draft.audio
      ? Math.min(100, Math.max(0, (playheadMs / Math.max(draft.durationMs, 1)) * 100))
      : null;

  return (
    <div
      className={clsx("border-t border-slate-200 bg-white px-3 dark:border-slate-700 dark:bg-slate-900", collapsed ? "py-1" : "py-2")}
      data-testid="tutorial-timeline"
    >
      <div className={clsx("flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500", !collapsed && "mb-1")}>
        {onCollapsedChange ? (
          <button
            type="button"
            aria-expanded={!collapsed}
            onClick={() => onCollapsedChange(!collapsed)}
            title={collapsed ? "Show the timeline" : "Fold the timeline to give the stage more height"}
            className={clsx(
              "inline-flex items-center gap-1 rounded-sm font-semibold text-slate-700 hover:text-slate-900 dark:text-slate-200 dark:hover:text-white",
              CONTROL_FOCUS
            )}
          >
            {collapsed ? <ChevronUp className="h-3.5 w-3.5" aria-hidden /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden />}
            Timeline
            {collapsed && spans.length ? <span className="font-normal text-slate-500">· {spans.length} steps</span> : null}
          </button>
        ) : (
          <span className="font-semibold text-slate-700 dark:text-slate-200">Timeline</span>
        )}
        {draft.chapters.map((chapter, index) => (
          <span key={chapter.id} className="inline-flex items-center gap-1">
            <span className={clsx("inline-block h-2.5 w-2.5 rounded-xs", chapterHue(index))} aria-hidden />
            {chapter.title || chapter.id}
          </span>
        ))}
        <span className="ml-auto font-mono">{formatClock(draft.durationMs)}</span>
        {trailing}
      </div>
      {collapsed ? null : spans.length === 0 ? (
        <div className="h-10 rounded-sm border border-dashed border-slate-300 text-center text-[11px] leading-10 text-slate-400 dark:border-slate-600">
          Steps appear here as you record or add them.
        </div>
      ) : (
        <div className="relative">
          <div role="listbox" aria-label="Steps on the timeline" aria-orientation="horizontal" className="flex h-10 w-full gap-0.5 overflow-x-auto"
            onKeyDown={(event) => {
              if (event.metaKey || event.ctrlKey || event.altKey || !spans.length) return;
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const focusedId = (event.target as HTMLElement).closest<HTMLElement>("[data-timeline-step]")?.dataset.timelineStep;
              const index = Math.max(0, spans.findIndex(({ step }) => step.id === (focusedId ?? selectedStepId)));
              const next = event.key === "Home" ? 0 : event.key === "End" ? spans.length - 1
                : Math.max(0, Math.min(spans.length - 1, index + (event.key === "ArrowRight" ? 1 : -1)));
              onSelect(spans[next].step.id);
              event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-timeline-step]")[next]?.focus();
            }}>
            {spans.map(({ step, durationMs }, index) => {
              const selected = step.id === selectedStepId;
              const hue = chapterHue(chapterIndex.get(stepChapterId(draft, step)) ?? 0);
              return (
                <button
                  key={step.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  title={`${index + 1}. ${step.title}`}
                  data-timeline-step={step.id}
                  onClick={() => onSelect(step.id)}
                  style={{ flex: `${durationMs} 0 0`, minWidth: 28 }}
                  className={clsx(
                    "flex h-full items-center overflow-hidden rounded-sm px-1.5 text-left text-[11px] font-semibold transition-shadow",
                    hue,
                    selected ? "ring-2 ring-brand-600 ring-offset-1 dark:ring-brand-400 dark:ring-offset-slate-900" : "hover:brightness-95",
                  )}
                >
                  <span className="mr-1 shrink-0 opacity-70">{index + 1}</span>
                  <span className="truncate">{step.title}</span>
                </button>
              );
            })}
          </div>
          {playhead !== null ? (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 w-0.5 bg-rose-500"
              style={{ left: `${playhead}%` }}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

function formatClock(ms: number): string {
  const seconds = Math.max(0, ms) / 1_000;
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

