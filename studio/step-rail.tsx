"use client";

import clsx from "clsx";
import { TriangleAlert, GripVertical } from "lucide-react";
import { Tooltip } from "../ui/tooltip";
import { useState, type DragEvent } from "react";

import type { TutorialRecordingDraft } from "../recording";
import { stepChapterId } from "../recording";

import { chapterHue } from "./timeline";

/** Where a control sits in the fixture's viewport, each value 0..1. */
export interface AnchorRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A tiny map of the stage with the step's control drawn on it. */
function Minimap({ rect }: { rect: AnchorRect | undefined }) {
  return (
    <span
      aria-hidden
      className={clsx(
        "relative block h-5 w-8 shrink-0 overflow-hidden rounded-xs border",
        rect ? "border-slate-300 bg-slate-100 dark:border-slate-600 dark:bg-slate-800" : "border-dashed border-slate-300 bg-transparent dark:border-slate-600",
      )}
    >
      {rect ? (
        <span
          className="absolute rounded-[1px] bg-amber-500"
          style={{
            left: `${rect.x * 100}%`,
            top: `${rect.y * 100}%`,
            width: `${Math.max(rect.w * 100, 8)}%`,
            height: `${Math.max(rect.h * 100, 12)}%`,
          }}
        />
      ) : null}
    </span>
  );
}

/**
 * The compact step list beside the focused editor: every step in order,
 * grouped under its chapter, so an author can jump between steps without
 * scrolling past eight full editors. Each row carries a minimap of where its
 * control sits on the stage right now, a warning when it is not on screen,
 * and a grip to drag the step to a new position (it adopts the chapter of
 * the step it lands beside).
 */
export function StepRail({
  draft,
  selectedStepId,
  fixtureAnchors,
  anchorRects,
  onSelect,
  onReorder,
}: {
  draft: TutorialRecordingDraft;
  selectedStepId: string | null;
  fixtureAnchors: ReadonlySet<string>;
  anchorRects: ReadonlyMap<string, AnchorRect>;
  onSelect: (stepId: string) => void;
  onReorder: (stepId: string, toIndex: number) => void;
}) {
  const chapterIndex = new Map(draft.chapters.map((chapter, index) => [chapter.id, index]));
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const onDragOver = (event: DragEvent<HTMLLIElement>, index: number) => {
    if (!dragging) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const below = event.clientY > rect.top + rect.height / 2;
    setDropIndex(below ? index + 1 : index);
  };
  const onDrop = (event: DragEvent<HTMLLIElement>) => {
    event.preventDefault();
    if (dragging && dropIndex !== null) {
      const from = draft.steps.findIndex((step) => step.id === dragging);
      // Removing the dragged row first shifts later indices down by one.
      onReorder(dragging, dropIndex > from ? dropIndex - 1 : dropIndex);
    }
    setDragging(null);
    setDropIndex(null);
  };

  return (
    <ol
      aria-label="Steps"
      className="max-h-56 space-y-0.5 overflow-y-auto rounded-lg border border-slate-200 p-1 dark:border-slate-700"
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropIndex(null);
      }}
    >
      {draft.steps.map((step, index) => {
        const chapterId = stepChapterId(draft, step);
        const previous = draft.steps[index - 1];
        const heading = !previous || stepChapterId(draft, previous) !== chapterId;
        const chapter = draft.chapters.find((entry) => entry.id === chapterId);
        const selected = step.id === selectedStepId;
        const controlId = step.target ?? step.anchor;
        const offScreen = Boolean(controlId) && !fixtureAnchors.has(controlId!);
        return (
          <li
            key={step.id}
            draggable
            onDragStart={(event) => {
              setDragging(step.id);
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", step.id);
            }}
            onDragEnd={() => {
              setDragging(null);
              setDropIndex(null);
            }}
            onDragOver={(event) => onDragOver(event, index)}
            onDrop={onDrop}
            className={clsx(
              "relative",
              dropIndex === index && "before:absolute before:inset-x-1 before:-top-0.5 before:h-0.5 before:rounded-sm before:bg-brand-500",
              dropIndex === index + 1 && index === draft.steps.length - 1 && "after:absolute after:inset-x-1 after:-bottom-0.5 after:h-0.5 after:rounded-sm after:bg-brand-500",
              dragging === step.id && "opacity-40",
            )}
          >
            {heading && draft.chapters.length > 1 ? (
              <div className="mt-1 flex items-center gap-1.5 px-1.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <span className={clsx("inline-block h-2 w-2 rounded-xs", chapterHue(chapterIndex.get(chapterId) ?? 0))} aria-hidden />
                {chapter?.title || chapterId}
              </div>
            ) : null}
            <button
              type="button"
              aria-current={selected ? "step" : undefined}
              data-rail-step={step.id}
              onClick={() => onSelect(step.id)}
              className={clsx(
                "flex w-full items-center gap-2 rounded-sm px-1.5 py-1 text-left text-xs",
                selected
                  ? "bg-brand-50 text-brand-800 dark:bg-brand-950 dark:text-brand-100"
                  : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800",
              )}
            >
              <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-slate-300 dark:text-slate-600" aria-label="Drag to reorder" />
              <span className="w-5 shrink-0 text-right font-mono text-[11px] text-slate-400">{index + 1}</span>
              <Minimap rect={controlId ? anchorRects.get(controlId) : undefined} />
              <span className="truncate">{step.title || "Untitled step"}</span>
              <span className="ml-auto shrink-0 text-[10px] uppercase text-slate-400">{step.mode === "autoplay" ? "watch" : "try"}</span>
              {offScreen ? (
                <Tooltip content="Its control is not on the stage right now — expected for a step inside a dialog or menu that is closed. Preview from an earlier step to open it.">
                  <span className="inline-flex shrink-0">
                    <TriangleAlert className="h-3 w-3 text-amber-500" aria-label="Control not on screen right now" />
                  </span>
                </Tooltip>
              ) : null}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

