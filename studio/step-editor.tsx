"use client";
import { useTutorialStudioEnvironment } from "./environment";

import { BuilderSelect } from "../ui/builder-select";
import { ArrowDown, ArrowUp, CopyPlus, Crosshair, Plus, Scissors, Trash } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import SuggestInput from "../ui/suggest-input";
import { Textarea } from "../ui/textarea";
import { StepFocusHighlights, type FocusPickRequest } from "./step-focus-highlights";
import { StepViewContext } from "./step-view-context";
import type { TutorialViewState } from "../core/view-context";
import { StepScreenshot } from "./step-screenshot";
import { ContentTemplateTools } from "./content-template-tools";
import { isTutorialGuideBlock, TUTORIAL_CONTENT_KINDS } from "../recording/content-blocks";
import {
  TutorialCheckSchema,
  TutorialSemanticActionSchema,
  type TutorialCardSize,
  type TutorialCheck,
  type TutorialCheckClause,
  type TutorialSemanticAction,
  type TutorialValue
} from "../core/schema";
import type {
  TutorialCheckSuggestion,
  TutorialRecordingCardOverride,
  TutorialRecordingChapter,
  TutorialRecordingStep
} from "../recording";

/** Select value meaning "no override; inherit the tutorial's setting". */
const INHERIT = "";

export const CARD_PLACEMENTS = [
  { value: "attached", label: "Attached to the control" },
  { value: "docked", label: "Docked bottom-right" },
  { value: "center", label: "Centered" }
];
export const CARD_SIZES = [
  { value: "compact", label: "Compact" },
  { value: "default", label: "Default" },
  { value: "large", label: "Large" }
];
const ANCHOR_PLACEMENTS = ["auto", "top", "right", "bottom", "left", "center"].map((value) => ({
  value,
  label: value[0].toUpperCase() + value.slice(1)
}));
const ANCHOR_ALIGNMENTS = [
  { value: "center", label: "Centred on the control" },
  { value: "start", label: "Start edge" },
  { value: "end", label: "End edge" }
];

function withInherit(options: ReadonlyArray<{ value: string; label: string }>) {
  return [{ value: INHERIT, label: "Inherit" }, ...options];
}

