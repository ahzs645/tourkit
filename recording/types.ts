import type {
  TutorialFocusHighlight,
  TutorialCardLayout,
  TutorialCardPlacement,
  TutorialCheck,
  TutorialInteraction,
  TutorialLaunch,
  TutorialLevel,
  TutorialMode,
  TutorialSpotlightStyle,
  TutorialSemanticAction,
  TutorialScreenshotMode,
  TutorialContentKind,
  TutorialViewContext,
  TutorialStepCompletion,
  TutorialTrack,
  TutorialValue,
  TutorialSetup
} from "../core/schema";
import type { TutorialScreenshot } from "../core/screenshot";

export type { TutorialCheck, TutorialMode, TutorialSemanticAction, TutorialValue };
export type TutorialJsonValue = TutorialValue;

export interface TutorialRecordedAction {
  context?: TutorialViewContext;
  id: string;
  args?: Readonly<Record<string, TutorialValue>>;
  resultAlias?: string;
  anchor?: string;
  label?: string;
  atMs: number;
}

export type TutorialRecorderAction = Omit<TutorialRecordedAction, "atMs">;
export type SubscribeToTutorialActions = (
  listener: (action: TutorialRecorderAction) => void
) => void | (() => void);

export interface TutorialVisualReference {
  kind: string;
  version: number;
  data: TutorialValue;
}

export interface TutorialAudioTrack {
  blob: Blob;
  mimeType: string;
  durationMs: number;
}

export interface TutorialCapture {
  startedAt: string;
  durationMs: number;
  actions: TutorialRecordedAction[];
  audio?: TutorialAudioTrack;
  visualReference?: TutorialVisualReference;
  warnings: string[];
}

export interface TutorialRecordingNarrationRange {
  startMs: number;
  endMs: number;
  transcript?: string;
}

export type TutorialAnchorPlacement = "auto" | "top" | "right" | "bottom" | "left" | "center";

/** Step-level card override; unset fields inherit the draft's card layout. */
export interface TutorialRecordingCardOverride {
  placement?: TutorialCardPlacement;
  size?: "default" | "large";
  pointer?: boolean;
}

export interface TutorialRecordingChapter {
  id: string;
  title: string;
  description?: string;
}

/**
 * One editable step. Everything the canonical step schema can express is
 * here, so a built-in manifest survives a trip through the studio unchanged;
 * the optional fields fall back to the schema defaults on export.
 */
export interface TutorialRecordingStep {
  highlights?: TutorialFocusHighlight[];
  completion?: TutorialStepCompletion;
  context?: TutorialViewContext;
  screenshot?: TutorialScreenshot;
  screenshotMode?: TutorialScreenshotMode;
  contentKind?: TutorialContentKind;
  pageBreakBefore?: boolean;
  id: string;
  atMs: number;
  /** Card heading (the manifest's overlay.title). */
  title: string;
  /** Card body (the manifest's overlay.body). */
  instruction: string;
  /** The manifest's optional step.title, kept apart from the card heading. */
  label?: string;
  /** Chapter this step belongs to; missing means the draft's first chapter. */
  chapterId?: string;
  anchor?: string;
  anchorPlacement?: TutorialAnchorPlacement;
  anchorWaitMs?: number;
  /** The one control to ring when it differs from the anchor region. */
  target?: string;
  mode: TutorialMode;
  spotlightStyle?: TutorialSpotlightStyle;
  interaction?: TutorialInteraction;
  card?: TutorialRecordingCardOverride;
  showProgress?: boolean;
  advanceDelayMs?: number;
  action?: TutorialSemanticAction;
  /** Outcome the practice gate waits for. Suggested from the recorded action. */
  check?: TutorialCheck;
  narration?: TutorialRecordingNarrationRange;
}

/** Editable studio model. It compiles to the canonical chapter-based manifest. */
export interface TutorialRecordingDraft {
  setup?: TutorialSetup;
  schemaVersion: 1;
  id: string;
  title: string;
  description: string;
  chapters: TutorialRecordingChapter[];
  createdAt: string;
  updatedAt: string;
  durationMs: number;
  syntheticDataOnly: true;
  track: TutorialTrack;
  level: TutorialLevel;
  estimatedMinutes: number;
  prerequisites: string[];
  listed: boolean;
  docs?: string;
  defaultMode: TutorialMode;
  spotlightStyle: TutorialSpotlightStyle;
  interaction: TutorialInteraction;
  card: TutorialCardLayout;
  launch: TutorialLaunch;
  steps: TutorialRecordingStep[];
  audio?: TutorialAudioTrack;
  visualReference?: TutorialVisualReference;
}

