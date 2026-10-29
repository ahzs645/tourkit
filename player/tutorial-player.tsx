"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLatestRef } from "../shared/use-latest-ref";
import { tutorialContextMatches, type TutorialContextActionResolver } from "../core/view-context";
import { X } from "lucide-react";

import { tutorialActionBus } from "../core/actions";
import { evaluateTutorialCheck, evaluateTutorialCheckForCatchUp } from "../core/checks";
import { resolveTutorialReferences, TutorialAliasStore } from "../core/references";
import {
  TutorialValueSchema,
  type TutorialCheckClause,
  type TutorialStep,
  type TutorialValue,
} from "../core/schema";

import { matchesTutorialAction } from "./action-match";
import { findTutorialAnchor, observeTutorialAnchor, topmostApplicationDialog, waitForTutorialAnchor } from "./anchor";
import { defaultTutorialProgressStore } from "./progress";
import { DEFAULT_TUTORIAL_DOM_POLICY, type TutorialDomPolicy } from "./dom-policy";
import { TUTORIAL_SURFACE_CSS, TUTORIAL_SURFACE_PROPS } from "./surface";
import { TutorialOverlay } from "./tutorial-overlay";
import { autoplayStepDurationMs } from "./playback-timing";
import { DEFAULT_TUTORIAL_PLAYER_LABELS, flattenTutorialSteps } from "./types";
import { isTutorialAnchorFullyVisible } from "./visibility";
import type {
  TutorialObservedAction,
  TutorialPlayerProps,
  TutorialPlayerStatus,
} from "./types";

/**
 * How long a step holds on after its highlighted control leaves the DOM
 * before pausing. This only needs to absorb ordinary React remounts (a frame
 * or two) — it is deliberately much shorter than `anchor.waitMs`, which
 * answers a different question: how long a control may take to first appear
 * when a step starts. A learner who switches surfaces should see "Tutorial
 * paused" in a breath, not after a 20-second appear-budget.
 */
const ANCHOR_LOST_GRACE_MS = 3_000;

/**
 * How long a completed step's outcome must stay broken before the player says
 * so. A single undo is one state change and shows promptly; the grace only
 * absorbs transient states mid-edit (a field briefly detached during a move).
 */
const REGRESSION_GRACE_MS = 1_200;

/** Applications may supply a durability policy; the kit only watches explicit opt-ins. */
function isExplicitlyDurableCheckClause(clause: TutorialCheckClause): boolean {
  return clause.watch === true;
}

const noContextActions: TutorialContextActionResolver = () => [];

/**
 * Autoplay locates a step's anchor after performing its action. When the
 * action closes the surface the anchor lives on (Insert preset closes the
 * picker), the anchor is legitimately gone; wait this long for it and then
 * show the card without a ring rather than failing the step.
 */
const AUTOPLAY_ANCHOR_GRACE_MS = 2_500;

/** How long an action that arrived between steps can still complete the next one. */
const CARRIED_ACTION_MS = 3_000;

/**
 * Catch-up waits for the host to report each rebuilt step's outcome before
 * reading the next step's check: up to this long for a step with a check…
 */
const CATCH_UP_CHECK_WAIT_MS = 1_500;
/** …and this long for any state change after a step without one. */
const CATCH_UP_STATE_WAIT_MS = 300;
/** How long catch-up waits for a step's control before replaying its action anyway. */
const CATCH_UP_ANCHOR_WAIT_MS = 3_000;

/** Resolves once `ready()` holds, the time is up, or the run is abandoned. */
async function waitForReportedState(ready: () => boolean, timeoutMs: number, signal: AbortSignal): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  // One pause first, as before: the host re-renders at least once.
  await new Promise((resolve) => window.setTimeout(resolve, 30));
  while (!signal.aborted && !ready() && Date.now() < deadline) {
    await new Promise((resolve) => window.setTimeout(resolve, 30));
  }
}


/** Anchors this step (or the one after it) still needs on screen. */
interface TutorialDialogExpectation {
  /** Anchor ids the current and next step point at. */
  anchorIds: readonly string[];
  /** The host identifies this step's outcome as an expected dialog opening. */
  expectsDialog: boolean;
}

/**
 * A dialog outside the highlighted control temporarily owns the screen: our
 * modals lay a full-viewport backdrop over the workspace, so the control the
 * step is ringing stops accepting clicks. The tutorial must not keep pointing
 * through that modal, but tutorials deliberately teaching inside one still
 * need their spotlight.
 */
function isAnchorBlockedByApplicationDialog(
  anchor: HTMLElement,
  expectation: TutorialDialogExpectation,
  domPolicy: TutorialDomPolicy,
): boolean {
  // Anchorless steps point at the document body; they have no control that a
  // dialog could hide, and their outcome is often the dialog itself.
  if (anchor === anchor.ownerDocument.body) return false;
  const document = anchor.ownerDocument;
  // A host's floating window can be portalled above the semantic dialog that
  // raised it. Its control stays usable outside that dialog's DOM subtree.
  const foreground = topmostApplicationDialog(document, { domPolicy });
  if (foreground?.contains(anchor)) return false;
  // Floating windows also include persistent navigators. Their geometry helps
  // resolve foreground controls; only semantic modals block outside anchors.
  const topmostDialog = topmostApplicationDialog(document, { includeFloatingWindows: false, domPolicy });
  if (!topmostDialog || topmostDialog.contains(anchor)) return false;
  // A step whose host policy expects a dialog must not be paused by the very
  // dialog it asked for: the ribbon button that opened it now sits behind it,
  // and pausing would freeze the check that grades the opening.
  if (expectation.expectsDialog) return false;
  // Otherwise the dialog is only "expected" when it holds an anchor this step
  // or the next one needs — the preset picker's rows during the preset
  // tutorial, say. Merely *carrying* tutorial anchors is not enough: the same
  // picker opened mid-sentence during the vocabulary tour is exactly the
  // unrelated modal this pause exists for.
  return !expectation.anchorIds.some((id) => {
    const element = findTutorialAnchor(document, id, domPolicy);
    return element !== null && topmostDialog.contains(element);
  });
}

const pausedButtonStyle = {
  display: "inline-flex",
  alignItems: "center",
  padding: "7px 12px",
  border: "1px solid var(--tourkit-line)",
  borderRadius: 8,
  background: "var(--tourkit-bg)",
  color: "var(--tourkit-ink)",
  fontSize: 13,
  cursor: "pointer",
} as const;

function isRecord(value: unknown): value is Record<string, TutorialValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Watch demonstrates a task; it deliberately does not grade one, so an unmet
 * check never holds a step back here. But an author who only ever runs Watch
 * never finds out that a check does not describe what the step's action
 * actually produced — the tutorial looks finished and then stalls the first
 * learner who runs it in Practice. The step still advances; the console says
 * what Practice would have waited for.
 */
function warnIfWatchStepUnproven(
  step: TutorialStep,
  state: unknown,
  baseline: unknown,
  aliases: TutorialAliasStore,
): void {
  if (process.env.NODE_ENV === "production" || !step.check || step.completion === "continue") return;
  const evaluation = evaluateTutorialCheck(step.check, state, baseline, aliases);
  if (evaluation.satisfied) return;
  console.warn(
    `Tutorial step "${step.id}" ended in Watch mode with its check unsatisfied.`
    + (step.check.description ? ` It wants: ${step.check.description}` : "")
    + " Watch does not grade steps, so it played on; Practice would wait here."
    + (evaluation.unresolved.length > 0
      ? ` These paths do not resolve: ${evaluation.unresolved.join(", ")}.`
      : ""),
  );
}

const CONFETTI_COLORS = ["#0284c7", "#f59e0b", "#10b981", "#f43f5e", "#8b5cf6"];
const CONFETTI_DURATION_MS = 2_400;

/**
 * A single celebratory burst behind the completion dialog. Deliberately
 * dependency-free and one-shot: it plays once on mount, honors
 * prefers-reduced-motion, and cleans its canvas up when done.
 */
function CompletionConfetti() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const pieces = Array.from({ length: 140 }, (_, index) => ({
      x: canvas.width / 2 + (Math.random() - 0.5) * canvas.width * 0.3,
      y: canvas.height * 0.4,
      vx: (Math.random() - 0.5) * 14,
      vy: -6 - Math.random() * 10,
      size: 5 + Math.random() * 5,
      rotation: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.3,
      color: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
    }));
    let frame = 0;
    const startedAt = performance.now();
    const tick = (now: number) => {
      const elapsed = now - startedAt;
      context.clearRect(0, 0, canvas.width, canvas.height);
      if (elapsed >= CONFETTI_DURATION_MS) return;
      context.globalAlpha = Math.min(1, (CONFETTI_DURATION_MS - elapsed) / 600);
      for (const piece of pieces) {
        piece.x += piece.vx;
        piece.y += piece.vy;
        piece.vy += 0.35;
        piece.vx *= 0.99;
        piece.rotation += piece.spin;
        context.save();
        context.translate(piece.x, piece.y);
        context.rotate(piece.rotation);
        context.fillStyle = piece.color;
        context.fillRect(-piece.size / 2, -piece.size / 2, piece.size, piece.size * 0.6);
        context.restore();
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      data-testid="tutorial-confetti"
      style={{ position: "fixed", inset: 0, pointerEvents: "none" }}
    />
  );
}

