import type { TutorialContextActionResolver } from "../core/view-context";
import type { TutorialDomPolicy } from "./dom-policy";
import type { TutorialObservedAction } from "../core/action-match";
export type { TutorialObservedAction } from "../core/action-match";
import type { TutorialHighlightStyle } from "../core/highlight";
import type { TutorialAliasStore } from "../core/references";
import type {
  TutorialCheck,
  TutorialCheckClause,
  TutorialInteraction,
  TutorialManifest,
  TutorialMode,
  TutorialSpotlightStyle,
  TutorialSemanticAction,
  TutorialStep,
} from "../core/schema";

export type TutorialPlayerStatus =
  | "resume-prompt"
  | "idle"
  | "locating"
  | "executing"
  | "showing"
  | "waiting"
  | "paused"
  | "complete"
  | "stopped"
  | "error";

export interface TutorialExecutionContext {
  manifest: TutorialManifest;
  step: TutorialStep;
  stepIndex: number;
  signal: AbortSignal;
}

export type TutorialPlayerActionExecutor = (
  action: TutorialSemanticAction,
  context: TutorialExecutionContext,
) => void | Promise<unknown>;

export type TutorialActionSubscription = (
  listener: (action: TutorialObservedAction) => void,
) => void | (() => void);

/** One choice on the completion card ("Start a new form", "Back to tutorials"). */
export interface TutorialCompletionAction {
  label: string;
  onSelect: () => void;
  /** The suggested next step; rendered as the emphasized, focused button. */
  primary?: boolean;
}

/**
 * Words the player shows on its own surfaces. Every key is optional; unset
 * keys keep Tourkit's English. `{current}`, `{total}` and `{criterion}` are
 * filled in where they appear.
 */
export interface TutorialPlayerLabels {
  /** Card header in Practice; an empty string leaves only the progress. */
  practice: string;
  /** Card header in Watch; an empty string leaves only the progress. */
  autoplay: string;
  /** Step counter, for example "{current} of {total}". */
  progress: string;
  previous: string;
  next: string;
  finish: string;
  /** Accessible name of the stop (close) icon button. */
  stop: string;
  /** Text of the footer button `appearance.showSkip` adds. */
  skip: string;
  pause: string;
  resume: string;
  /** Practice hint revealed on a gated step, for example "Done when {criterion}". */
  doneWhen: string;
  /** Shown after a guided step turned a click away. */
  blockedHint: string;
  dialogPaused: string;
  anchorOutOfView: string;
  bringIntoView: string;
  watchPacing: string;
  watchPreparing: string;
  errorTitle: string;
  errorAnchorHelp: string;
  errorStepHelp: string;
  retry: string;
  takeMeBack: string;
  skipStep: string;
  stopTutorial: string;
}

export const DEFAULT_TUTORIAL_PLAYER_LABELS: TutorialPlayerLabels = {
  practice: "Practice",
  autoplay: "Watch",
  progress: "{current} of {total}",
  previous: "Back",
  next: "Next",
  finish: "Finish",
  stop: "Stop tutorial",
  skip: "Skip",
  pause: "Pause",
  resume: "Resume",
  doneWhen: "Done when {criterion}",
  blockedHint: "Only the highlighted control is active during this tour.",
  dialogPaused: "Tutorial paused while this dialog is open. Close it to continue.",
  anchorOutOfView: "The highlighted control is out of view. Scroll to it, or select Bring it into view.",
  bringIntoView: "Bring it into view",
  watchPacing: "Read at your pace — this continues automatically, or select Next when you are ready.",
  watchPreparing: "Preparing this step…",
  errorTitle: "Tutorial paused",
  errorAnchorHelp: "Head back to where you were working and it continues by itself — or skip this step. Your progress is kept.",
  errorStepHelp: "Retry the step, skip it, or stop. Your progress is kept.",
  retry: "Retry",
  takeMeBack: "Take me back",
  skipStep: "Skip step",
  stopTutorial: "Stop tutorial",
};

/** Fills `{name}` placeholders in a label. */
export function formatTutorialLabel(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match));
}

/**
 * Presentation of the spotlight and card, for hosts whose tour should look
 * like the rest of their interface. Colours of the card and ring are CSS
 * variables instead (see the README's theming section).
 */
export interface TutorialPlayerAppearance {
  /** Backdrop colour around the cutout. Default black. */
  overlayColor?: string;
  /**
   * Backdrop opacity from 0 to 1. Set, it applies in every mode; unset,
   * Practice and the glow style leave the page undimmed and Watch dims to 0.7.
   */
  overlayOpacity?: number;
  /** Space between the highlighted control and the cutout's edge. Default 6. */
  stagePadding?: number;
  /** Corner radius of the cutout. Default 10. */
  stageRadius?: number;
  /** Space between an attached card and its control. Default 20. */
  cardGap?: number;
  /** Draw the accent ring around the control. Default true; false lets the cutout alone mark it. */
  ring?: boolean;
  /** Add a text Skip button to the card footer; it stops the run like the stop icon. */
  showSkip?: boolean;
}