export function StepEditor({
  step,
  index,
  count,
  chapters,
  chapterId,
  suggestion,
  liveView,
  onGoToView,
  anchorOnScreen,
  paths,
  picking,
  onPick,
  onPickFocus,
  pickingFocus,
  onCaptureScreenshot,
  onCaptureStep,
  expectedFingerprint,
  screenshotDisabled,
  onChange,
  onMove,
  onSplit,
  onInsertAfter,
  onDuplicate,
  onDelete
}: {
  step: TutorialRecordingStep;
  index: number;
  count: number;
  chapters: readonly TutorialRecordingChapter[];
  chapterId: string;
  suggestion: TutorialCheckSuggestion;
  /** Whether the typed anchor currently resolves in the fixture frame. */
  liveView?: TutorialViewState;
  onGoToView?: () => void;
  anchorOnScreen: boolean;
  /** Snapshot paths the stage exposes, offered as suggestions in the check editor. */
  paths: readonly string[];
  picking: boolean;
  onPick: () => void;
  onPickFocus?: (request: FocusPickRequest | null) => void;
  pickingFocus?: boolean;
  onCaptureScreenshot?: () => Promise<void>;
  onCaptureStep?: () => Promise<void>;
  expectedFingerprint?: string;
  screenshotDisabled?: boolean;
  onChange: (patch: Partial<Omit<TutorialRecordingStep, "id">>) => void;
  onMove: (direction: -1 | 1) => void;
  onSplit: () => void;
  onInsertAfter: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const card: TutorialRecordingCardOverride = step.card ?? {};
  const setCard = (patch: TutorialRecordingCardOverride) => {
    const next = { ...card, ...patch };
    const cleaned = Object.fromEntries(Object.entries(next).filter(([, value]) => value !== undefined));
    onChange({ card: Object.keys(cleaned).length ? cleaned : undefined });
  };
  return (
    <article className="rounded-lg border border-slate-200 p-3 dark:border-slate-700" data-step-id={step.id}>
      <div className="mb-3 flex items-center gap-2">
        <span className="rounded-sm bg-brand-50 px-2 py-1 text-xs font-bold text-brand-700 dark:bg-brand-950 dark:text-brand-200">{index + 1}</span>
        <span className="font-mono text-xs text-slate-500">{formatTime(step.atMs)}</span>
        <div className="ml-auto flex gap-1">
          <IconButton label="Move up" disabled={index === 0} onClick={() => onMove(-1)}><ArrowUp className="h-3.5 w-3.5" /></IconButton>
          <IconButton label="Move down" disabled={index === count - 1} onClick={() => onMove(1)}><ArrowDown className="h-3.5 w-3.5" /></IconButton>
          <IconButton label="Insert step after" onClick={onInsertAfter}><Plus className="h-3.5 w-3.5" /></IconButton>
          <IconButton label="Duplicate step" onClick={onDuplicate}><CopyPlus className="h-3.5 w-3.5" /></IconButton>
          <IconButton label="Split step" onClick={onSplit}><Scissors className="h-3.5 w-3.5" /></IconButton>
          <IconButton label="Delete step" onClick={onDelete}><Trash className="h-3.5 w-3.5" /></IconButton>
        </div>
      </div>
      <div className="space-y-2">
        <Field label="Content type">
          <BuilderSelect aria-label={`Step ${index + 1} content type`} value={step.contentKind ?? "action"}
            options={TUTORIAL_CONTENT_KINDS} onChange={(value) => {
              const kind = TUTORIAL_CONTENT_KINDS.find((item) => item.value === value)!;
              onChange({ contentKind: kind.value === "action" ? undefined : kind.value,
                ...(step.title === "New step" ? { title: kind.title, instruction: kind.instruction } : {}),
                ...(kind.value !== "action" && !step.action && !step.check && !step.screenshot ? { screenshotMode: "none" as const } : {}) });
            }} />
        </Field>
        <Field label="Step completion">
          <BuilderSelect aria-label={`Step ${index + 1} completion`} value={step.completion ?? "outcome"}
            options={[{ value: "continue", label: "Continue after reading" }, { value: "outcome", label: "Complete an action" }]}
            onChange={(value) => onChange({ completion: value === "continue" ? "continue" : undefined })} />
        </Field>
        {step.completion === "continue" && <p className="text-xs text-slate-500">Try it waits for Next or Finish after the explanation. Watch reads this step before moving on.</p>}
        {isTutorialGuideBlock(step) && <p className="text-xs text-slate-500">This explanation appears in reading guides. Choose Continue after reading to include it in Watch and Try it, or add an action or outcome check below.</p>}
        <Input aria-label={`Step ${index + 1} title`} value={step.title} onChange={(event) => onChange({ title: event.target.value })} />
        <Textarea aria-label={`Step ${index + 1} instruction`} rows={2} value={step.instruction} onChange={(event) => onChange({ instruction: event.target.value })} />
        <StepViewContext step={step} index={index} liveView={liveView} onChange={onChange} onGoToView={onGoToView} />
        {onCaptureScreenshot && <StepScreenshot screenshot={step.screenshot} screenshotMode={step.screenshotMode}
          onScreenshotModeChange={(screenshotMode) => onChange({ screenshotMode })} onCapture={onCaptureScreenshot}
          onCaptureStep={onCaptureStep} expectedFingerprint={expectedFingerprint}
          disabled={screenshotDisabled} onChange={(screenshot) => onChange({ screenshot })} />}
        <div className="grid grid-cols-2 gap-2">
          <div className="flex gap-1">
            <Input aria-label={`Step ${index + 1} anchor`} placeholder="data-tutorial-id" value={step.anchor ?? ""} onChange={(event) => onChange({ anchor: event.target.value || undefined })} />
            <Button
              size="sm"
              variant={picking ? "primary" : "ghost"}
              aria-label={`Pick step ${index + 1} anchor from the fixture`}
              aria-pressed={picking}
              onClick={onPick}
              leftIcon={<Crosshair className="h-3.5 w-3.5" />}
            >
              {picking ? "Picking…" : "Pick"}
            </Button>
          </div>
          <BuilderSelect
            aria-label={`Step ${index + 1} mode`}
            value={step.mode}
            onChange={(nextValue) => onChange({ mode: nextValue as "autoplay" | "practice" })}
            controlClassName="h-8 text-xs"
            options={[{ value: "autoplay", label: "Autoplay" }, { value: "practice", label: "Wait for user" }]}
          />
        </div>
        {chapters.length > 1 ? (
          <Field label="Chapter">
            <BuilderSelect
              aria-label={`Step ${index + 1} chapter`}
              value={chapterId}
              onChange={(nextValue) => onChange({ chapterId: nextValue })}
              controlClassName="h-8 text-xs"
              options={chapters.map((chapter) => ({ value: chapter.id, label: chapter.title || chapter.id }))}
            />
          </Field>
        ) : null}
        {step.anchor && !anchorOnScreen ? (
          <p className="text-[11px] text-amber-700 dark:text-amber-400">
            Not on screen in the fixture right now — fine if this anchor lives on another tab or panel.
          </p>
        ) : null}
        <StepFocusHighlights highlights={step.highlights} defaultAnchor={step.anchor}
          onChange={(highlights) => onChange({ highlights })} onPick={onPickFocus} picking={pickingFocus} />
        <ActionEditor step={step} index={index} onChange={onChange} />
        {step.mode === "practice" && step.completion !== "continue" && (
          <CheckEditor
            step={step}
            index={index}
            suggestion={suggestion}
            paths={paths}
            onChange={onChange}
          />
        )}
        <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
          <Checkbox aria-label={`Step ${index + 1} start on a new page`} checked={step.pageBreakBefore ?? false}
            onChange={(event) => onChange({ pageBreakBefore: event.target.checked || undefined })} />Start this step on a new page in PDF and Word
        </label>
        <ContentTemplateTools step={step} onChange={onChange} />
        <NarrationEditor step={step} index={index} onChange={onChange} />
        <details className="rounded-lg border border-slate-200 p-2 dark:border-slate-700">
          <summary className="cursor-pointer text-xs font-semibold text-slate-700 dark:text-slate-200">More options</summary>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Field label="Anchor placement">
              <BuilderSelect
                aria-label={`Step ${index + 1} anchor placement`}
                value={step.anchorPlacement ?? "auto"}
                onChange={(nextValue) => onChange({ anchorPlacement: nextValue === "auto" ? undefined : (nextValue as TutorialRecordingStep["anchorPlacement"]) })}
                controlClassName="h-8 text-xs"
                options={ANCHOR_PLACEMENTS}
              />
            </Field>
            <Field label="Card alignment">
              <BuilderSelect
                aria-label={`Step ${index + 1} card alignment`}
                value={step.anchorAlign ?? "center"}
                onChange={(nextValue) => onChange({ anchorAlign: nextValue === "center" ? undefined : (nextValue as TutorialRecordingStep["anchorAlign"]) })}
                controlClassName="h-8 text-xs"
                options={ANCHOR_ALIGNMENTS}
              />
            </Field>
            <Field label="Wait for anchor (ms)">
              <Input
                aria-label={`Step ${index + 1} anchor wait`}
                type="number"
                min={0}
                max={60000}
                value={step.anchorWaitMs ?? 5000}
                onChange={(event) => onChange({ anchorWaitMs: Math.max(0, Math.min(60_000, Number(event.target.value) || 0)) })}
              />
            </Field>
            <Field label="Target (ring this control instead)">
              <Input
                aria-label={`Step ${index + 1} target`}
                placeholder="data-tutorial-id"
                value={step.target ?? ""}
                onChange={(event) => onChange({ target: event.target.value || undefined })}
              />
            </Field>
            <Field label="Advance delay (ms)">
              <Input
                aria-label={`Step ${index + 1} advance delay`}
                type="number"
                min={0}
                max={60000}
                value={step.advanceDelayMs ?? 250}
                onChange={(event) => onChange({ advanceDelayMs: Math.max(0, Math.min(60_000, Number(event.target.value) || 0)) })}
              />
            </Field>
            <Field label="Highlight style">
              <BuilderSelect
                aria-label={`Step ${index + 1} highlight style`}
                value={step.spotlightStyle ?? INHERIT}
                onChange={(nextValue) => onChange({ spotlightStyle: nextValue ? (nextValue as "dim" | "glow") : undefined })}
                controlClassName="h-8 text-xs"
                options={withInherit([{ value: "dim", label: "Dim background" }, { value: "glow", label: "Glow" }])}
              />
            </Field>
            <Field label="Interaction">
              <BuilderSelect
                aria-label={`Step ${index + 1} interaction`}
                value={step.interaction ?? INHERIT}
                onChange={(nextValue) => onChange({ interaction: nextValue ? (nextValue as "free" | "guided") : undefined })}
                controlClassName="h-8 text-xs"
                options={withInherit([{ value: "free", label: "Whole workspace" }, { value: "guided", label: "Highlighted control only" }])}
              />
            </Field>
            <Field label="Card placement">
              <BuilderSelect
                aria-label={`Step ${index + 1} card placement`}
                value={card.placement ?? INHERIT}
                onChange={(nextValue) => setCard({ placement: nextValue ? (nextValue as TutorialRecordingCardOverride["placement"]) : undefined })}
                controlClassName="h-8 text-xs"
                options={withInherit(CARD_PLACEMENTS)}
              />
            </Field>
            <Field label="Card size">
              <BuilderSelect
                aria-label={`Step ${index + 1} card size`}
                value={card.size ?? INHERIT}
                onChange={(nextValue) => setCard({ size: nextValue ? (nextValue as TutorialCardSize) : undefined })}
                controlClassName="h-8 text-xs"
                options={withInherit(CARD_SIZES)}
              />
            </Field>
            <Field label="Card pointer">
              <BuilderSelect
                aria-label={`Step ${index + 1} card pointer`}
                value={card.pointer === undefined ? INHERIT : card.pointer ? "on" : "off"}
                onChange={(nextValue) => setCard({ pointer: nextValue ? nextValue === "on" : undefined })}
                controlClassName="h-8 text-xs"
                options={withInherit([{ value: "on", label: "Arrow to the control" }, { value: "off", label: "No arrow" }])}
              />
            </Field>
            <Field label="Step label (optional, internal)">
              <Input
                aria-label={`Step ${index + 1} label`}
                value={step.label ?? ""}
                onChange={(event) => onChange({ label: event.target.value || undefined })}
              />
            </Field>
            <label className="col-span-2 flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
              <Checkbox
                aria-label={`Step ${index + 1} show progress`}
                checked={step.showProgress ?? true}
                onChange={(event) => onChange({ showProgress: event.target.checked ? undefined : false })}
              />
              Show “step N of M” on the card
            </label>
          </div>
        </details>
      </div>
    </article>
  );
}

function NarrationEditor({ step, index, onChange }: {
  step: TutorialRecordingStep; index: number;
  onChange: (patch: Partial<Omit<TutorialRecordingStep, "id">>) => void;
}) {
  const range = step.narration ?? { startMs: 0, endMs: 1000 };
  return <details className="rounded-lg border border-slate-200 p-2 dark:border-slate-700">
    <summary className="cursor-pointer text-xs font-semibold">Narration text and timing</summary>
    <div className="mt-2 space-y-2">
      <p className="text-xs text-slate-500">Written narration can appear in reading guides. Timing selects a range of this tutorial’s recorded audio.</p>
      <Textarea aria-label={`Step ${index + 1} narration transcript`} rows={3} maxLength={4000}
        value={step.narration?.transcript ?? ""} onChange={(event) => onChange({ narration: { ...range, transcript: event.target.value || undefined } })} />
      <div className="grid grid-cols-2 gap-2">
        <Field label="Start (ms)"><Input type="number" min={0} step={100} aria-label={`Step ${index + 1} narration start`}
          value={range.startMs} onChange={(event) => {
            const startMs = Math.max(0, Math.round(Number(event.target.value) || 0));
            onChange({ narration: { ...range, startMs, endMs: Math.max(range.endMs, startMs + 1) } });
          }} /></Field>
        <Field label="End (ms)"><Input type="number" min={range.startMs + 1} step={100} aria-label={`Step ${index + 1} narration end`}
          value={range.endMs} onChange={(event) => onChange({ narration: { ...range,
            endMs: Math.max(range.startMs + 1, Math.round(Number(event.target.value) || 0)) } })} /></Field>
      </div>
      {step.narration && <Button size="sm" variant="ghost" onClick={() => onChange({ narration: undefined })}>Remove step narration</Button>}
    </div>
  </details>;
}

/**
 * The semantic action: what Watch mode replays and what "Show me how" performs.
 * Recorded steps arrive with one; hand-authored steps set it here.
 */
function ActionEditor({
  step,
  index,
  onChange
}: {
  step: TutorialRecordingStep;
  index: number;
  onChange: (patch: Partial<Omit<TutorialRecordingStep, "id">>) => void;
}) {
  const environment = useTutorialStudioEnvironment();
  const [open, setOpen] = useState(false);
  const action = step.action;
  const setAction = (patch: Partial<TutorialSemanticAction>) => {
    const next = { id: action?.id ?? "", match: action?.match ?? "subset", ...action, ...patch };
    onChange({ action: next.id ? next : undefined });
  };
  return (
    <div className="rounded-sm bg-slate-50 px-2 py-1.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
      <div className="flex items-center gap-2">
        <span className="font-mono">{action?.id ?? "No semantic action"}</span>
        <button
          type="button"
          className="ml-auto text-[11px] font-semibold text-brand-700 hover:underline dark:text-brand-200"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Done" : action ? "Edit action" : "Set action"}
        </button>
      </div>
      {open ? (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Field label="Action id">
            <Input
              aria-label={`Step ${index + 1} action id`}
              placeholder={environment.actionExample}
              value={action?.id ?? ""}
              onChange={(event) => setAction({ id: event.target.value.trim() })}
            />
          </Field>
          <Field label="Match">
            <BuilderSelect
              aria-label={`Step ${index + 1} action match`}
              value={action?.match ?? "subset"}
              onChange={(nextValue) => setAction({ match: nextValue as "subset" | "exact" })}
              controlClassName="h-8 text-xs"
              options={[{ value: "subset", label: "Subset of args" }, { value: "exact", label: "Exact args" }]}
            />
          </Field>
          <div className="col-span-2">
            <Field label="Args (JSON)">
              <JsonInput
                aria-label={`Step ${index + 1} action args`}
                value={JSON.stringify(action?.args ?? {})}
                rows={2}
                onValid={(parsed) => {
                  const checked = TutorialSemanticActionSchema.shape.args.parse(parsed);
                  setAction({ args: checked && Object.keys(checked).length ? checked : undefined });
                }}
              />
            </Field>
          </div>
          <Field label="Result alias (for later {$ref})">
            <Input
              aria-label={`Step ${index + 1} result alias`}
              value={action?.resultAlias ?? ""}
              onChange={(event) => setAction({ resultAlias: event.target.value.trim() || undefined })}
            />
          </Field>
          {action ? (
            <div className="self-end pb-1">
              <Button size="sm" variant="ghost" onClick={() => onChange({ action: undefined })}>Remove action</Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** A one-line JSON field that reports parse errors instead of committing them. */
export function JsonInput({
  value,
  onValid,
  rows = 1,
  ...rest
}: {
  value: string;
  onValid: (parsed: unknown) => void;
  rows?: number;
  "aria-label": string;
}) {
  const [text, setText] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [seen, setSeen] = useState(value);
  // Adopt external changes (opening another tutorial) without clobbering typing.
  if (seen !== value) {
    setSeen(value);
    setText(value);
    setError(null);
  }
  return (
    <div>
      <Textarea
        {...rest}
        rows={rows}
        spellCheck={false}
        className="font-mono text-[11px]"
        value={text}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          try {
            onValid(JSON.parse(next));
            setError(null);
          } catch (caught) {
            setError(caught instanceof Error ? caught.message.split("\n")[0] : "Invalid JSON.");
          }
        }}
      />
      {error ? <p role="alert" className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">{error}</p> : null}
    </div>
  );
}

export function ChaptersEditor({
  chapters,
  stepCounts,
  onAdd,
  onChange,
  onMove,
  onDelete
}: {
  chapters: readonly TutorialRecordingChapter[];
  stepCounts: ReadonlyMap<string, number>;
  onAdd: () => void;
  onChange: (chapterId: string, patch: Partial<TutorialRecordingChapter>) => void;
  onMove: (chapterId: string, direction: -1 | 1) => void;
  onDelete: (chapterId: string) => void;
}) {
  return (
    <section aria-labelledby="studio-chapters-heading">
      <div className="mb-2 flex items-center justify-between">
        <h2 id="studio-chapters-heading" className="text-sm font-bold text-slate-900 dark:text-white">Chapters</h2>
        <span className="text-xs text-slate-500">{chapters.length} chapter{chapters.length === 1 ? "" : "s"}</span>
      </div>
      <div className="space-y-2">
        {chapters.map((chapter, index) => (
          <div key={chapter.id} className="rounded-sm border border-slate-200 p-2 dark:border-slate-700" data-chapter-id={chapter.id}>
            <div className="mb-1 flex items-center gap-1">
              <span className="text-[11px] text-slate-500">{stepCounts.get(chapter.id) ?? 0} steps</span>
              <div className="ml-auto flex gap-1">
                <IconButton label="Move chapter up" disabled={index === 0} onClick={() => onMove(chapter.id, -1)}><ArrowUp className="h-3.5 w-3.5" /></IconButton>
                <IconButton label="Move chapter down" disabled={index === chapters.length - 1} onClick={() => onMove(chapter.id, 1)}><ArrowDown className="h-3.5 w-3.5" /></IconButton>
                <IconButton label="Delete chapter" disabled={chapters.length <= 1} onClick={() => onDelete(chapter.id)}><Trash className="h-3.5 w-3.5" /></IconButton>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Chapter id">
                <Input aria-label={`Chapter ${index + 1} id`} value={chapter.id} onChange={(event) => onChange(chapter.id, { id: event.target.value.trim() || chapter.id })} />
              </Field>
              <Field label="Title">
                <Input aria-label={`Chapter ${index + 1} title`} value={chapter.title} onChange={(event) => onChange(chapter.id, { title: event.target.value })} />
              </Field>
              <div className="col-span-2">
                <Field label="Description">
                  <Input aria-label={`Chapter ${index + 1} description`} value={chapter.description ?? ""} onChange={(event) => onChange(chapter.id, { description: event.target.value || undefined })} />
                </Field>
              </div>
            </div>
          </div>
        ))}
        <Button size="sm" variant="ghost" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={onAdd}>Add chapter</Button>
      </div>
    </section>
  );
}



type ClauseKind = "equals" | "matches" | "count";

const CLAUSE_KINDS: ReadonlyArray<{ value: ClauseKind; label: string }> = [
  { value: "equals", label: "equals a value" },
  { value: "matches", label: "contains an item matching" },
  { value: "count", label: "has a number of items" },
];

function clauseKind(clause: TutorialCheckClause): ClauseKind {
  if (clause.count) return "count";
  if (clause.where) return "matches";
  return "equals";
}

/** "true", "3" and "home" become the boolean, number and string they read as. */
function parseScalar(text: string): TutorialValue {
  const trimmed = text.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (trimmed !== "" && !Number.isNaN(Number(trimmed))) return Number(trimmed);
  return text;
}

function formatScalar(value: TutorialValue | undefined): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/**
 * Practice completion editor. A step without a check advances on the recorded
 * click alone, which rejects every other route to the same outcome, so the
 * studio proposes one and says plainly when it cannot. Clauses are edited as
 * rows — path, condition, value, and whether to compare with the state at the
 * start of the step — with the raw JSON one click away.
 */
function CheckEditor({
  step,
  index,
  suggestion,
  paths,
  onChange
}: {
  step: TutorialRecordingStep;
  index: number;
  suggestion: TutorialCheckSuggestion;
  paths: readonly string[];
  onChange: (patch: Partial<Omit<TutorialRecordingStep, "id">>) => void;
}) {
  const suggestedCheck = suggestion.check;
  const [rawJson, setRawJson] = useState(false);
  const check = step.check;

  const setCheck = (next: TutorialCheck) => onChange({ check: next });
  const setClause = (position: number, patch: Partial<TutorialCheckClause>) => {
    if (!check) return;
    const merged = { ...check.all[position], ...patch };
    // Drop keys the caller cleared so the clause stays minimal.
    const cleaned = Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== undefined)) as TutorialCheckClause;
    setCheck({ ...check, all: check.all.map((clause, at) => (at === position ? cleaned : clause)) });
  };
  const setKind = (position: number, kind: ClauseKind) => {
    const clause = check?.all[position];
    if (!clause) return;
    setClause(position, {
      equals: kind === "equals" ? clause.equals ?? "" : undefined,
      where: kind === "matches" ? clause.where ?? {} : kind === "count" ? clause.where : undefined,
      count: kind === "count" ? clause.count ?? { min: 1 } : undefined,
    });
  };
  const removeClause = (position: number) => {
    if (!check) return;
    const all = check.all.filter((_, at) => at !== position);
    if (all.length === 0) onChange({ check: undefined });
    else setCheck({ ...check, all });
  };
  const addClause = () =>
    setCheck({
      description: check?.description,
      all: [...(check?.all ?? []), { path: paths[0] ?? "workspace.activeTab", equals: "", mode: "absolute" }],
    });

  return (
    <div className="rounded-lg border border-slate-200 p-2 dark:border-slate-700">
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
          <Checkbox
            aria-label={`Step ${index + 1} grade by outcome`}
            checked={Boolean(check)}
            disabled={!check && !suggestedCheck}
            onChange={(event) => onChange({ check: event.target.checked ? suggestedCheck : undefined })}
          />
          Grade by outcome
        </label>
        {check ? (
          <button
            type="button"
            className="text-[11px] font-semibold text-slate-500 hover:underline"
            aria-pressed={rawJson}
            onClick={() => setRawJson((value) => !value)}
          >
            {rawJson ? "Edit as rows" : "Edit as JSON"}
          </button>
        ) : null}
      </div>

      {check ? (
        <div className="mt-2 space-y-2">
          <Input
            aria-label={`Step ${index + 1} completion description`}
            placeholder="Done when …"
            value={check.description ?? ""}
            onChange={(event) => setCheck({ ...check, description: event.target.value || undefined })}
          />
          {rawJson ? (
            <JsonInput
              aria-label={`Step ${index + 1} check clauses`}
              rows={5}
              value={JSON.stringify(check.all, null, 2)}
              onValid={(parsed) => setCheck(TutorialCheckSchema.parse({ description: check.description, all: parsed }))}
            />
          ) : (
            <ol className="space-y-2" aria-label={`Step ${index + 1} check clauses`}>
              {check.all.map((clause, position) => {
                const kind = clauseKind(clause);
                return (
                  <li key={position} className="rounded-sm border border-slate-200 p-2 dark:border-slate-700" data-clause={position}>
                    <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500">
                      <span>{position === 0 ? "When" : "and"}</span>
                      <IconButton label={`Remove clause ${position + 1}`} onClick={() => removeClause(position)}>
                        <Trash className="h-3.5 w-3.5" />
                      </IconButton>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <SuggestInput
                        ariaLabel={`Step ${index + 1} clause ${position + 1} path`}
                        value={clause.path}
                        onChange={(value) => setClause(position, { path: value })}
                        suggestions={[...paths]}
                        suggestionsLabel="Snapshot paths"
                        placeholder="workspace.activeTab"
                      />
                      <BuilderSelect
                        aria-label={`Step ${index + 1} clause ${position + 1} condition`}
                        value={kind}
                        onChange={(value) => setKind(position, value as ClauseKind)}
                        controlClassName="h-9 text-xs"
                        options={CLAUSE_KINDS.map((option) => ({ value: option.value, label: option.label }))}
                      />
                      {kind === "equals" ? (
                        <div className="col-span-2">
                          <Input
                            aria-label={`Step ${index + 1} clause ${position + 1} value`}
                            placeholder="home, 3, true"
                            value={formatScalar(clause.equals)}
                            onChange={(event) => setClause(position, { equals: parseScalar(event.target.value) })}
                          />
                        </div>
                      ) : null}
                      {kind !== "equals" ? (
                        <div className="col-span-2">
                          <Field label={kind === "count" ? "Only count items matching (JSON, optional)" : "Item shape (JSON subset)"}>
                            <JsonInput
                              aria-label={`Step ${index + 1} clause ${position + 1} where`}
                              value={JSON.stringify(clause.where ?? {})}
                              onValid={(parsed) => {
                                if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Use a JSON object such as {\"type\": \"text\"}.");
                                const object = parsed as Record<string, TutorialValue>;
                                setClause(position, { where: kind === "count" && Object.keys(object).length === 0 ? undefined : object });
                              }}
                            />
                          </Field>
                        </div>
                      ) : null}
                      {kind === "count" ? (
                        <>
                          <Field label="At least">
                            <Input
                              aria-label={`Step ${index + 1} clause ${position + 1} minimum`}
                              type="number"
                              min={0}
                              value={clause.count?.min ?? ""}
                              onChange={(event) =>
                                setClause(position, { count: { ...clause.count, min: event.target.value === "" ? undefined : Math.max(0, Number(event.target.value)) } })
                              }
                            />
                          </Field>
                          <Field label="At most">
                            <Input
                              aria-label={`Step ${index + 1} clause ${position + 1} maximum`}
                              type="number"
                              min={0}
                              value={clause.count?.max ?? ""}
                              onChange={(event) =>
                                setClause(position, { count: { ...clause.count, max: event.target.value === "" ? undefined : Math.max(0, Number(event.target.value)) } })
                              }
                            />
                          </Field>
                        </>
                      ) : null}
                      <BuilderSelect
                        aria-label={`Step ${index + 1} clause ${position + 1} comparison`}
                        value={clause.mode ?? "absolute"}
                        onChange={(value) => setClause(position, { mode: value as "absolute" | "delta" })}
                        controlClassName="h-9 text-xs"
                        options={[
                          { value: "absolute", label: "Compare the current state" },
                          { value: "delta", label: "Compare with when the step began (one more than before)" },
                        ]}
                      />
                      <Input
                        aria-label={`Step ${index + 1} clause ${position + 1} alias`}
                        placeholder="Alias for later {$ref} (optional)"
                        value={clause.captureAlias ?? ""}
                        onChange={(event) => setClause(position, { captureAlias: event.target.value.trim() || undefined })}
                      />
                      <label className="col-span-2 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                        <Checkbox
                          aria-label={`Step ${index + 1} clause ${position + 1} keep watching`}
                          checked={clause.watch ?? false}
                          onChange={(event) => setClause(position, { watch: event.target.checked ? true : undefined })}
                        />
                        Keep watching after the step is done (warn if it comes undone)
                      </label>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={addClause}>
              Add clause
            </Button>
            {suggestedCheck && JSON.stringify(suggestedCheck.all) !== JSON.stringify(check.all) ? (
              <Button size="sm" variant="ghost" onClick={() => onChange({ check: suggestedCheck })}>
                Reset to suggestion
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="mt-1 text-[11px] text-slate-500">
          {suggestedCheck
            ? "This step advances on the recorded action only. Turn on outcome grading to accept any route."
            : suggestion.reason === "already-satisfied"
              ? "This outcome is already true when the step begins, so a check would advance it instantly. It stays action-based."
              : suggestion.reason === "unsupported-action"
                ? "No snapshot path covers this action, so it stays action-based."
                : "Record or set a semantic action first."}
        </p>
      )}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300"><span className="mb-1 block">{label}</span>{children}</label>;
}

export function IconButton({ label, children, ...props }: { label: string; children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" aria-label={label} title={label} className="rounded-sm p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-30 dark:hover:bg-slate-800 dark:hover:text-white" {...props}>{children}</button>;
}

export function formatTime(value: number): string {
  const seconds = Math.max(0, value) / 1_000;
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, "0")}`;
}

