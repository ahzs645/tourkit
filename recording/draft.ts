import {
  TutorialManifestSchema,
  type TutorialCardLayout,
  type TutorialCheck,
  type TutorialLaunch,
  type TutorialManifest,
  type TutorialStep,
  type TutorialValue
} from "../core/schema";
import {
  createTutorialSuggestionSession,
  type TutorialCheckSuggestion,
  type TutorialCheckSuggestionProvider,
} from "./check-suggestions";
import type {
  TutorialCapture,
  TutorialMode,
  TutorialRecordedAction,
  TutorialRecordingChapter,
  TutorialRecordingDraft,
  TutorialRecordingStep
} from "./types";
import { isTutorialGuideBlock } from "./content-blocks";
import { publishedScreenshot } from "../core/screenshot";

const makeId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `tutorial-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const DEFAULT_DRAFT_CHAPTER: TutorialRecordingChapter = {
  id: "recorded-workflow",
  title: "Recorded workflow"
};

const DEFAULT_CARD: TutorialCardLayout = { placement: "attached", size: "default", pointer: true };

export function createTutorialRecordingDraft(input: {
  id?: string;
  title?: string;
  description?: string;
  fixture?: string;
  path?: string;
  hash?: Record<string, string | number | boolean>;
  now?: Date;
} = {}): TutorialRecordingDraft {
  const now = (input.now ?? new Date()).toISOString();
  return {
    schemaVersion: 1,
    id: input.id ?? makeId(),
    title: input.title ?? "Untitled tutorial",
    description: input.description ?? "",
    chapters: [{ ...DEFAULT_DRAFT_CHAPTER }],
    createdAt: now,
    updatedAt: now,
    durationMs: 0,
    syntheticDataOnly: true,
    track: "getting-started",
    level: "beginner",
    estimatedMinutes: 5,
    prerequisites: [],
    listed: true,
    defaultMode: "practice",
    spotlightStyle: "dim",
    interaction: "free",
    card: { ...DEFAULT_CARD },
    launch: {
      fixture: input.fixture ?? "tutorial-fixture",
      path: input.path ?? "/",
      hash: input.hash ?? {}
    },
    steps: []
  };
}

/**
 * Brings a draft saved by an earlier studio (single `chapterId`/`chapterTitle`,
 * no library metadata) up to the current shape. Idempotent on current drafts.
 */
export function normalizeTutorialRecordingDraft(raw: unknown): TutorialRecordingDraft {
  const legacy = raw as Partial<TutorialRecordingDraft> & {
    chapterId?: string;
    chapterTitle?: string;
  };
  const chapters: TutorialRecordingChapter[] =
    Array.isArray(legacy.chapters) && legacy.chapters.length
      ? legacy.chapters
      : [
          {
            id: legacy.chapterId || DEFAULT_DRAFT_CHAPTER.id,
            title: legacy.chapterTitle || DEFAULT_DRAFT_CHAPTER.title
          }
        ];
  const { chapterId: _chapterId, chapterTitle: _chapterTitle, ...rest } = legacy;
  return {
    ...(rest as TutorialRecordingDraft),
    chapters,
    track: legacy.track ?? "getting-started",
    level: legacy.level ?? "beginner",
    estimatedMinutes: legacy.estimatedMinutes ?? 5,
    prerequisites: legacy.prerequisites ?? [],
    listed: legacy.listed ?? true,
    spotlightStyle: legacy.spotlightStyle ?? "dim",
    interaction: legacy.interaction ?? "free",
    card: legacy.card ?? { ...DEFAULT_CARD },
    steps: legacy.steps ?? []
  };
}

export function recordedActionToDraftStep(
  action: TutorialRecordedAction,
  _index: number,
  nextActionAtMs: number | undefined,
  defaultMode: TutorialMode = "autoplay",
  /** Optional host-provided outcome, evaluated before this action. */
  suggestedCheck?: TutorialCheck
): TutorialRecordingStep {
  const endMs = Math.max(action.atMs + 500, nextActionAtMs ?? action.atMs + 3_000);
  const semanticAction = {
    id: action.id,
    args: action.args,
    resultAlias: action.resultAlias,
    match: "subset" as const
  };
  return {
    id: makeId(),
    atMs: action.atMs,
    title: action.label?.trim() || humanizeActionId(action.id),
    instruction:
      defaultMode === "practice"
        ? "Perform this action to continue."
        : "Watch this action, then pause or replay it if needed.",
    anchor: action.anchor,
    context: action.context,
    mode: defaultMode,
    action: semanticAction,
    check: suggestedCheck,
    narration: { startMs: action.atMs, endMs }
  };
}

export function applyCaptureToDraft(
  draft: TutorialRecordingDraft,
  capture: TutorialCapture,
  defaultMode: TutorialMode = "autoplay",
  now = new Date(),
  suggestions?: TutorialCheckSuggestionProvider,
): TutorialRecordingDraft {
  // Walk the recording forward so each step's suggested check is judged
  // against the state the learner will actually be in when it starts.
  const projection = createTutorialSuggestionSession(draft.launch, suggestions);
  const steps = capture.actions.map((action, index, actions) => {
    const step = recordedActionToDraftStep(
      action,
      index,
      actions[index + 1]?.atMs,
      defaultMode,
      projection.suggest({ id: action.id, args: action.args, resultAlias: action.resultAlias, match: "subset" }).check
    );
    projection.apply(step.action);
    return step;
  });

  return {
    ...draft,
    updatedAt: now.toISOString(),
    durationMs: capture.durationMs,
    audio: capture.audio,
    visualReference: capture.visualReference,
    steps
  };
}

export type TutorialRecordingPlacement = "replace" | "append" | { afterStepId: string };

/** A new segment cannot shadow an alias used by the authored steps that follow it. */
function recordingSegmentActions(draft: TutorialRecordingDraft, actions: TutorialRecordedAction[]): TutorialRecordedAction[] {
  const occupied = new Set(draft.steps.flatMap((step) => [
    ...(step.action?.resultAlias ? [step.action.resultAlias] : []),
    ...(step.check?.all.flatMap((clause) => clause.captureAlias ? [clause.captureAlias] : []) ?? []),
  ]));
  const reserved = new Set([...occupied, ...actions.flatMap((action) => action.resultAlias ? [action.resultAlias] : [])]);
  const renamed = new Map<string, string>();
  const rewrite = (value: TutorialValue): TutorialValue => {
    if (Array.isArray(value)) return value.map(rewrite);
    if (!value || typeof value !== "object") return value;
    if (Object.keys(value).length === 1 && typeof value.$ref === "string") {
      const alias = [...renamed.keys()].sort((a, b) => b.length - a.length)
        .find((name) => value.$ref === name || (value.$ref as string).startsWith(`${name}.`));
      return alias ? { $ref: `${renamed.get(alias)}${value.$ref.slice(alias.length)}` } : value;
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewrite(item)]));
  };
  return actions.map((action) => {
    // Arguments resolve before this action creates its result alias.
    const args = action.args ? rewrite(action.args as TutorialValue) as Record<string, TutorialValue> : undefined;
    if (!action.resultAlias) return { ...action, args };
    const alias = action.resultAlias;
    if (occupied.has(alias) && !renamed.has(alias)) {
      let suffix = 2;
      while (reserved.has(`${alias}-${suffix}`)) suffix += 1;
      const replacement = `${alias}-${suffix}`;
      renamed.set(alias, replacement);
      reserved.add(replacement);
    }
    return { ...action, args, resultAlias: renamed.get(alias) ?? alias };
  });
}

/** Insert a silent action segment without moving existing narration or replacing authored steps. */
export function mergeCaptureIntoDraft(
  draft: TutorialRecordingDraft,
  capture: TutorialCapture,
  placement: TutorialRecordingPlacement,
  now = new Date(),
  suggestions?: TutorialCheckSuggestionProvider,
): TutorialRecordingDraft {
  if (placement === "replace") return applyCaptureToDraft(draft, capture, draft.defaultMode, now, suggestions);
  if (capture.audio) throw new Error("Append and insert record actions only, preserving the existing narration. Start a new recording to record narration.");
  if (!capture.actions.length) return draft;
  const insertion = placement === "append" ? draft.steps.length
    : draft.steps.findIndex((step) => step.id === placement.afterStepId) + 1;
  if (placement !== "append" && insertion === 0) throw new Error("The insertion step is no longer in this tutorial.");
  const before = draft.steps.slice(0, insertion);
  const after = draft.steps.slice(insertion);
  const projection = createTutorialSuggestionSession(draft.launch, suggestions);
  for (const step of before) if (step.action) projection.apply(step.action);
  const previous = before[before.length - 1];
  const base = after.length ? previous?.atMs ?? 0 : Math.max(draft.durationMs, previous?.atMs ?? 0);
  const room = after.length ? Math.max(0, after[0].atMs - base) : 0;
  const added = recordingSegmentActions(draft, capture.actions).map((action, index, actions) => {
    const step = recordedActionToDraftStep(action, index, actions[index + 1]?.atMs, draft.defaultMode, projection.suggest({ id: action.id, args: action.args, resultAlias: action.resultAlias, match: "subset" }).check);
    projection.apply(step.action);
    return { ...step, chapterId: previous?.chapterId ?? draft.chapters[0]?.id,
      atMs: after.length ? Math.round(base + room * (index + 1) / (actions.length + 1)) : base + action.atMs,
      narration: undefined };
  });
  return { ...draft, updatedAt: now.toISOString(), steps: [...before, ...added, ...after],
    durationMs: after.length ? draft.durationMs : base + capture.durationMs };
}

/**
 * Recomputes suggested checks for the current step order, keeping any check an
 * author has already written. Used after reordering or editing steps.
 */
export function suggestDraftChecks(
  draft: TutorialRecordingDraft,
  options: { overwrite?: boolean } = {},
  now = new Date(),
  suggestions?: TutorialCheckSuggestionProvider,
): TutorialRecordingDraft {
  const projection = createTutorialSuggestionSession(draft.launch, suggestions);
  const steps = draft.steps.map((step) => {
    const suggested = projection.suggest(step.action).check;
    projection.apply(step.action);
    if (step.check && !options.overwrite) return step;
    return { ...step, check: suggested };
  });
  return { ...draft, updatedAt: now.toISOString(), steps };
}

/** The check the studio would propose for a step in its current position. */
export function suggestedCheckForStep(
  draft: TutorialRecordingDraft,
  stepId: string,
  suggestions?: TutorialCheckSuggestionProvider,
): TutorialCheckSuggestion {
  const projection = createTutorialSuggestionSession(draft.launch, suggestions);
  for (const step of draft.steps) {
    if (step.id === stepId) return projection.suggest(step.action);
    projection.apply(step.action);
  }
  return { reason: "no-action" };
}

export function updateDraftStep(
  draft: TutorialRecordingDraft,
  stepId: string,
  patch: Partial<Omit<TutorialRecordingStep, "id">>,
  now = new Date()
): TutorialRecordingDraft {
  return {
    ...draft,
    updatedAt: now.toISOString(),
    steps: draft.steps.map((step) => (step.id === stepId ? { ...step, ...patch } : step))
  };
}

export function deleteDraftStep(
  draft: TutorialRecordingDraft,
  stepId: string,
  now = new Date()
): TutorialRecordingDraft {
  return {
    ...draft,
    updatedAt: now.toISOString(),
    steps: draft.steps.filter((step) => step.id !== stepId)
  };
}

export function moveDraftStep(
  draft: TutorialRecordingDraft,
  stepId: string,
  direction: -1 | 1,
  now = new Date()
): TutorialRecordingDraft {
  const from = draft.steps.findIndex((step) => step.id === stepId);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= draft.steps.length) return draft;
  const steps = [...draft.steps];
  const [step] = steps.splice(from, 1);
  steps.splice(to, 0, step);
  return { ...draft, updatedAt: now.toISOString(), steps };
}

export function splitDraftStep(
  draft: TutorialRecordingDraft,
  stepId: string,
  now = new Date()
): TutorialRecordingDraft {
  const index = draft.steps.findIndex((step) => step.id === stepId);
  if (index < 0) return draft;
  const original = draft.steps[index];
  const range = original.narration ?? {
    startMs: original.atMs,
    endMs: draft.steps[index + 1]?.atMs ?? Math.min(draft.durationMs, original.atMs + 3_000)
  };
  const splitAt = Math.max(range.startMs + 1, Math.round((range.startMs + range.endMs) / 2));
  const first: TutorialRecordingStep = {
    ...original,
    narration: { ...range, endMs: splitAt }
  };
  const second: TutorialRecordingStep = {
    ...original,
    id: makeId(),
    atMs: splitAt,
    title: `${original.title} (continued)`,
    instruction: "Continue with the next part of this action.",
    label: undefined,
    narration: { startMs: splitAt, endMs: range.endMs }
  };
  const steps = [...draft.steps];
  steps.splice(index, 1, first, second);
  return { ...draft, updatedAt: now.toISOString(), steps };
}

/** Moves a step to `toIndex` (0-based) in the flat order, adopting the chapter of the step it lands beside. */
export function moveDraftStepTo(
  draft: TutorialRecordingDraft,
  stepId: string,
  toIndex: number,
  now = new Date()
): TutorialRecordingDraft {
  const from = draft.steps.findIndex((step) => step.id === stepId);
  if (from < 0) return draft;
  const target = Math.max(0, Math.min(toIndex, draft.steps.length - 1));
  if (target === from) return draft;
  const steps = [...draft.steps];
  const [step] = steps.splice(from, 1);
  const neighbour = steps[Math.min(target, steps.length - 1)] ?? draft.steps[from];
  steps.splice(target, 0, { ...step, chapterId: stepChapterId(draft, neighbour) });
  return { ...draft, updatedAt: now.toISOString(), steps };
}

/** Copies a step right after itself, with a fresh id and " (copy)" on the title. */
export function duplicateDraftStep(
  draft: TutorialRecordingDraft,
  stepId: string,
  now = new Date()
): TutorialRecordingDraft {
  const index = draft.steps.findIndex((step) => step.id === stepId);
  if (index < 0) return draft;
  const original = draft.steps[index];
  const copy: TutorialRecordingStep = {
    ...original,
    id: makeId(),
    atMs: original.atMs + 1,
    title: `${original.title} (copy)`,
    label: undefined,
    narration: undefined
  };
  const steps = [...draft.steps];
  steps.splice(index + 1, 0, copy);
  return { ...draft, updatedAt: now.toISOString(), steps };
}

/** Adds an empty step after `afterStepId` (or at the end), for hand-authored lessons. */
export function insertDraftStep(
  draft: TutorialRecordingDraft,
  afterStepId: string | null,
  now = new Date()
): TutorialRecordingDraft {
  const index = afterStepId ? draft.steps.findIndex((step) => step.id === afterStepId) : draft.steps.length - 1;
  const previous = index >= 0 ? draft.steps[index] : undefined;
  const step: TutorialRecordingStep = {
    id: makeId(),
    atMs: previous ? previous.atMs + 1_000 : 0,
    title: "New step",
    instruction: "Describe what to do here.",
    chapterId: previous?.chapterId,
    mode: draft.defaultMode
  };
  const steps = [...draft.steps];
  steps.splice(index + 1, 0, step);
  return { ...draft, updatedAt: now.toISOString(), steps };
}

export function addDraftChapter(
  draft: TutorialRecordingDraft,
  chapter: Partial<TutorialRecordingChapter> = {},
  now = new Date()
): TutorialRecordingDraft {
  const next: TutorialRecordingChapter = {
    id: chapter.id ?? `chapter-${draft.chapters.length + 1}`,
    title: chapter.title ?? `Chapter ${draft.chapters.length + 1}`,
    description: chapter.description
  };
  return { ...draft, updatedAt: now.toISOString(), chapters: [...draft.chapters, next] };
}

export function updateDraftChapter(
  draft: TutorialRecordingDraft,
  chapterId: string,
  patch: Partial<TutorialRecordingChapter>,
  now = new Date()
): TutorialRecordingDraft {
  const renamed = patch.id !== undefined && patch.id !== chapterId ? patch.id : null;
  return {
    ...draft,
    updatedAt: now.toISOString(),
    chapters: draft.chapters.map((chapter) => (chapter.id === chapterId ? { ...chapter, ...patch } : chapter)),
    // Steps follow a renamed chapter id.
    steps: renamed
      ? draft.steps.map((step) => (stepChapterId(draft, step) === chapterId ? { ...step, chapterId: renamed } : step))
      : draft.steps
  };
}

/** Removes a chapter; its steps move to the previous chapter (or the next when it was first). */
export function deleteDraftChapter(
  draft: TutorialRecordingDraft,
  chapterId: string,
  now = new Date()
): TutorialRecordingDraft {
  if (draft.chapters.length <= 1) return draft;
  const index = draft.chapters.findIndex((chapter) => chapter.id === chapterId);
  if (index < 0) return draft;
  const fallback = draft.chapters[index === 0 ? 1 : index - 1].id;
  return {
    ...draft,
    updatedAt: now.toISOString(),
    chapters: draft.chapters.filter((chapter) => chapter.id !== chapterId),
    steps: draft.steps.map((step) => (stepChapterId(draft, step) === chapterId ? { ...step, chapterId: fallback } : step))
  };
}

export function moveDraftChapter(
  draft: TutorialRecordingDraft,
  chapterId: string,
  direction: -1 | 1,
  now = new Date()
): TutorialRecordingDraft {
  const from = draft.chapters.findIndex((chapter) => chapter.id === chapterId);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= draft.chapters.length) return draft;
  const chapters = [...draft.chapters];
  const [chapter] = chapters.splice(from, 1);
  chapters.splice(to, 0, chapter);
  return { ...draft, updatedAt: now.toISOString(), chapters };
}

/** The chapter a step belongs to, falling back to the first chapter. */
export function stepChapterId(draft: TutorialRecordingDraft, step: TutorialRecordingStep): string {
  const known = step.chapterId && draft.chapters.some((chapter) => chapter.id === step.chapterId);
  return known ? step.chapterId! : draft.chapters[0]?.id ?? DEFAULT_DRAFT_CHAPTER.id;
}

export function clearDraftRecording(
  draft: TutorialRecordingDraft,
  now = new Date()
): TutorialRecordingDraft {
  const { audio: _audio, visualReference: _visual, ...withoutRecording } = draft;
  return {
    ...withoutRecording,
    updatedAt: now.toISOString(),
    durationMs: 0,
    steps: []
  };
}

/** The studio's recording frame flag; it must never reach a published manifest. */
const AUTHORING_HASH_KEY = "tutorialAuthor";

function publishedLaunch(launch: TutorialLaunch): TutorialLaunch {
  const { [AUTHORING_HASH_KEY]: _authoring, ...hash } = launch.hash;
  return { ...launch, hash };
}

/** Compiles the editable recording into the canonical player schema. */
export function tutorialRecordingDraftToManifest(
  draft: TutorialRecordingDraft,
  options: { narrationAsset?: string } = {}
): TutorialManifest {
  const narrationAsset = options.narrationAsset;
  const stepToManifest = (step: TutorialRecordingStep) => ({
    ...(step.completion !== undefined ? { completion: step.completion } : {}),
    screenshot: step.screenshot ? publishedScreenshot(step.screenshot) : undefined,
    screenshotMode: step.screenshotMode,
    context: step.context,
    contentKind: step.contentKind,
    pageBreakBefore: step.pageBreakBefore,
    id: sanitizeId(step.id),
    title: step.label || undefined,
    // Only an override is written; the manifest default covers the rest.
    mode: step.mode !== draft.defaultMode ? step.mode : undefined,
    spotlightStyle: step.spotlightStyle,
    interaction: step.interaction,
    card: step.card && Object.values(step.card).some((value) => value !== undefined) ? step.card : undefined,
    anchor: step.anchor
      ? {
          id: step.anchor,
          placement: step.anchorPlacement ?? "auto",
          ...(step.anchorAlign ? { align: step.anchorAlign } : {}),
          waitMs: step.anchorWaitMs ?? 5_000
        }
      : undefined,
    target: step.target ? { id: step.target } : undefined,
    highlights: step.highlights,
    action: step.action,
    prepare: step.prepare?.length ? step.prepare : undefined,
    check: step.check,
    overlay: {
      title: step.title || "Tutorial step",
      body: step.instruction || "Follow the highlighted action.",
      showProgress: step.showProgress ?? true
    },
    narration:
      narrationAsset && step.narration
        ? {
            src: narrationAsset,
            startMs: step.narration.startMs,
            endMs: step.narration.endMs,
            transcript: step.narration.transcript
          }
        : undefined,
    advanceDelayMs: step.advanceDelayMs ?? 250
  });

  const chapters = draft.chapters
    .map((chapter) => ({
      id: sanitizeId(chapter.id),
      title: chapter.title || "Recorded workflow",
      description: chapter.description || undefined,
      steps: draft.steps.filter((step) => stepChapterId(draft, step) === chapter.id && !isTutorialGuideBlock(step)).map(stepToManifest)
    }))
    // A chapter with nothing in it cannot be played; drop it rather than fail.
    .filter((chapter) => chapter.steps.length > 0);

  if (!chapters.length) throw new Error("Choose Continue after reading, or add an action or outcome check to preview Watch or Try it. Explanations can be exported as a reading guide.");

  return TutorialManifestSchema.parse({
    schemaVersion: 1,
    id: sanitizeId(draft.id),
    title: draft.title || "Untitled tutorial",
    description: draft.description || undefined,
    setup: draft.setup,
    track: draft.track,
    level: draft.level,
    estimatedMinutes: draft.estimatedMinutes,
    prerequisites: draft.prerequisites,
    listed: draft.listed,
    docs: draft.docs || undefined,
    defaultMode: draft.defaultMode,
    spotlightStyle: draft.spotlightStyle,
    interaction: draft.interaction,
    card: draft.card,
    launch: publishedLaunch(draft.launch),
    chapters
  });
}

/**
 * Loads a canonical manifest (a built-in tutorial, or an exported one) into
 * the studio's editable shape. Every field round-trips through
 * `tutorialRecordingDraftToManifest`; the recording frame's authoring flag is
 * added to the launch so the stage reports actions instead of playing.
 */
export function tutorialManifestToRecordingDraft(
  manifest: TutorialManifest,
  now = new Date()
): TutorialRecordingDraft {
  const timestamp = now.toISOString();
  const steps: TutorialRecordingStep[] = [];
  let atMs = 0;
  for (const chapter of manifest.chapters) {
    for (const step of chapter.steps) {
      steps.push(manifestStepToDraft(step, chapter.id, atMs, manifest.defaultMode));
      atMs += 1_000;
    }
  }
  return {
    schemaVersion: 1,
    id: manifest.id,
    title: manifest.title,
    description: manifest.description ?? "",
    setup: manifest.setup ? structuredClone(manifest.setup) : undefined,
    chapters: manifest.chapters.map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      description: chapter.description
    })),
    createdAt: timestamp,
    updatedAt: timestamp,
    durationMs: steps.length ? steps[steps.length - 1].atMs + 1_000 : 0,
    syntheticDataOnly: true,
    track: manifest.track,
    level: manifest.level,
    estimatedMinutes: manifest.estimatedMinutes,
    prerequisites: [...manifest.prerequisites],
    listed: manifest.listed,
    docs: manifest.docs,
    defaultMode: manifest.defaultMode,
    spotlightStyle: manifest.spotlightStyle,
    interaction: manifest.interaction,
    card: { ...manifest.card },
    launch: {
      ...manifest.launch,
      hash: { ...manifest.launch.hash, [AUTHORING_HASH_KEY]: 1 }
    },
    steps
  };
}

function manifestStepToDraft(
  step: TutorialStep,
  chapterId: string,
  atMs: number,
  defaultMode: TutorialMode
): TutorialRecordingStep {
  return {
    ...(step.completion !== undefined ? { completion: step.completion } : {}),
    screenshot: step.screenshot,
    screenshotMode: step.screenshotMode,
    context: step.context,
    contentKind: step.contentKind,
    pageBreakBefore: step.pageBreakBefore,
    id: step.id,
    atMs,
    title: step.overlay.title,
    instruction: step.overlay.body,
    label: step.title,
    chapterId,
    anchor: step.anchor?.id,
    anchorPlacement: step.anchor?.placement,
    anchorAlign: step.anchor?.align,
    anchorWaitMs: step.anchor?.waitMs,
    target: step.target?.id,
    highlights: step.highlights,
    mode: step.mode ?? defaultMode,
    spotlightStyle: step.spotlightStyle,
    interaction: step.interaction,
    card: step.card,
    showProgress: step.overlay.showProgress,
    advanceDelayMs: step.advanceDelayMs,
    action: step.action,
    prepare: step.prepare,
    check: step.check,
    narration: step.narration
      ? { startMs: step.narration.startMs, endMs: step.narration.endMs, transcript: step.narration.transcript }
      : undefined
  };
}

function humanizeActionId(id: string): string {
  const words = id.replace(/[._:-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "Recorded action";
}

function sanitizeId(value: string): string {
  return value.trim().replace(/[^a-z0-9._:-]+/gi, "-").replace(/^-+|-+$/g, "") || "tutorial-step";
}