export interface TutorialPlayerProps {
  /** Words on the player's own surfaces, for localisation. Unset keys keep English. */
  labels?: Partial<TutorialPlayerLabels>;
  /** Spotlight and card presentation. Unset keeps the authored player appearance. */
  appearance?: TutorialPlayerAppearance;
  /**
   * ArrowRight and ArrowLeft press Next and Back whenever the card offers
   * them, unless focus is in an editable field. Escape always stops.
   */
  keyboardNavigation?: boolean;
  /** Explicit host DOM/snapshot conventions. Defaults preserve legacy integrations. */
  domPolicy?: TutorialDomPolicy;
  /** Optional presentation override; unset retains the authored player appearance. */
  highlightStyle?: TutorialHighlightStyle;
  /** A validated manifest from the Tourkit's core schema. */
  manifest: TutorialManifest;
  /**
   * Portable workspace snapshot that practice checks read. Pass a new object
   * whenever the underlying application state changes; the player re-evaluates
   * the current step's check on every identity change.
   */
  state?: unknown;
  /** Overrides manifest.defaultMode and any per-step mode. */
  mode?: TutorialMode;
  /** Overrides the manifest/step visual treatment. Glow leaves the page undimmed. */
  spotlightStyle?: TutorialSpotlightStyle;
  /**
   * Overrides how much of the workspace stays pressable. `guided` confines
   * pointer input to the ringed control and the layers it opens.
   */
  interaction?: TutorialInteraction;
  onExecuteAction?: TutorialPlayerActionExecutor;
  /** Defaults to the shared tutorialActionBus. */
  subscribeToActions?: TutorialActionSubscription;
  /**
   * Practice: whether a step whose check already holds when it opens should
   * still wait for the learner to perform its action. True for an action the
   * learner's own press reports and whose result the check cannot see — a
   * host's command button, say — so the step is not waved through as
   * "already done" before the learner has touched anything. Omitted: every
   * held check reads as already done, as before.
   */
  awaitsLearnerAction?: (action: TutorialSemanticAction) => boolean;
  /**
   * Catching up to a later step, replay this action even when its step's
   * check already holds. A host whose stage starts from a fresh fixture on
   * every load passes true for actions whose effect its state never shows
   * (putting the cursor in a field): the check cannot say whether they
   * happened, and the steps after them depend on them. Omitted: a held
   * check skips the step, as before.
   */
  replayOnCatchUp?: (action: TutorialSemanticAction) => boolean;
  startAt?: number;
  /**
   * With startAt > 0, re-establish the earlier steps' outcomes before playing
   * (the same catch-up a resumed run performs) instead of assuming the
   * workspace is already there. Used by the studio's "play from here".
   */
  catchUp?: boolean;
  autoStart?: boolean;
  /**
   * Resume an interrupted run (reload, navigation) from sessionStorage and
   * keep progress up to date while running. Finishing or stopping clears the
   * saved progress, so only interrupted runs ever resume. Defaults to true;
   * turn off for launches that must always start fresh (studio previews).
   */
  persistProgress?: boolean;
  /**
   * Optional app/user store; omitted preserves the legacy sessionStorage keys.
   * Keep the store object stable during a run. Changing its identity aborts
   * and remounts the player, loading only the next scope's progress/aliases.
   */
  progressStore?: import("./progress").TutorialProgressStore;
  /**
   * Given a step whose anchor left the screen, the semantic action that
   * brings its surface back (for example, selecting the right workspace tab).
   * When provided, the paused card offers "Take me back" and runs it through
   * the normal executor. Return null for anchors that are always on screen.
   */
  resolveReturnAction?: (step: TutorialStep) => TutorialSemanticAction | null;
  /** Restore an expected view through the host's navigation actions. Omitted: no inferred navigation. */
  resolveContextActions?: TutorialContextActionResolver;
  /** Which completed checks to monitor for regressions. Omitted: only clauses with watch: true. */
  isDurableCheckClause?: (clause: TutorialCheckClause) => boolean;
  /** Delay before a gated step reveals its "Done when …" hint. Defaults to 12s. */
  hintDelayMs?: number;
  /**
   * How long a completed step's durable outcome must stay broken before
   * the "came undone" card appears in practice mode. The durable clauses
   * are selected by isDurableCheckClause. Defaults to 1.2s.
   */
  regressionGraceMs?: number;
  /** Highlight/popover transfer animation between steps; 0 (default) renders synchronously. */
  transitionMs?: number;
  actionMatcher?: (
    expected: TutorialSemanticAction,
    observed: TutorialObservedAction,
    aliases: TutorialAliasStore,
  ) => boolean;
  onStepChange?: (step: TutorialStep, index: number) => void;
  onComplete?: () => void;
  onStop?: () => void;
  /**
   * Choices offered on the celebration card after the final step. When empty
   * or omitted the player simply unmounts on completion (embedded hosts such
   * as studio previews handle the moment themselves via onComplete).
   */
  completionActions?: readonly TutorialCompletionAction[];
  /**
   * The celebration card was waved away instead of taking one of its choices:
   * the learner is staying on this page. Hosts use it to forget the finished
   * run (dropping it from the URL) so a reload does not replay it.
   */
  onDismissCompletion?: () => void;
}

export interface FlatTutorialStep {
  chapterId: string;
  chapterTitle: string;
  step: TutorialStep;
}

export function flattenTutorialSteps(manifest: TutorialManifest): FlatTutorialStep[] {
  return manifest.chapters.flatMap((chapter) =>
    chapter.steps.map((step) => ({ chapterId: chapter.id, chapterTitle: chapter.title, step })),
  );
}

export type {
  TutorialCheck,
  TutorialInteraction,
  TutorialManifest,
  TutorialMode,
  TutorialSemanticAction,
  TutorialSpotlightStyle,
  TutorialStep,
};