/**
 * Storage identity is also run identity. A host switching app/user scopes must
 * never write the old run's step or aliases into the newly supplied store.
 * The render-time guard resets the child before it can commit effects with a
 * new store; unchanged store objects preserve the existing run.
 */
export function TutorialPlayer(props: TutorialPlayerProps) {
  const store = props.progressStore ?? defaultTutorialProgressStore;
  const [scope, setScope] = useState(() => ({ store, version: 0 }));
  if (scope.store !== store) {
    setScope({ store, version: scope.version + 1 });
    return null;
  }
  return <TutorialPlayerRun key={scope.version} {...props} progressStore={store} />;
}

function TutorialPlayerRun({
  domPolicy = DEFAULT_TUTORIAL_DOM_POLICY,
  highlightStyle,
  manifest,
  state,
  mode: modeOverride,
  spotlightStyle: spotlightStyleOverride,
  interaction: interactionOverride,
  onExecuteAction,
  subscribeToActions,
  awaitsLearnerAction,
  replayOnCatchUp,
  startAt = 0,
  catchUp = false,
  autoStart = true,
  persistProgress = true,
  progressStore = defaultTutorialProgressStore,
  resolveReturnAction,
  resolveContextActions = noContextActions,
  isDurableCheckClause = isExplicitlyDurableCheckClause,
  hintDelayMs,
  transitionMs,
  regressionGraceMs = REGRESSION_GRACE_MS,
  actionMatcher = matchesTutorialAction,
  onStepChange,
  onComplete,
  onStop,
  completionActions,
  onDismissCompletion,
  labels: labelOverrides,
  appearance,
  keyboardNavigation,
  renderCard,
}: TutorialPlayerProps) {
  const labels = useMemo(() => ({ ...DEFAULT_TUTORIAL_PLAYER_LABELS, ...labelOverrides }), [labelOverrides]);
  const domPolicyRef = useLatestRef(domPolicy);
  const flatSteps = useMemo(() => flattenTutorialSteps(manifest), [manifest]);
  const launchMode = modeOverride ?? manifest.defaultMode;
  // Only practice runs persist and resume, and never silently: saved progress
  // becomes a "continue or start over?" prompt — the learner decides. Watch is
  // a performance whose earlier side effects may not survive a reload, so it
  // always starts over.
  const persistThisRun = persistProgress && launchMode === "practice";
  const [pendingResume, setPendingResume] = useState(() =>
    persistThisRun && autoStart && startAt === 0
      ? progressStore.read(manifest.id, launchMode, flatSteps.length)
      : null,
  );
  const [aliases] = useState(() => new TutorialAliasStore());
  const safeStart = Math.max(0, Math.min(startAt, Math.max(0, flatSteps.length - 1)));
  const [stepIndex, setStepIndex] = useState(safeStart);
  // Starting later than step 1 with catchUp re-establishes the earlier
  // steps' outcomes first (see catchUpTo), so the run opens "executing".
  const initialCatchUp = catchUp && autoStart && safeStart > 0;
  // The status Resume returns to lives beside the status itself, so pausing
  // records it in the same update and render can read it.
  const [statusState, setStatusState] = useState<{
    status: TutorialPlayerStatus;
    resumeStatus: TutorialPlayerStatus;
  }>(() => {
    const resumeStatus: TutorialPlayerStatus = "idle";
    if (!autoStart) return { status: "paused", resumeStatus };
    if (pendingResume) return { status: "resume-prompt", resumeStatus };
    return { status: initialCatchUp ? "executing" : "idle", resumeStatus };
  });
  const { status, resumeStatus } = statusState;
  const setStatus = useCallback((next: TutorialPlayerStatus) => {
    setStatusState((current) => (current.status === next ? current : { ...current, status: next }));
  }, []);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [applicationDialogBlocking, setApplicationDialogBlocking] = useState(false);
  const [anchorOutOfView, setAnchorOutOfView] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [narrationComplete, setNarrationComplete] = useState(!flatSteps[safeStart]?.step.narration);
  // Bumped when a matching action supplies aliases to an outcome-graded step,
  // so its check re-evaluates even if no new snapshot follows.
  const [checkNonce, setCheckNonce] = useState(0);
  // An action may legitimately navigate away or close its own dialog.
  const [contextAcceptedStepId, setContextAcceptedStepId] = useState<string | null>(null);
  const runIdRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const pendingPracticeActionRef = useRef(false);
  const statusRef = useLatestRef(status);
  const statusStateRef = useLatestRef(statusState);
  const autoplayRemainingMsRef = useRef<number | null>(null);
  // Pause is an explicit playback choice. Next/Back prepares one requested
  // card while retaining that choice; Resume starts timed playback again.
  const explicitWatchPauseRef = useRef(false);
  const stateRef = useLatestRef(state);
  const baselineRef = useRef<{ stepId: string; state: unknown } | null>(null);
  // Steps whose side effects have already run this session, each held as the
  // promise for that run. Revisiting a step through Previous or Retry must not
  // perform its action a second time — and a promise rather than a flag
  // because the run is entered again *while the first call is still in
  // flight*: React's dev StrictMode invokes the step effect twice in one
  // commit. The second entry has to await the same call and fail with it,
  // rather than read "started" as "succeeded" and play on past a step that
  // threw. A step whose action rejects is unmarked, so Retry runs it again.
  const executedStepsRef = useRef(new Map<string, Promise<void>>());
  // Steps whose check was actually seen to hold this run. Only these are
  // watched for regression — a step passed via Skip was never established, so
  // its unmet outcome is not something the learner undid.
  const satisfiedStepsRef = useRef(new Set<string>());
  // Steps whose regression the learner chose to ignore ("Keep going").
  const mutedRegressionsRef = useRef(new Set<string>());
  // Steps the learner has been past: completed, or rebuilt on resume. Going
  // Back to one is a revisit — its outcome is already in the workspace, so it
  // is shown for reading and advanced with Next instead of graded again.
  const [completedSteps, setCompletedSteps] = useState<ReadonlySet<string>>(() => new Set());
  const markStepCompleted = useCallback((stepId: string) => {
    setCompletedSteps((current) => (current.has(stepId) ? current : new Set(current).add(stepId)));
  }, []);
  const [alreadyDone, setAlreadyDone] = useState(false);
  /* the step whose action the learner has performed by hand in Practice */
  const performedStepRef = useRef<string | null>(null);
  // Captured DOM actions precede the host's React handler and passive screen
  // report. Do not grade an initially satisfied check against that old report.
  const settlingActionRef = useRef<{ frame: number; stepId: string; runId: number; manifestId: string; anchorGraceUntil: number } | null>(null);
  const cancelSettlingAction = useCallback(() => {
    if (settlingActionRef.current) window.cancelAnimationFrame(settlingActionRef.current.frame);
    settlingActionRef.current = null;
  }, []);
  // Practice keeps the last few seconds of actions. One click can publish two
  // (a gallery's Add to form adds a field, then reports the add), and the
  // second can land before the next step starts listening; it still counts
  // for that step — but only actions after the one that finished the
  // previous step, so repeating an action never completes two steps.
  const recentActionsRef = useRef<{ observed: TutorialObservedAction; at: number; state: unknown }[]>([]);
  const completingActionRef = useRef<TutorialObservedAction | null>(null);
  // The celebration card was waved away. Every choice on it leaves the page,
  // so learners who want to stay and look at what they just built need a way
  // out that is not a navigation.
  const [completionDismissed, setCompletionDismissed] = useState(false);
  // The final practice step reached its outcome; Finish ends the run.
  const [readyToFinish, setReadyToFinish] = useState(false);
  // Where to land after a "Take me back" repair completes. Jumping straight
  // back avoids replaying the steps in between: their anchors may live on
  // other surfaces and their delta checks would demand fresh outcomes.
  const returnAfterRepairRef = useRef<number | null>(null);
  const pendingRegressionRef = useRef<{ index: number; timer: number } | null>(null);
  const [regressedIndex, setRegressedIndex] = useState<number | null>(null);
  // Distinguishes "the highlighted control is gone" (auto-resumes when it
  // returns) from a step that genuinely failed (executor error).
  const [errorKind, setErrorKind] = useState<"anchor" | "step">("step");
  const flatStep = flatSteps[stepIndex];
  const currentStep = flatStep?.step;
  const currentStepRef = useLatestRef(currentStep);
  const mode = modeOverride ?? currentStep?.mode ?? manifest.defaultMode;
  const modeRef = useLatestRef(mode);
  const manifestRef = useLatestRef(manifest);
  /** An action the learner already took for `step`, carried over from between steps. */
  const carriedActionFor = useCallback((step: TutorialStep | undefined): TutorialObservedAction | null => {
    if (mode !== "practice" || !step?.action || step.completion === "continue") return null;
    const now = performance.now();
    const buffer = recentActionsRef.current;
    const after = buffer.findIndex((entry) => entry.observed === completingActionRef.current) + 1;
    return buffer.slice(after).find((entry) => now - entry.at < CARRIED_ACTION_MS
      && tutorialContextMatches(step.context, entry.state)
      && actionMatcher(step.action!, entry.observed, aliases))?.observed ?? null;
  }, [actionMatcher, aliases, mode]);
  // Step entry reads it through a ref: entering a step must not re-run when a
  // host passes a fresh matcher.
  const carriedActionForRef = useLatestRef(carriedActionFor);
  const spotlightStyle = spotlightStyleOverride
    ?? currentStep?.spotlightStyle
    ?? manifest.spotlightStyle;
  const interaction = interactionOverride
    ?? currentStep?.interaction
    ?? manifest.interaction;
  const cardLayout = {
    placement: currentStep?.card?.placement ?? manifest.card.placement,
    size: currentStep?.card?.size ?? manifest.card.size,
    pointer: currentStep?.card?.pointer ?? manifest.card.pointer,
  };

  // Which dialogs this step legitimately expects: the surfaces it or the next
  // step points into, and whether its own outcome is a surface opening.
  const nextStep = flatSteps[stepIndex + 1]?.step;
  const dialogExpectation = useMemo<TutorialDialogExpectation>(() => ({
    anchorIds: [
      currentStep?.anchor?.id,
      currentStep?.target?.id,
      nextStep?.anchor?.id,
      nextStep?.target?.id,
    ].filter((id): id is string => typeof id === "string"),
    expectsDialog: Boolean(currentStep && domPolicy.stepExpectsDialog(currentStep)),
  }), [currentStep, nextStep, domPolicy]);

  useEffect(() => {
    if (!anchor) {
      setApplicationDialogBlocking(false);
      return;
    }
    const update = () => {
      // In Watch the step's own action has already run, and a dialog it
      // opened (an Approve that asks to confirm) is the lesson, not an
      // interruption: Watch cannot close it, so pausing would stall for good.
      const openedByWatch = mode === "autoplay" && Boolean(currentStep?.action)
        && executedStepsRef.current.has(currentStep!.id);
      // An accepted learner gesture can replace its control with a result
      // dialog before its earned continuation advances. That dialog must not
      // freeze the accepted step; the next step checks its own live surface.
      const acceptedInPractice = mode === "practice" && Boolean(currentStep?.action)
        && contextAcceptedStepId === currentStep?.id;
      setApplicationDialogBlocking(!openedByWatch && !acceptedInPractice && isAnchorBlockedByApplicationDialog(anchor, dialogExpectation, domPolicy));
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(anchor.ownerDocument.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["open", "aria-modal", "role", "data-state"],
    });
    // Some embedded/webview DOMs can coalesce a portal removal without
    // delivering its mutation record. A light sweep guarantees the tutorial
    // resumes after the modal disappears instead of remaining suspended.
    const sweep = window.setInterval(update, 250);
    return () => {
      observer.disconnect();
      window.clearInterval(sweep);
    };
  }, [anchor, currentStep, dialogExpectation, mode, contextAcceptedStepId, domPolicy]);

  useEffect(() => {
    if (!anchor) {
      setAnchorOutOfView(false);
      return;
    }
    let frame = 0;
    const update = () => {
      frame = 0;
      // A control removed by the learner's successful action is handled by
      // the lost-anchor grace period below. Treating removal as a scroll
      // suspension prevents the outcome check from advancing the step.
      setAnchorOutOfView(anchor.isConnected && !isTutorialAnchorFullyVisible(anchor));
    };
    const scheduleUpdate = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(update);
    };
    update();
    anchor.ownerDocument.addEventListener("scroll", scheduleUpdate, true);
    // A drawer sliding in on a transform moves the control without a scroll
    // or a resize; measured mid-slide it read as out of view for good.
    anchor.ownerDocument.addEventListener("transitionend", scheduleUpdate, true);
    anchor.ownerDocument.addEventListener("animationend", scheduleUpdate, true);
    window.addEventListener("resize", scheduleUpdate);
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(scheduleUpdate);
    resizeObserver?.observe(anchor);
    let parent = anchor.parentElement;
    while (parent && parent !== anchor.ownerDocument.body) {
      resizeObserver?.observe(parent);
      parent = parent.parentElement;
    }
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      anchor.ownerDocument.removeEventListener("scroll", scheduleUpdate, true);
      anchor.ownerDocument.removeEventListener("transitionend", scheduleUpdate, true);
      anchor.ownerDocument.removeEventListener("animationend", scheduleUpdate, true);
      window.removeEventListener("resize", scheduleUpdate);
      resizeObserver?.disconnect();
    };
  }, [anchor]);

  const contextMismatch = mode === "practice" && Boolean(currentStep?.context
    && contextAcceptedStepId !== currentStep.id && !tutorialContextMatches(currentStep.context, state));
  const suspensionReason = contextMismatch ? "context" as const : applicationDialogBlocking
    ? "dialog" as const
    : anchorOutOfView
      ? "anchor-out-of-view" as const
      : null;
  const suspended = suspensionReason !== null;
  const suspendedRef = useLatestRef(suspended);

  const finish = useCallback(() => {
    recentActionsRef.current = [];
    completingActionRef.current = null;
    cancelSettlingAction();
    performedStepRef.current = null;
    explicitWatchPauseRef.current = false;
    runIdRef.current += 1;
    controllerRef.current?.abort();
    setAnchor(null);
    setReadyToFinish(false);
    setCompletionDismissed(false);
    if (persistThisRun) progressStore.clear(manifest.id);
    setStatus("complete");
    onComplete?.();
  }, [cancelSettlingAction, manifest.id, onComplete, persistThisRun, progressStore, setStatus]);

  const goTo = useCallback((index: number) => {
    cancelSettlingAction();
    performedStepRef.current = null;
    setContextAcceptedStepId(null);
    runIdRef.current += 1;
    controllerRef.current?.abort();
    setError(null);
    setAlreadyDone(false);
    setReadyToFinish(false);
    // Any navigation cancels a pending repair-return; Take me back re-arms it
    // after this call.
    returnAfterRepairRef.current = null;
    // The previous anchor stays highlighted while the next one is located, so
    // the overlay survives the transition and driver glides instead of
    // rebuilding the box from scratch.
    pendingPracticeActionRef.current = false;
    if (index >= flatSteps.length) {
      finish();
      return;
    }
    setStepIndex(Math.max(0, index));
    setStatus("idle");
  }, [cancelSettlingAction, finish, flatSteps.length, setStatus]);

  const next = useCallback(() => {
    if (flatStep) markStepCompleted(flatStep.step.id);
    goTo(stepIndex + 1);
  }, [flatStep, goTo, markStepCompleted, stepIndex]);
  const previous = useCallback(() => goTo(stepIndex - 1), [goTo, stepIndex]);
  const isLastStep = stepIndex === flatSteps.length - 1;
  const revisiting = mode === "practice" && currentStep !== undefined
    && completedSteps.has(currentStep.id);

  const stop = useCallback(() => {
    recentActionsRef.current = [];
    completingActionRef.current = null;
    cancelSettlingAction();
    performedStepRef.current = null;
    explicitWatchPauseRef.current = false;
    runIdRef.current += 1;
    controllerRef.current?.abort();
    setAnchor(null);
    // An explicit stop is the learner ending the run, not an interruption:
    // the next launch starts over.
    if (persistThisRun) progressStore.clear(manifest.id);
    setStatus("stopped");
    onStop?.();
  }, [cancelSettlingAction, manifest.id, onStop, persistThisRun, progressStore, setStatus]);

  const dismissCompletion = useCallback(() => {
    setCompletionDismissed(true);
    onDismissCompletion?.();
  }, [onDismissCompletion]);

  const restartSavedRun = useCallback(() => {
    progressStore.clear(manifest.id);
    setPendingResume(null);
    setStatus("idle");
  }, [manifest.id, progressStore, setStatus]);

  const togglePause = useCallback(() => {
    setStatusState((current) => {
      if (current.status === "paused") {
        explicitWatchPauseRef.current = false;
        if (pendingPracticeActionRef.current) {
          pendingPracticeActionRef.current = false;
          return { ...current, status: "showing" };
        }
        return { ...current, status: current.resumeStatus };
      }
      explicitWatchPauseRef.current = true;
      return { status: "paused", resumeStatus: current.status };
    });
  }, []);

  /** Establishes the view even for an informational or check-only step. */
  const restoreStepView = useCallback(async (
    step: NonNullable<typeof currentStep>,
    index: number,
    signal: AbortSignal,
  ) => {
    if (!step.context || tutorialContextMatches(step.context, stateRef.current)) return;
    const navigation = resolveContextActions(step.context);
    if (!onExecuteAction || !navigation.length) throw new Error(`Open ${step.context.label} before this step.`);
    for (const action of navigation) {
      signal.throwIfAborted();
      await onExecuteAction(action, { manifest, step, stepIndex: index, signal });
    }
    await waitForReportedState(() => tutorialContextMatches(step.context, stateRef.current), 2000, signal);
    if (!tutorialContextMatches(step.context, stateRef.current)) throw new Error(`Open ${step.context.label} before this step.`);
  }, [manifest, onExecuteAction, resolveContextActions, stateRef]);

  /**
   * Runs a step's prepare actions: the host navigation that puts its anchor
   * on screen. Repeatable by contract, so every entry runs them again.
   */
  const prepareStep = useCallback(async (
    step: NonNullable<typeof currentStep>,
    index: number,
    signal: AbortSignal,
  ) => {
    if (!step.prepare?.length) return;
    if (!onExecuteAction) {
      throw new Error(`No executor is registered for prepare action "${step.prepare[0].id}".`);
    }
    for (const action of step.prepare) {
      signal.throwIfAborted();
      const resolvedArgs = action.args
        ? TutorialValueSchema.parse(resolveTutorialReferences(action.args as TutorialValue, aliases))
        : undefined;
      if (resolvedArgs !== undefined && !isRecord(resolvedArgs)) {
        throw new Error(`Arguments for prepare action "${action.id}" must be an object.`);
      }
      await onExecuteAction(
        { ...action, ...(resolvedArgs ? { args: resolvedArgs } : {}) },
        { manifest, step, stepIndex: index, signal },
      );
    }
  }, [aliases, manifest, onExecuteAction]);

  /** Runs a step's semantic action through the host application. */
  const runStepAction = useCallback(async (
    step: NonNullable<typeof currentStep>,
    index: number,
    signal: AbortSignal,
  ) => {
    if (!step.action) return;
    if (!onExecuteAction) {
      throw new Error(`No executor is registered for action "${step.action.id}".`);
    }
    await restoreStepView(step, index, signal);
    const resolvedArgs = step.action.args
      ? TutorialValueSchema.parse(
          resolveTutorialReferences(step.action.args as TutorialValue, aliases),
        )
      : undefined;
    if (resolvedArgs !== undefined && !isRecord(resolvedArgs)) {
      throw new Error(`Arguments for tutorial action "${step.action.id}" must be an object.`);
    }
    const executableAction = {
      ...step.action,
      ...(resolvedArgs ? { args: resolvedArgs } : {}),
    };
    const result = await onExecuteAction(executableAction, {
      manifest,
      step,
      stepIndex: index,
      signal,
    });
    if (step.action.resultAlias) aliases.set(step.action.resultAlias, result);
  }, [aliases, manifest, onExecuteAction, restoreStepView]);

  /**
   * Brings the workspace to `target` before playing it: each earlier step's
   * outcome is re-established — skipped when its check already holds,
   * performed through the real executor when not — so continuing a saved
   * run or starting "from here" continues the *state*, not just the number.
   * Fresh results and captures overwrite any saved aliases, which may point
   * at ids that no longer exist.
   */
  const catchUpTo = useCallback((target: number) => {
    const runId = ++runIdRef.current;
    const controller = new AbortController();
    controllerRef.current?.abort();
    controllerRef.current = controller;
    setStatus("executing");
    void (async () => {
      let landing = target;
      for (let index = 0; index < target; index += 1) {
        if (controller.signal.aborted || runIdRef.current !== runId) return;
        const step = flatSteps[index].step;
        if (mode === "practice" && step.completion === "continue") {
          markStepCompleted(step.id);
          continue;
        }
        // A step whose check cannot see its own press (the host says so:
        // opening a Report List folder while the check reads which window is
        // in front) is replayed even when that check holds — the check says
        // nothing about whether the press happened. A catch-up starts from a
        // freshly loaded fixture, so the press has not.
        const pressUnseen = Boolean(step.action
          && (awaitsLearnerAction?.(step.action) || replayOnCatchUp?.(step.action)));
        if (step.check && step.completion !== "continue" && !pressUnseen) {
          const evaluation = evaluateTutorialCheckForCatchUp(step.check, stateRef.current, aliases);
          if (evaluation.satisfied) {
            for (const [alias, value] of Object.entries(evaluation.captures)) aliases.set(alias, value);
            // Nothing was performed, but the outcome is already here: record a
            // settled run so revisiting the step does not redo it.
            executedStepsRef.current.set(step.id, Promise.resolve());
            satisfiedStepsRef.current.add(step.id);
            markStepCompleted(step.id);
            continue;
          }
        }
        if (!step.action || !onExecuteAction) continue;
        // Marked before the await: React's dev StrictMode aborts and re-runs
        // the mount effect, and a step already performed must not run twice.
        // The re-run still waits for that first performance (and the state it
        // reports) before reading the next step's check; skipping straight
        // past it read the state from before the action.
        // A learner meets each step's control before pressing it; so does the
        // replay. An action fired the instant the previous one returned can
        // find its control not drawn yet (the inspector group a new field's
        // selection is still rendering) and give up.
        // The step's surface comes first here too: its control may live in a
        // drawer or tab that only its prepare actions open.
        if (step.prepare?.length && !executedStepsRef.current.has(step.id)) {
          try {
            await prepareStep(step, index, controller.signal);
          } catch (caught) {
            if (controller.signal.aborted) return;
            console.warn(`Tutorial catch-up could not prepare step "${step.id}"; starting there instead.`, caught);
            landing = index;
            break;
          }
          if (controller.signal.aborted || runIdRef.current !== runId) return;
        }
        if (step.anchor && !executedStepsRef.current.has(step.id)) {
          await waitForTutorialAnchor(document, step.anchor.id, {
            domPolicy: domPolicyRef.current,
            timeoutMs: Math.min(step.anchor.waitMs, CATCH_UP_ANCHOR_WAIT_MS),
            signal: controller.signal,
          }).catch(() => undefined);
          if (controller.signal.aborted || runIdRef.current !== runId) return;
        }
        const before = stateRef.current;
        const inFlight = executedStepsRef.current.get(step.id);
        const rebuild = inFlight ?? runStepAction(step, index, controller.signal);
        if (!inFlight) executedStepsRef.current.set(step.id, rebuild);
        try {
          await rebuild;
          markStepCompleted(step.id);
        } catch (caught) {
          if (!inFlight) executedStepsRef.current.delete(step.id);
          // This outcome could not be rebuilt; land here and let the learner
          // do the step for real. Said in the console, because the learner
          // only sees the tutorial stop short of where it was asked to start.
          if (!controller.signal.aborted) {
            console.warn(`Tutorial catch-up could not rebuild step "${step.id}"; starting there instead.`, caught);
          }
          landing = index;
          break;
        }
        if (controller.signal.aborted || runIdRef.current !== runId) return;
        // Let the host report the new state before the next step's check
        // reads it. A fixed pause was not enough on a busy machine: the next
        // check then read the state from before this action, found it
        // already true (the tour's "open Patient Chart" on a fixture that
        // starts in the chart, right after "open Scheduler"), and skipped a
        // step the learner then never saw rebuilt.
        // Judged against the state from before the action, so a delta check
        // waits for its own new item rather than an earlier step's.
        await waitForReportedState(
          () => step.check && step.completion !== "continue"
            ? evaluateTutorialCheck(step.check, stateRef.current, before, aliases).satisfied
            : stateRef.current !== before,
          step.check && step.completion !== "continue" ? CATCH_UP_CHECK_WAIT_MS : CATCH_UP_STATE_WAIT_MS,
          controller.signal,
        );
        // Keep what the check captures (the new field, the new rule): later
        // steps name it through these aliases.
        if (step.check && step.completion !== "continue") {
          const rebuilt = evaluateTutorialCheck(step.check, stateRef.current, before, aliases);
          for (const [alias, value] of Object.entries(rebuilt.captures)) aliases.set(alias, value);
        }
      }
      if (controller.signal.aborted || runIdRef.current !== runId) return;
      // The replayed actions went out on the bus like a learner's. None of
      // them is the learner acting on the step being landed on: a reading
      // step that re-sends the previous step's action (a tour's
      // information bar re-opening a panel) otherwise counted as already done
      // and opened with no ring.
      recentActionsRef.current = [];
      setStepIndex(landing);
      setStatus("idle");
    })();
  }, [aliases, awaitsLearnerAction, domPolicyRef, flatSteps, markStepCompleted, mode, onExecuteAction, prepareStep, replayOnCatchUp, runStepAction, setStatus, stateRef]);

  const continueSavedRun = useCallback(() => {
    if (!pendingResume) return;
    const target = Math.max(0, Math.min(pendingResume.stepIndex, flatSteps.length - 1));
    for (const [alias, value] of Object.entries(pendingResume.aliases)) aliases.set(alias, value);
    setPendingResume(null);
    catchUpTo(target);
  }, [aliases, catchUpTo, flatSteps.length, pendingResume]);

  // "Play from here": catch up on mount. StrictMode's simulated unmount
  // aborts the first attempt through the controller cleanup below, so the
  // effect simply runs again; steps already performed are skipped above.
  const catchUpToRef = useLatestRef(catchUpTo);
  useEffect(() => {
    if (!initialCatchUp) return;
    catchUpToRef.current(safeStart);
  }, [catchUpToRef, initialCatchUp, safeStart]);

  useEffect(() => () => {
    runIdRef.current += 1;
    controllerRef.current?.abort();
    cancelSettlingAction();
  }, [cancelSettlingAction]);

  useEffect(() => {
    cancelSettlingAction();
    performedStepRef.current = null;
    pendingPracticeActionRef.current = false;
  }, [cancelSettlingAction, currentStep?.id, manifest.id, mode]);

  useEffect(() => {
    recentActionsRef.current = [];
    completingActionRef.current = null;
    setContextAcceptedStepId(null);
  }, [mode]);

  // Reset run state only when the manifest actually changes — the mount run
  // must not wipe aliases restored from saved progress.
  const manifestIdRef = useRef(manifest.id);
  useEffect(() => {
    if (manifestIdRef.current === manifest.id) return;
    manifestIdRef.current = manifest.id;
    runIdRef.current += 1;
    controllerRef.current?.abort();
    cancelSettlingAction();
    performedStepRef.current = null;
    pendingPracticeActionRef.current = false;
    explicitWatchPauseRef.current = false;
    aliases.clear();
    executedStepsRef.current.clear();
    satisfiedStepsRef.current.clear();
    setCompletedSteps((current) => (current.size > 0 ? new Set() : current));
    mutedRegressionsRef.current.clear();
    returnAfterRepairRef.current = null;
    recentActionsRef.current = [];
    completingActionRef.current = null;
    setContextAcceptedStepId(null);
    setAlreadyDone(false);
    setReadyToFinish(false);
    setRegressedIndex(null);
  }, [aliases, cancelSettlingAction, manifest.id]);

  useEffect(() => {
    // While the continue-or-restart prompt is open, the saved record is the
    // thing being asked about — leave it alone.
    if (!persistThisRun || statusRef.current === "resume-prompt"
      || statusRef.current === "complete" || statusRef.current === "stopped") return;
    if (stepIndex <= 0) {
      progressStore.clear(manifest.id);
      return;
    }
    progressStore.save(manifest.id, {
      stepIndex,
      mode: launchMode,
      aliases: aliases.snapshot() as Record<string, unknown>,
      savedAt: Date.now(),
    });
  }, [aliases, launchMode, manifest.id, persistThisRun, progressStore, statusRef, stepIndex]);

  useEffect(() => {
    setNarrationComplete(!currentStep?.narration);
    autoplayRemainingMsRef.current = null;
  }, [currentStep?.id, currentStep?.narration]);

  useEffect(() => {
    if (!currentStep || status !== "idle") return;

    cancelSettlingAction();
    performedStepRef.current = null;
    const runId = ++runIdRef.current;
    const controller = new AbortController();
    controllerRef.current?.abort();
    controllerRef.current = controller;
    setError(null);

    const enterStep = async () => {
      let failureKind: "anchor" | "step" = "step";
      try {
        // The step's surface first (a drawer, a tab), in every mode: its
        // anchor may not exist until the host has navigated there.
        if (currentStep.prepare?.length) {
          setStatus("executing");
          await prepareStep(currentStep, stepIndex, controller.signal);
          if (controller.signal.aborted || runIdRef.current !== runId) return;
        }
        if (mode === "autoplay" && currentStep.action) {
          // Recorded before the await, so a second entry (StrictMode invokes
          // this effect twice synchronously, and Previous walks back into a
          // step) does not repeat a real workspace mutation. It awaits the
          // first call's own promise instead: an action that throws must
          // throw for whichever entry is still live, or the failure is lost
          // with the run that started it and the step plays on regardless.
          let performed = executedStepsRef.current.get(currentStep.id);
          const restoreCompletedView = Boolean(performed) && completedSteps.has(currentStep.id);
          if (!performed) {
            setStatus("executing");
            performed = runStepAction(currentStep, stepIndex, controller.signal);
            executedStepsRef.current.set(currentStep.id, performed);
            // Unmarked on failure so the error card's Retry runs it again.
            // Attached here rather than around the await below, which a
            // superseded run may never reach.
            performed.catch(() => executedStepsRef.current.delete(currentStep.id));
          }
          await performed;
          // Previous revisits the original view without repeating the command.
          // A cached in-flight first entry (StrictMode) is not a revisit: its
          // action may legitimately have closed this surface.
          if (restoreCompletedView) await restoreStepView(currentStep, stepIndex, controller.signal);
        } else if (mode === "autoplay" && currentStep.context) {
          // Reading and outcome-only steps have a view too. Navigation is
          // repeatable when revisiting them; it does not replay a command.
          setStatus("executing");
          await restoreStepView(currentStep, stepIndex, controller.signal);
        }
        if (controller.signal.aborted || runIdRef.current !== runId) return;
        setStatus("locating");
        let found: HTMLElement;
        // Already done between steps (the second half of one click): its
        // control may have closed with it, so do not wait for it to appear.
        if (currentStep.context && !tutorialContextMatches(currentStep.context, stateRef.current)) {
          found = document.body;
        } else if (currentStep.anchor && !carriedActionForRef.current(currentStep)) {
          // A Watch step whose own action closed the anchor's surface has no
          // anchor to show any more; the card still reads fine without a ring.
          const actionClosedSurface = mode === "autoplay" && Boolean(currentStep.action);
          try {
            found = await waitForTutorialAnchor(document, currentStep.anchor.id, {
              domPolicy: domPolicyRef.current,
              timeoutMs: actionClosedSurface
                ? Math.min(currentStep.anchor.waitMs, AUTOPLAY_ANCHOR_GRACE_MS)
                : currentStep.anchor.waitMs,
              signal: controller.signal,
            });
          } catch (caught) {
            if (controller.signal.aborted) throw caught;
            if (actionClosedSurface) {
              found = document.body;
            } else {
              failureKind = "anchor";
              throw caught;
            }
          }
        } else {
          found = document.body;
        }
        if (controller.signal.aborted || runIdRef.current !== runId) return;
        setAnchor(found);
        // Record what the workspace looked like before the learner acts so
        // delta checks ("one more text field than before") have a reference.
        // A step whose action was already carried over (the second half of
        // one click) was acted on before it opened: its reference is the
        // previous step's, from before that click.
        const carriedFrom = carriedActionForRef.current(currentStep) ? baselineRef.current?.state : undefined;
        baselineRef.current = { stepId: currentStep.id, state: carriedFrom ?? stateRef.current };
        setStatusState((current) => mode === "autoplay" && explicitWatchPauseRef.current
          ? { status: "paused", resumeStatus: "showing" }
          : { ...current, status: mode === "practice" && currentStep.completion !== "continue" ? "waiting" : "showing" });
        onStepChange?.(currentStep, stepIndex);
      } catch (caught) {
        if (controller.signal.aborted) return;
        setAnchor(null);
        setErrorKind(failureKind);
        setStatus("error");
        setError(caught instanceof Error ? caught.message : "The tutorial could not prepare this step.");
      }
    };
    void enterStep();
  }, [cancelSettlingAction, carriedActionForRef, completedSteps, currentStep, domPolicyRef, mode, onStepChange, prepareStep, restoreStepView, runStepAction, setStatus, stateRef, status, stepIndex]);

  const currentPracticeCheckHolds = useCallback(() => {
    if (mode !== "practice" || !currentStep?.check || currentStep.completion === "continue" || revisiting) return true;
    if (settlingActionRef.current?.stepId === currentStep.id) return false;
    return evaluateTutorialCheck(currentStep.check, stateRef.current,
      baselineRef.current?.stepId === currentStep.id ? baselineRef.current.state : undefined, aliases).satisfied;
  }, [aliases, currentStep, mode, revisiting, stateRef]);

  const guardedNext = useCallback(() => {
    if (currentStepRef.current?.id !== currentStep?.id || modeRef.current !== mode) return;
    // Error Skip, reading cards and revisits retain their explicit navigation.
    if (statusRef.current !== "error") {
      if (mode === "practice" && currentStep?.check && currentStep.completion !== "continue" && !revisiting) {
        const current = statusStateRef.current;
        if (current.status !== "showing" && !(current.status === "paused" && current.resumeStatus === "showing")) return;
      }
      if (!currentPracticeCheckHolds()) return;
    }
    next();
  }, [currentPracticeCheckHolds, currentStep, currentStepRef, mode, modeRef, next, revisiting, statusRef, statusStateRef]);

  useEffect(() => {
    if (status !== "showing" || !currentStep || !narrationComplete || suspended) return;
    // The host may commit the outcome before reporting its semantic action.
    // Wait for that action to settle, then retry when checkNonce changes.
    if (settlingActionRef.current?.stepId === currentStep.id) return;
    // Being on the expected screen does not mean the learner read its explanation.
    // Continue steps, revisits and outcomes present at entry wait for explicit Next.
    if (mode === "practice" && (currentStep.completion === "continue" || alreadyDone || revisiting)) return;
    // The last practice step does not finish itself: the learner gets to look
    // at the result (the previewed form, the open analyzer) and presses Finish.
    if (mode === "practice" && isLastStep && !revisiting) {
      setReadyToFinish(true);
      return;
    }
    // Practice advances the instant the outcome lands — the learner just did
    // the thing; any pause reads as lag. advanceDelayMs is autoplay pacing.
    const fullDuration = mode === "autoplay"
      ? autoplayStepDurationMs(currentStep)
      : 0;
    const duration = autoplayRemainingMsRef.current ?? fullDuration;
    const startedAt = performance.now();
    const runId = runIdRef.current;
    let completed = false;
    const timer = window.setTimeout(() => {
      // A queued timer must respect Pause even before effect cleanup runs.
      if (runId !== runIdRef.current || currentStepRef.current?.id !== currentStep.id
        || modeRef.current !== mode || statusRef.current !== "showing" || suspendedRef.current) return;
      if (mode === "autoplay" && explicitWatchPauseRef.current) return;
      if (!currentPracticeCheckHolds()) return;
      completed = true;
      autoplayRemainingMsRef.current = null;
      if (mode === "autoplay") {
        warnIfWatchStepUnproven(
          currentStep,
          stateRef.current,
          baselineRef.current?.stepId === currentStep.id ? baselineRef.current.state : undefined,
          aliases,
        );
      }
      // A completed repair returns to where the learner was, not to the step
      // after the repaired one.
      const repairReturn = returnAfterRepairRef.current;
      returnAfterRepairRef.current = null;
      if (repairReturn !== null && repairReturn > stepIndex + 1) {
        goTo(repairReturn);
      } else {
        next();
      }
    }, duration);
    return () => {
      window.clearTimeout(timer);
      if (!completed && mode === "autoplay") {
        autoplayRemainingMsRef.current = Math.max(0, duration - (performance.now() - startedAt));
      }
    };
  }, [aliases, alreadyDone, checkNonce, currentPracticeCheckHolds, currentStep, currentStepRef, goTo, isLastStep, mode, modeRef, narrationComplete, next, revisiting, stateRef, status, statusRef, stepIndex, suspended, suspendedRef]);

  useEffect(() => {
    if (mode !== "practice") return;
    const subscribe = subscribeToActions ?? ((listener: (action: TutorialObservedAction) => void) => tutorialActionBus.subscribe(listener));
    let listening = true;
    const unsubscribe = subscribe((observed) => {
      if (!listening || modeRef.current !== "practice") return;
      const now = performance.now();
      recentActionsRef.current = [
        ...recentActionsRef.current.filter((entry) => now - entry.at < CARRIED_ACTION_MS),
        { observed, at: now, state: stateRef.current },
      ];
    });
    return () => { listening = false; if (typeof unsubscribe === "function") unsubscribe(); };
  }, [manifest.id, mode, modeRef, subscribeToActions, stateRef]);

  useEffect(() => {
    const waitingOrPaused = status === "waiting"
      || (status === "paused" && resumeStatus === "waiting");
    // A carried action may have closed its own view before this step appears.
    if ((suspended && !(contextMismatch && carriedActionFor(currentStep))) || mode !== "practice" || !waitingOrPaused || !currentStep?.action || currentStep.completion === "continue" || revisiting) return;
    const subscribe = subscribeToActions ?? ((listener: (action: TutorialObservedAction) => void) => tutorialActionBus.subscribe(listener));
    let listening = true;
    const acceptedRun = runIdRef.current;
    const acceptedManifestId = manifestRef.current.id;
    const stillCurrent = () => runIdRef.current === acceptedRun
      && currentStepRef.current?.id === currentStep.id
      && manifestRef.current.id === acceptedManifestId && modeRef.current === "practice";
    const accept = (observed: TutorialObservedAction, actionState: unknown = stateRef.current) => {
      if (
        !listening || !stillCurrent()
        || (statusRef.current !== "waiting" && !(statusRef.current === "paused" && statusStateRef.current.resumeStatus === "waiting"))
        || !currentStep.action
        || !tutorialContextMatches(currentStep.context, actionState)
        || !actionMatcher(currentStep.action, observed, aliases)
      ) return;
      completingActionRef.current = observed;
      setContextAcceptedStepId(currentStep.id);
      if (currentStep.action.resultAlias && "action" in observed && observed.result !== undefined) {
        aliases.set(currentStep.action.resultAlias, observed.result);
      }
      // A step with a state check is graded on its outcome, so the recorded
      // action only supplies aliases here; the check decides when it is done.
      // It also marks the step performed, for a check that already held.
      if (currentStep.check) {
        cancelSettlingAction();
        performedStepRef.current = null;
        let snapshot = stateRef.current;
        let stableFrames = 0;
        const pending = {
          frame: 0, stepId: currentStep.id, runId: acceptedRun, manifestId: acceptedManifestId,
          anchorGraceUntil: performance.now() + Math.min(currentStep.anchor?.waitMs ?? ANCHOR_LOST_GRACE_MS, ANCHOR_LOST_GRACE_MS),
        };
        settlingActionRef.current = pending;
        const settle = () => {
          if (settlingActionRef.current !== pending) return;
          const current = statusStateRef.current;
          const canSettle = current.status === "waiting" || current.status === "showing"
            || (current.status === "paused" && (current.resumeStatus === "waiting" || current.resumeStatus === "showing"));
          // A synchronous host update may already have earned "showing".
          // Finish settlement so grading and advancement see the final state.
          if (!stillCurrent() || !canSettle) {
            settlingActionRef.current = null;
            return;
          }
          if (snapshot !== stateRef.current) {
            snapshot = stateRef.current;
            stableFrames = 0;
          } else stableFrames += 1;
          // A frame boundary lets React commit the originating input and its
          // passive host report; a second stable frame also covers that report's
          // parent update. No new snapshot is required for no-op commands.
          if (stableFrames < 2) {
            pending.frame = window.requestAnimationFrame(settle);
            return;
          }
          settlingActionRef.current = null;
          performedStepRef.current = currentStep.id;
          setCheckNonce((value) => value + 1);
        };
        pending.frame = window.requestAnimationFrame(settle);
        return;
      }
      if (statusRef.current === "paused") {
        pendingPracticeActionRef.current = true;
        return;
      }
      setStatus("showing");
    };
    const carried = carriedActionFor(currentStep);
    if (carried) accept(carried, recentActionsRef.current.find((entry) => entry.observed === carried)?.state);
    const unsubscribe = subscribe(accept);
    return () => { listening = false; if (typeof unsubscribe === "function") unsubscribe(); };
  }, [contextMismatch, actionMatcher, aliases, cancelSettlingAction, carriedActionFor, currentStep, currentStepRef, manifestRef, mode, modeRef, next, resumeStatus, revisiting, setStatus, status, statusRef, statusStateRef, subscribeToActions, suspended, stateRef]);

  useEffect(() => {
    const waitingOrPaused = status === "waiting"
      || (status === "paused" && resumeStatus === "waiting");
    const showingOrPaused = status === "showing"
      || (status === "paused" && resumeStatus === "showing");
    const check = currentStep?.check;
    if (suspended || mode !== "practice" || (!waitingOrPaused && !showingOrPaused) || !check || currentStep?.completion === "continue" || revisiting) return;
    if (settlingActionRef.current?.stepId === currentStep.id) return;
    if (baselineRef.current?.stepId !== currentStep.id) {
      baselineRef.current = { stepId: currentStep.id, state: stateRef.current };
    }

    // Every snapshot the host passes has a new identity, and alias-supplying
    // actions bump checkNonce, so evaluation is purely event-driven.
    const evaluation = evaluateTutorialCheck(
      check,
      stateRef.current,
      baselineRef.current?.state,
      aliases,
    );
    if (process.env.NODE_ENV !== "production" && evaluation.unresolved.length > 0) {
      console.warn(
        `Tutorial step "${currentStep.id}" has a check that cannot resolve: ${evaluation.unresolved.join(", ")}.`,
      );
    }
    if (!evaluation.satisfied) {
      if (showingOrPaused) {
        pendingPracticeActionRef.current = false;
        setReadyToFinish(false);
        setAlreadyDone(false);
        setStatusState((current) => current.status === "paused"
          ? { ...current, resumeStatus: "waiting" }
          : { ...current, status: "waiting" });
      }
      return;
    }
    if (showingOrPaused) return;
    // Held before the learner did anything on this step? Then the step is
    // acknowledged rather than skipped past. Delta clauses never hold against
    // their own baseline, so only absolute outcomes can be "already done" —
    // unless the check cannot see the step being done at all (a command
    // button, whose press changes nothing the check reads): then the step
    // waits for the learner's own press, and is not "already done".
    const baseline = baselineRef.current?.state;
    const heldAtStart = evaluateTutorialCheck(check, baseline, baseline, aliases).satisfied;
    const awaitsPress = heldAtStart && Boolean(currentStep.action && awaitsLearnerAction?.(currentStep.action));
    if (awaitsPress && performedStepRef.current !== currentStep.id) return;
    for (const [alias, value] of Object.entries(evaluation.captures)) aliases.set(alias, value);
    satisfiedStepsRef.current.add(currentStep.id);
    setAlreadyDone(heldAtStart && !awaitsPress);
    if (statusRef.current === "paused") {
      pendingPracticeActionRef.current = true;
      return;
    }
    setStatus("showing");
  }, [aliases, awaitsLearnerAction, checkNonce, currentStep, mode, resumeStatus, revisiting, setStatus, state, stateRef, status, statusRef, suspended]);

  // Watch the durable outcomes of completed steps while the learner practices
  // a later one. Undoing an earlier result (unchecking Required, deleting the
  // field a step created) surfaces as a gentle "came undone" card instead of
  // the tutorial finishing over a form that no longer matches what it taught.
  useEffect(() => {
    const clearPending = () => {
      if (pendingRegressionRef.current) {
        window.clearTimeout(pendingRegressionRef.current.timer);
        pendingRegressionRef.current = null;
      }
    };
    const active = mode === "practice" && (status === "waiting" || status === "showing");
    if (!active) {
      clearPending();
      if (regressedIndex !== null) setRegressedIndex(null);
      return;
    }
    let broken: number | null = null;
    for (let index = 0; index < stepIndex; index += 1) {
      const step = flatSteps[index].step;
      if (step.completion === "continue" || !step.check || !satisfiedStepsRef.current.has(step.id)) continue;
      if (mutedRegressionsRef.current.has(step.id)) continue;
      const durable = step.check.all.filter(isDurableCheckClause);
      if (durable.length === 0) continue;
      // Evaluated like a resumed run: no baseline, so delta clauses degrade to
      // "the outcome exists at all" — exactly the durable reading.
      const evaluation = evaluateTutorialCheck(
        { ...step.check, all: durable },
        stateRef.current,
        undefined,
        aliases,
      );
      if (!evaluation.satisfied) {
        broken = index;
        break;
      }
    }
    if (broken === null) {
      clearPending();
      if (regressedIndex !== null) setRegressedIndex(null);
      return;
    }
    if (regressedIndex === broken) {
      clearPending();
      return;
    }
    if (pendingRegressionRef.current?.index === broken) return;
    clearPending();
    const index = broken;
    const timer = window.setTimeout(() => {
      pendingRegressionRef.current = null;
      setRegressedIndex(index);
    }, regressionGraceMs);
    pendingRegressionRef.current = { index, timer };
  }, [aliases, flatSteps, isDurableCheckClause, mode, regressedIndex, regressionGraceMs, state, stateRef, status, stepIndex]);

  useEffect(() => () => {
    if (pendingRegressionRef.current) window.clearTimeout(pendingRegressionRef.current.timer);
  }, []);

  useEffect(() => {
    const anchorId = currentStep?.anchor?.id;
    const graceMs = Math.min(currentStep?.anchor?.waitMs ?? ANCHOR_LOST_GRACE_MS, ANCHOR_LOST_GRACE_MS);
    if (!anchor || !anchorId || contextMismatch) return;
    let lostTimer: number | null = null;
    const actionTimers = new Set<number>();
    let active = true;
    const pauseForLostAnchor = () => {
      if (!active || currentStepRef.current?.id !== currentStep?.id) return;
      // A captured command can synchronously close its own window and report
      // that derived close before two stable frames commit the actual outcome.
      // Protect only this accepted run/step, and only for the existing anchor
      // grace period: stalled rendering must still surface a lost anchor.
      const pending = settlingActionRef.current;
      if (mode === "practice" && pending && pending.stepId === currentStep?.id
        && pending.runId === runIdRef.current && pending.manifestId === manifestRef.current.id) {
        const remaining = pending.anchorGraceUntil - performance.now();
        if (remaining > 0) {
          if (lostTimer !== null) window.clearTimeout(lostTimer);
          lostTimer = window.setTimeout(() => {
            lostTimer = null;
            if (anchor.isConnected || findTutorialAnchor(anchor.ownerDocument, anchorId, domPolicyRef.current)) return;
            pauseForLostAnchor();
          }, remaining);
          return;
        }
      }
      // After settlement the actual outcome, rather than a derived route event,
      // decides whether the accepted gesture completes the step.
      if (mode === "practice" && performedStepRef.current === currentStep?.id) return;
      // Only a step the learner is actually on can pause; transitions between
      // steps keep the old anchor briefly and must not trip this.
      if (statusRef.current !== "waiting" && statusRef.current !== "showing" && statusRef.current !== "paused") return;
      // A finished practice step whose own action closed its control (the
      // last step's Add to form closes the gallery) is done, not lost.
      if (mode === "practice" && statusRef.current === "showing") return;
      // So is a Watch step whose action has already run and closed its
      // surface a moment after the control was found (Print and Attach
      // closes the preview it sits on): the card reads on without a ring.
      if (mode === "autoplay" && currentStep?.action && executedStepsRef.current.has(currentStep.id)) {
        setAnchor(document.body);
        return;
      }
      runIdRef.current += 1;
      controllerRef.current?.abort();
      setErrorKind("anchor");
      setAnchor(null);
      setStatus("error");
      setError("The highlighted control left the screen — the workspace is probably showing a different tab or panel now.");
    };
    // Keep the highlight on the live node when React replaces it. A brief
    // absence is ordinary re-rendering; an anchor that never returns is a
    // broken step and must surface as one instead of a frozen spotlight.
    const disconnect = observeTutorialAnchor(anchor.ownerDocument, anchorId, (replacement) => {
      if (replacement) {
        if (lostTimer !== null) {
          window.clearTimeout(lostTimer);
          lostTimer = null;
        }
        setAnchor(replacement);
        return;
      }
      if (lostTimer !== null) return;
      lostTimer = window.setTimeout(pauseForLostAnchor, graceMs);
    }, domPolicyRef.current);
    // A semantic action arriving while the anchor is disconnected means the
    // learner changed surfaces (tab switches and dock changes all emit on the
    // bus) — pause right away instead of waiting out the DOM grace period.
    // The short delay lets the action that legitimately completes this step
    // win the race and advance it first.
    const subscribe = subscribeToActions
      ?? ((listener: (action: TutorialObservedAction) => void) => tutorialActionBus.subscribe(listener));
    const unsubscribe = subscribe((observed) => {
      // The action that completes this step may itself remove the anchor
      // (Insert preset closes the picker the button lives in); that is the
      // step succeeding, not the learner wandering off.
      const step = flatSteps[stepIndex]?.step;
      if (step?.action && actionMatcher(step.action, observed, aliases)) return;
      const timer = window.setTimeout(() => {
        actionTimers.delete(timer);
        if (!active || currentStepRef.current?.id !== currentStep?.id) return;
        if (statusRef.current !== "waiting" && statusRef.current !== "showing") return;
        if (anchor.isConnected || findTutorialAnchor(anchor.ownerDocument, anchorId, domPolicyRef.current)) return;
        if (lostTimer !== null) window.clearTimeout(lostTimer);
        lostTimer = null;
        pauseForLostAnchor();
      }, 60);
      actionTimers.add(timer);
    });
    return () => {
      active = false;
      for (const timer of actionTimers) window.clearTimeout(timer);
      if (lostTimer !== null) window.clearTimeout(lostTimer);
      if (typeof unsubscribe === "function") unsubscribe();
      disconnect();
    };
  }, [currentStepRef, contextMismatch, actionMatcher, aliases, anchor, currentStep?.action, currentStep?.anchor?.id, currentStep?.anchor?.waitMs, currentStep?.id, domPolicyRef, flatSteps, manifestRef, mode, setStatus, statusRef, stepIndex, subscribeToActions]);

  useEffect(() => {
    if (contextMismatch || !currentStep?.anchor || !anchor || anchor !== document.body) return;
    const found = findTutorialAnchor(document, currentStep.anchor.id, domPolicyRef.current);
    if (found) setAnchor(found);
  }, [anchor, contextMismatch, currentStep?.anchor, domPolicyRef, state]);

  // While paused for a lost anchor, keep looking for it: the tutorial resumes
  // by itself when the learner returns to the surface it lives on.
  useEffect(() => {
    const anchorId = currentStep?.anchor?.id;
    if (status !== "error" || errorKind !== "anchor" || !anchorId) return;
    return observeTutorialAnchor(document, anchorId, (found) => {
      if (!found) return;
      setError(null);
      setStatus("idle");
    }, domPolicyRef.current);
  }, [currentStep?.anchor?.id, domPolicyRef, errorKind, setStatus, status]);

  // Escape dismisses the celebration card, matching the Escape that stops a
  // running tutorial: either way the key means "let me get back to work".
  useEffect(() => {
    if (status !== "complete" || completionDismissed) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      dismissCompletion();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [completionDismissed, dismissCompletion, status]);

  if (status === "complete") {
    if (!completionActions?.length || completionDismissed) return null;
    return (
      <div
        data-testid="tutorial-complete-backdrop"
        onClick={(event) => {
          // Only the backdrop itself dismisses; clicks inside the card bubble
          // through here too.
          if (event.target === event.currentTarget) dismissCompletion();
        }}
        style={{ position: "fixed", inset: 0, zIndex: 8200, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(15, 23, 42, 0.45)" }}
      >
        <CompletionConfetti />
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Finished ${manifest.title}`}
          data-testid="tutorial-complete"
          {...TUTORIAL_SURFACE_PROPS}
          style={{ position: "relative", width: "min(420px, calc(100vw - 32px))", padding: 20, border: "1px solid var(--tourkit-line-soft)", borderRadius: 14, background: "var(--tourkit-bg)", color: "var(--tourkit-ink)", boxShadow: "0 24px 60px rgba(15, 23, 42, .35)", textAlign: "center" }}
        >
          <style>{TUTORIAL_SURFACE_CSS}</style>
          <button
            type="button"
            onClick={dismissCompletion}
            aria-label="Dismiss"
            title="Dismiss — stay where you are"
            data-testid="tutorial-complete-dismiss"
            style={{ position: "absolute", top: 8, right: 8, display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, padding: 0, border: "1px solid transparent", borderRadius: 8, background: "transparent", color: "var(--tourkit-ink-3)", fontSize: 16, lineHeight: 1, cursor: "pointer" }}
          >
            <X size={15} aria-hidden />
          </button>
          <div aria-hidden style={{ fontSize: 34, lineHeight: 1 }}>🎉</div>
          <strong style={{ display: "block", marginTop: 10, fontSize: 16 }}>Nice work — you did it!</strong>
          <p style={{ margin: "8px 0 16px", fontSize: 13, lineHeight: 1.55, color: "var(--tourkit-ink-2)" }}>
            You finished all {flatSteps.length} steps of “{manifest.title}”. What would you like to do next?
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
            {completionActions.map((action) => (
              <button
                key={action.label}
                type="button"
                autoFocus={action.primary}
                onClick={action.onSelect}
                data-testid={action.primary ? "tutorial-complete-primary" : undefined}
                style={action.primary
                  ? { ...pausedButtonStyle, borderColor: "#0284c7", background: "#0284c7", color: "white", fontWeight: 600 }
                  : pausedButtonStyle}
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!currentStep || status === "stopped") return null;

  if (status === "resume-prompt" && pendingResume) {
    return (
      <div
        data-testid="tutorial-resume-backdrop"
        style={{ position: "fixed", inset: 0, zIndex: 8200, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(15, 23, 42, 0.45)" }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Resume ${manifest.title}?`}
          data-testid="tutorial-resume-prompt"
          {...TUTORIAL_SURFACE_PROPS}
          style={{ width: "min(420px, calc(100vw - 32px))", padding: 20, border: "1px solid var(--tourkit-line-soft)", borderRadius: 14, background: "var(--tourkit-bg)", color: "var(--tourkit-ink)", boxShadow: "0 24px 60px rgba(15, 23, 42, .35)" }}
        >
          <style>{TUTORIAL_SURFACE_CSS}</style>
          <strong style={{ fontSize: 16 }}>Welcome back</strong>
          <p style={{ margin: "8px 0 14px", fontSize: 13, lineHeight: 1.55, color: "var(--tourkit-ink-2)" }}>
            You were on step {pendingResume.stepIndex + 1} of {flatSteps.length} of “{manifest.title}”. Continue brings the workspace back to that step; starting over discards the saved progress.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" autoFocus onClick={continueSavedRun} data-testid="tutorial-resume-continue" style={{ ...pausedButtonStyle, borderColor: "#0284c7", background: "#0284c7", color: "white", fontWeight: 600 }}>
              Continue
            </button>
            <button type="button" onClick={restartSavedRun} data-testid="tutorial-resume-restart" style={pausedButtonStyle}>
              Start over
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!anchor) {
    if (status === "error") {
      const returnAction = errorKind === "anchor" && currentStep && onExecuteAction
        ? resolveReturnAction?.(currentStep) ?? null
        : null;
      const takeMeBack = returnAction
        ? () => {
            void (async () => {
              try {
                await onExecuteAction!(returnAction, {
                  manifest,
                  step: currentStep,
                  stepIndex,
                  signal: new AbortController().signal,
                });
                setError(null);
                setStatus("idle");
              } catch {
                // The surface could not be restored; the card stays up and
                // auto-resume keeps watching.
              }
            })();
          }
        : null;
      return (
        <div role="alert" data-testid="tutorial-error" {...TUTORIAL_SURFACE_PROPS} style={{ position: "fixed", right: 16, bottom: 16, zIndex: 8200, width: 340, padding: 16, border: "1px solid var(--tourkit-line-soft)", borderRadius: 12, background: "var(--tourkit-bg)", color: "var(--tourkit-ink)", boxShadow: "0 16px 40px rgba(15, 23, 42, .25)" }}>
          <style>{TUTORIAL_SURFACE_CSS}</style>
          <strong>{labels.errorTitle}</strong>
          <p style={{ margin: "8px 0 4px", fontSize: 13, color: "var(--tourkit-ink-2)" }}>{error}</p>
          <p style={{ margin: "0 0 12px", fontSize: 12, color: "var(--tourkit-ink-3)" }}>
            {errorKind === "anchor" ? labels.errorAnchorHelp : labels.errorStepHelp}
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {takeMeBack ? (
              <button type="button" onClick={takeMeBack} data-testid="tutorial-return" style={{ ...pausedButtonStyle, borderColor: "#0284c7", background: "#0284c7", color: "white", fontWeight: 600 }}>
                {labels.takeMeBack}
              </button>
            ) : (
              <button type="button" onClick={() => setStatus("idle")} style={{ ...pausedButtonStyle, borderColor: "#0284c7", background: "#0284c7", color: "white", fontWeight: 600 }}>
                {labels.retry}
              </button>
            )}
            <button type="button" onClick={next} style={pausedButtonStyle}>{labels.skipStep}</button>
            <button type="button" onClick={stop} style={pausedButtonStyle}>{labels.stopTutorial}</button>
          </div>
        </div>
      );
    }
    return <span data-testid="tutorial-locating" role="status" className="sr-only">Preparing tutorial step {stepIndex + 1}</span>;
  }

  // Practice mode is only practice if the step cannot be clicked past, so the
  // advance control is withheld until the learner completes the action. A
  // revisited step is the exception: its outcome is already in the workspace.
  const gateAdvance = mode === "practice"
    && currentStep.completion !== "continue"
    && !revisiting
    && (status === "waiting" || (status === "paused" && resumeStatus === "waiting"));
  const regressedFlat = regressedIndex !== null ? flatSteps[regressedIndex] : null;
  const regressionCard = regressedFlat && (status === "waiting" || status === "showing") ? (
    <div
      role="status"
      data-testid="tutorial-regression"
      {...TUTORIAL_SURFACE_PROPS}
      style={{ position: "fixed", right: 16, bottom: 16, zIndex: 8300, width: 340, padding: 16, border: "1px solid var(--tourkit-line-soft)", borderRadius: 12, background: "var(--tourkit-bg)", color: "var(--tourkit-ink)", boxShadow: "0 16px 40px rgba(15, 23, 42, .25)" }}
    >
      <style>{TUTORIAL_SURFACE_CSS}</style>
      <strong>An earlier step came undone</strong>
      <p style={{ margin: "8px 0 4px", fontSize: 13, color: "var(--tourkit-ink-2)" }}>
        Step {regressedIndex! + 1}, “{regressedFlat.step.overlay.title}”, needs: {regressedFlat.step.check?.description}
      </p>
      <p style={{ margin: "0 0 12px", fontSize: 12, color: "var(--tourkit-ink-3)" }}>
        Take me back reopens that step; once it is fixed you return right here.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button
          type="button"
          data-testid="tutorial-regression-return"
          onClick={() => {
            const repairIndex = regressedIndex!;
            const resumeIndex = stepIndex;
            setRegressedIndex(null);
            // The repaired step is graded again, not revisited: its outcome
            // is exactly what came undone.
            const repairedStepId = regressedFlat.step.id;
            setCompletedSteps((current) => {
              if (!current.has(repairedStepId)) return current;
              const next = new Set(current);
              next.delete(repairedStepId);
              return next;
            });
            satisfiedStepsRef.current.delete(regressedFlat.step.id);
            goTo(repairIndex);
            returnAfterRepairRef.current = resumeIndex;
          }}
          style={{ ...pausedButtonStyle, borderColor: "#0284c7", background: "#0284c7", color: "white", fontWeight: 600 }}
        >
          Take me back
        </button>
        <button
          type="button"
          data-testid="tutorial-regression-dismiss"
          onClick={() => {
            mutedRegressionsRef.current.add(regressedFlat.step.id);
            setRegressedIndex(null);
          }}
          style={pausedButtonStyle}
        >
          Keep going
        </button>
      </div>
    </div>
  ) : null;
  return (
    <>
    {regressionCard}
    <TutorialOverlay
      domPolicy={domPolicy}
      highlightStyle={highlightStyle}
      anchor={contextMismatch ? document.body : anchor}
      step={currentStep}
      stepIndex={stepIndex}
      stepCount={flatSteps.length}
      tutorialTitle={manifest.title}
      mode={mode}
      spotlightStyle={spotlightStyle}
      interaction={interaction}
      cardLayout={cardLayout}
      targetId={contextMismatch ? null : currentStep.target?.id ?? null}
      status={status}
      suspended={suspended}
      suspensionReason={suspensionReason}
      onRestoreView={currentStep.context && onExecuteAction && resolveContextActions(currentStep.context).length ? async () => {
        const signal = new AbortController().signal;
        try {
          setError(null);
          for (const action of resolveContextActions(currentStep.context!)) await onExecuteAction(action, { manifest, step: currentStep, stepIndex, signal });
        } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to restore this view."); }
      } : undefined}
      error={error}
      gateAdvance={gateAdvance}
      revisiting={revisiting}
      alreadyDone={alreadyDone && status === "showing"}
      readyToFinish={readyToFinish}
      autoplayDurationMs={mode === "autoplay" ? autoplayStepDurationMs(currentStep) : null}
      autoplayProgressActive={mode === "autoplay" && narrationComplete}
      onPrevious={previous}
      onNext={guardedNext}
      onTogglePause={togglePause}
      onStop={stop}
      onNarrationComplete={() => setNarrationComplete(true)}
      hintDelayMs={hintDelayMs}
      transitionMs={transitionMs}
      labels={labels}
      appearance={appearance}
      keyboardNavigation={keyboardNavigation}
      renderCard={renderCard}
    />
    </>
  );
}


