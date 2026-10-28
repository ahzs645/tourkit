import type { TutorialStep } from "../core/schema";

export const SEMANTIC_APPLICATION_DIALOG_SELECTOR = [
  "dialog[open]", '[aria-modal="true"]', '[role="dialog"][data-state="open"]',
].join(", ");

/** Host DOM/snapshot conventions, passed per player rather than registered globally. */
export interface TutorialDomPolicy {
  /** Selects semantic modals that block outside controls and own Escape. */
  applicationDialogSelector: string;
  /** Optional foreground windows used to disambiguate repeated anchors, not to block outside input. */
  floatingWindowSelector?: string;
  /** Whether a step's outcome deliberately expects a dialog to open around an outside anchor. */
  stepExpectsDialog: (step: TutorialStep) => boolean;
}

/** ARIA/native-dialog discovery only; no host CSS or snapshot-key assumptions. */
export const NEUTRAL_TUTORIAL_DOM_POLICY: TutorialDomPolicy = Object.freeze({
  applicationDialogSelector: SEMANTIC_APPLICATION_DIALOG_SELECTOR,
  stepExpectsDialog: () => false,
});

/** For desktop emulators that draw `.pb-window` floating windows and report `surfaces.*` outcomes. */
export const LEGACY_TUTORIAL_DOM_POLICY: TutorialDomPolicy = Object.freeze({
  ...NEUTRAL_TUTORIAL_DOM_POLICY,
  floatingWindowSelector: ".pb-modal-layer > .pb-window",
  stepExpectsDialog: (step: TutorialStep) => (step.check?.all ?? []).some((clause) => clause.path === "surfaces" || clause.path.startsWith("surfaces.")),
});

/** Existing consumers keep their behavior; new hosts can explicitly select the neutral policy. */
export const DEFAULT_TUTORIAL_DOM_POLICY = LEGACY_TUTORIAL_DOM_POLICY;
