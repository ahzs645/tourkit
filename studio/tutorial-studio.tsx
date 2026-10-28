"use client";

import { nextTutorialHighlightId } from "../core/highlight";
import type { FocusPickRequest } from "./step-focus-highlights";
import { tutorialContextMatches, type TutorialViewState } from "../core/view-context";
import { useLatestRef } from "../shared/use-latest-ref";
import { BuilderSelect } from "../ui/builder-select";
import {
  ChevronDown,
  Copy,
  Eye,
  RotateCcwClock,
  Redo2,
  Undo2,
  Download,
  FolderOpen,
  LayoutGrid,
  Link2,
  Mic,
  MoreHorizontal,
  MousePointerClick,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  Play,
  Plus,
  Save,
  Square,
  Trash2,
  Upload,
  ZoomIn,
  ZoomOut,
  MessageSquareText
} from "lucide-react";
import {
  type ChangeEvent,
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore
} from "react";

import clsx from "clsx";

import { Button } from "../ui/button";
import { TutorialExportDialog } from "../components/tutorial-export-dialog";
import { TutorialShareDialog } from "../components/tutorial-share-dialog";
import { captureTutorialInterface } from "../recording/capture-interface";
import { captureMissingTutorialScreenshots } from "../recording/capture-all";
import { screenshotIsStale, stampTutorialScreenshot } from "../core/screenshot";
import { findTutorialAnchor, resolveRingElement, visibleBoxOf, waitForTutorialAnchor } from "../player/anchor";
import { screenshotFingerprintForStep, screenshotSelectionReplayDraft } from "./screenshot-review";
import { Modal } from "../ui/modal";
import { Checkbox } from "../ui/checkbox";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { ContextMenu, type ContextMenuItem } from "../ui/context-menu";
import { PanelResizeHandle } from "../ui/panel-resize-handle";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import {
  createTutorialIframeController,
  type TutorialIframeController
} from "../player";
import { buildTutorialLaunchUrl, type TutorialManifest, type TutorialMode } from "../core/schema";

import {
  readTutorialNarrationMode,
  writeTutorialNarrationMode,
  type TutorialNarrationMode,
} from "../recording/narration-mode";
import {
  addDraftChapter,
  mergeCaptureIntoDraft,
  buildTutorialAiEditingPrompt,
  clearDraftRecording,
  deleteDraftChapter,
  deleteDraftStep,
  deserializeTutorialRecordingDraft,
  duplicateDraftStep,
  insertDraftStep,
  moveDraftChapter,
  moveDraftStep,
  moveDraftStepTo,
  normalizeTutorialRecordingDraft,
  serializeTutorialRecordingDraft,
  splitDraftStep,
  stepChapterId,
  subscribeToSemanticActionSource,
  subscribeToTutorialActionBus,
  suggestedCheckForStep,
  tutorialManifestToRecordingDraft,
  TutorialRecorder,
  tutorialRecordingDraftToManifest,
  updateDraftChapter,
  updateDraftStep,
  type SubscribeToTutorialActions,
  type TutorialDraftStore,
  type TutorialDraftSummary,
  type TutorialRecorderAction,
  type TutorialRecordingStep,
  type TutorialRecordingDraft,
  type TutorialRecordingPlacement,
  type TutorialVisualRecorderAdapter
} from "../recording";

import { LessonSetupEditor } from "./lesson-setup-editor";
import { CARD_PLACEMENTS, CARD_SIZES, ChaptersEditor, Field, JsonInput, StepEditor, formatTime } from "./step-editor";
import {
  clearStageOverlay,
  readStageOverlayOptions,
  syncStageOverlay,
  writeStageOverlayOptions,
  DEFAULT_STAGE_OVERLAY_OPTIONS,
  type StageOverlayOptions,
} from "./stage-overlay";
import { StepRail, type AnchorRect } from "./step-rail";
import { createBlankStudioDraft, STUDIO_VERSION_PREFIX, studioHref } from "./studio-drafts";
import { Timeline } from "./timeline";
import { createLatestStepNavigation } from "./step-navigation";
import { tutorialSeekEntries } from "../core/stage-seek";

import { useTutorialStudioEnvironment, useEnvironmentTutorial, useEnvironmentTutorials } from "./environment";

type PanelTab = "steps" | "chapters" | "library" | "settings";
const PANEL_TABS: ReadonlyArray<{ id: PanelTab; label: string }> = [
  { id: "steps", label: "Steps" },
  { id: "chapters", label: "Chapters" },
  { id: "library", label: "Library" },
  { id: "settings", label: "Settings" },
];

const VERSION_PREFIX = STUDIO_VERSION_PREFIX;
const VERSIONS_KEPT = 20;
const VERSION_INTERVAL_MS = 5 * 60_000;
const HISTORY_LIMIT = 100;
const AUTOSAVE_DELAY_MS = 800;

function versionIdFor(draftId: string, at: number): string {
  return `${VERSION_PREFIX}${draftId}:${at}`;
}
function versionsOf(entries: TutorialDraftSummary[], draftId: string): TutorialDraftSummary[] {
  const prefix = `${VERSION_PREFIX}${draftId}:`;
  return entries.filter((entry) => entry.id.startsWith(prefix)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** True while typing in a field, when shortcuts must stay out of the way. */
function isEditingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || typeof element.closest !== "function") return false;
  const tag = element.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || element.isContentEditable || Boolean(element.closest('[role="listbox"], [role="menu"], [role="dialog"]'));
}

/**
 * A toolbar button's words, folded to the icon below `from` so the toolbar
 * stays one row; the button keeps the words as its aria-label.
 */
const LABEL_FROM = { xl: "hidden xl:inline", "2xl": "hidden 2xl:inline" } as const;
const PAD_BELOW = { xl: "max-xl:px-2.5", "2xl": "max-2xl:px-2.5" } as const;
function toolbarLabel(label: string, from: keyof typeof LABEL_FROM = "2xl") {
  return {
    "aria-label": label,
    title: label,
    className: PAD_BELOW[from],
    children: <span className={LABEL_FROM[from]}>{label}</span>
  };
}

/** Where a toolbar menu opens: just under the button that asked for it. */
function menuAnchor(element: HTMLElement): { x: number; y: number } {
  const rect = element.getBoundingClientRect();
  return { x: rect.left, y: rect.bottom + 4 };
}

/** The launch hash without the studio's own authoring flag, for the editor. */
function editableHash(hash: Record<string, string | number | boolean>): string {
  const { tutorialAuthor: _authoring, ...rest } = hash;
  return JSON.stringify(rest);
}

const PANEL_WIDTH_KEY = "tourkit:studio-panel-width";
const PANEL_WIDTH_DEFAULT = 480;
const PANEL_WIDTH_MIN = 320;
const PANEL_WIDTH_MAX = 960;
const PANEL_HIDDEN_KEY = "tourkit:studio-panel-hidden";
const TIMELINE_COLLAPSED_KEY = "tourkit:studio-timeline-collapsed";
const FOLLOW_STEP_VIEW_KEY = "tourkit:studio-follow-step-view";
/** Same-tab notice that a remembered layout setting changed. */
const LAYOUT_EVENT = "tourkit:studio-panel-width";

function clampPanelWidth(value: number): number {
  return Math.min(PANEL_WIDTH_MAX, Math.max(PANEL_WIDTH_MIN, Math.round(value)));
}

function readPanelWidth(): number {
  try {
    const stored = Number(window.localStorage.getItem(PANEL_WIDTH_KEY));
    return Number.isFinite(stored) && stored > 0 ? clampPanelWidth(stored) : PANEL_WIDTH_DEFAULT;
  } catch {
    return PANEL_WIDTH_DEFAULT;
  }
}

function subscribeLayout(listener: () => void): () => void {
  window.addEventListener("storage", listener);
  window.addEventListener(LAYOUT_EVENT, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(LAYOUT_EVENT, listener);
  };
}

/**
 * Width of the settings/steps panel, remembered per browser. Read through an
 * external store so the server renders the default and the client adopts the
 * stored width after hydration without a markup mismatch.
 */
function usePanelWidth(): [number, (width: number) => void] {
  const width = useSyncExternalStore(subscribeLayout, readPanelWidth, () => PANEL_WIDTH_DEFAULT);
  const setWidth = useCallback((next: number) => {
    try {
      window.localStorage.setItem(PANEL_WIDTH_KEY, String(clampPanelWidth(next)));
    } catch {
      // Storage may be unavailable; the panel simply keeps its default width.
    }
    window.dispatchEvent(new Event(LAYOUT_EVENT));
  }, []);
  return [width, setWidth];
}

/** A layout choice remembered per browser like the width; null when never set (or cleared). */
function useStoredString(key: string): [string | null, (next: string | null) => void] {
  const value = useSyncExternalStore(
    subscribeLayout,
    () => {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    () => null
  );
  const setValue = useCallback(
    (next: string | null) => {
      try {
        if (next === null) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, next);
      } catch {
        // Storage may be unavailable; the layout then keeps its defaults.
      }
      window.dispatchEvent(new Event(LAYOUT_EVENT));
    },
    [key]
  );
  return [value, setValue];
}

/** An on/off layout choice (panel hidden, timeline folded). */
function useStoredFlag(key: string): [boolean, (next: boolean) => void] {
  const [value, setValue] = useStoredString(key);
  return [value === "1", useCallback((next: boolean) => setValue(next ? "1" : null), [setValue])];
}

/**
 * How large the stage is drawn. "fit" shrinks a stage that paints a fixed
 * window (a desktop emulator) until the whole window shows, and is 100% otherwise; a number
 * is a fixed zoom. Zoom only scales the frame: the interface inside lays out
 * at the larger size, so overlays, picking and capture stay in its own
 * coordinates.
 */
type StageZoom = "fit" | number;
const STAGE_ZOOM_KEY = "tourkit:studio-stage-zoom";
const STAGE_ZOOM_LEVELS = [0.5, 0.67, 0.75, 0.9, 1];
const STAGE_ZOOM_MIN = STAGE_ZOOM_LEVELS[0];
/** Desktop left around a fitted window, per side. */
const STAGE_FIT_MARGIN = 16;

function parseStageZoom(raw: string | null): StageZoom {
  const value = Number(raw);
  return raw !== null && STAGE_ZOOM_LEVELS.includes(value) ? value : "fit";
}

function formatZoom(zoom: number): string {
  return `${Math.round(zoom * 100)}%`;
}

/** The zoom that shows the whole window in a box, never above 100%. */
export function fitStageZoom(
  box: { width: number; height: number } | null,
  windowSize: { width: number; height: number } | undefined
): number {
  if (!box || !windowSize) return 1;
  const zoom = Math.min(
    1,
    box.width / (windowSize.width + 2 * STAGE_FIT_MARGIN),
    box.height / (windowSize.height + 2 * STAGE_FIT_MARGIN)
  );
  return Math.max(STAGE_ZOOM_MIN, Math.floor(zoom * 100) / 100);
}

export interface TutorialStudioProps {
  initialDraft?: TutorialRecordingDraft;
  /** Explicit selection for controlled workspaces. Undefined keeps the legacy ?open= behavior. */
  openDraftId?: string | null;
  /** Defaults to the canonical application action bus. */
  subscribeToActions?: SubscribeToTutorialActions;
  /** Optional root-app URL. When omitted it is derived from draft.launch. */
  sourceUrl?: string | ((draft: TutorialRecordingDraft) => string);
  draftStore?: TutorialDraftStore;
  visualRecorder?: TutorialVisualRecorderAdapter;
  className?: string;
  /** Leading toolbar content, such as the host page's back link. */
  toolbarStart?: ReactNode;
  toolbarEnd?: ReactNode;
  onDraftChange?: (draft: TutorialRecordingDraft) => void;
}

/**
 * Local-first authoring studio for recording voice and semantic builder actions.
 * The iframe is a real synthetic fixture; audio capture remains in the parent.
 */
export function TutorialStudio({
  initialDraft,
  openDraftId,
  subscribeToActions,
  sourceUrl,
  draftStore,
  visualRecorder,
  className,
  toolbarStart,
  toolbarEnd,
  onDraftChange
}: TutorialStudioProps) {
  const environment = useTutorialStudioEnvironment();
  const {
    builtInTutorials: BUILT_IN_TUTORIALS, tracks: TUTORIAL_TRACKS,
    isDeferredTutorialId: isCihTutorialId, loadTutorial: loadBuiltInTutorial,
    stages: HOST_EMULATOR_MANIFESTS, defaultStageId: WORKSPACE_STAGE,
    defaultSnapshotPaths: WORKSPACE_SNAPSHOT_PATHS,
    getStage: getHostEmulatorManifest, launchForStage, stageOfLaunch,
    readPreferredStage: readTutorialStageSetting, writePreferredStage: writeTutorialStageSetting,
    resolvePath: resolveAppPath, viewContext: tutorialViewContext, selectedStepView,
  } = environment;
  const StudioReviewHost = environment.review?.Host;
  const store = useMemo(() => draftStore ?? environment.createDraftStore(), [draftStore, environment]);
  const [draft, setDraftState] = useState<TutorialRecordingDraft>(
    () => initialDraft ?? environment.createInitialDraft?.() ?? environment.createDraft()
  );
  const initialDraftIdRef = useRef(draft.id);
  const requestedDraftIdRef = useRef(openDraftId);
  // Where the draft records and plays: the builder workspace or a host
  // emulator. The choice lives in the draft's launch so exports carry it.
  const stage = stageOfLaunch(draft.launch);
  const hostManifest = getHostEmulatorManifest(stage);
  // Voice or actions-only; a browser-local default read after mount so the
  // server render and the first client render agree.
  const [narrationMode, setNarrationMode] = useState<TutorialNarrationMode>("voice");
  useEffect(() => setNarrationMode(readTutorialNarrationMode()), []);
  // Toolbar menus: the Record button's mode choice, and Open (new / saved / built-in).
  const [recordMenu, setRecordMenu] = useState<{ x: number; y: number } | null>(null);
  const [openMenu, setOpenMenu] = useState<{ x: number; y: number } | null>(null);
  const [savedDrafts, setSavedDrafts] = useState<TutorialDraftSummary[]>([]);
  const [status, setStatus] = useState<"idle" | "starting" | "recording" | "paused" | "stopping" | "capturing" | "navigating">("idle");
  const recordingPlacementRef = useRef<TutorialRecordingPlacement>("replace");
  const latestDraftRef = useLatestRef(draft);
  const [screenshotsOpen, setScreenshotsOpen] = useState(false);
  const [selectedScreenshotIds, setSelectedScreenshotIds] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => setSelectedScreenshotIds(new Set()), [draft.id]);
  const screenshotCaptureRef = useRef<AbortController | null>(null);
  useEffect(() => () => screenshotCaptureRef.current?.abort(), []);
  const [message, setMessage] = useState("Ready to record a synthetic tutorial fixture.");
  const [exportOpen, setExportOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [pickingStepId, setPickingStepId] = useState<string | null>(null);
  const [focusPicker, setFocusPicker] = useState<(FocusPickRequest & { stepId: string }) | null>(null);
  const [fixtureAnchors, setFixtureAnchors] = useState<ReadonlySet<string>>(new Set());
  const [anchorRects, setAnchorRects] = useState<ReadonlyMap<string, AnchorRect>>(new Map());
  // In-frame preview: the real player runs the saved draft in the stage,
  // from the focused step (earlier steps caught up) or from the start.
  const [preview, setPreview] = useState<{ mode: TutorialMode; fromStepId: string | null; nonce: number } | null>(null);
  const [previewMode, setPreviewMode] = useState<TutorialMode | null>(null);
  // Undo/redo over whole drafts; consecutive edits within a beat coalesce so
  // typing a title is one undo, not one per keystroke.
  const pastRef = useRef<TutorialRecordingDraft[]>([]);
  const futureRef = useRef<TutorialRecordingDraft[]>([]);
  const lastEditAtRef = useRef(0);
  const [historySize, setHistorySize] = useState({ past: 0, future: 0 });
  const [saveState, setSaveState] = useState<{ status: "saved" | "saving" | "dirty" | "error"; at?: number }>({ status: "saved" });
  const lastVersionAtRef = useRef(0);
  const [versionMenu, setVersionMenu] = useState<{ x: number; y: number } | null>(null);
  const [versions, setVersions] = useState<TutorialDraftSummary[]>([]);
  // A stage change asked for while the draft has content; confirmed below.
  const [pendingStage, setPendingStage] = useState<string | null>(null);
  const [panelWidth, setPanelWidth] = usePanelWidth();
  // The stage gets the whole width while the panel is hidden, and the
  // timeline can fold to its header line; both are remembered per browser.
  const [panelHidden, setPanelHidden] = useStoredFlag(PANEL_HIDDEN_KEY);
  const [timelineCollapsed, setTimelineCollapsed] = useStoredFlag(TIMELINE_COLLAPSED_KEY);
  const [followStepViewSetting, setFollowStepViewSetting] = useStoredString(FOLLOW_STEP_VIEW_KEY);
  const followStepView = followStepViewSetting !== "0";
  const [moreMenu, setMoreMenu] = useState<{ x: number; y: number } | null>(null);
  // Stage zoom, remembered per stage. The box is measured so Fit can follow
  // it; a stage that paints a fixed window waits for that measurement, since
  // the window takes its size once, when it opens.
  const [storedZoom, setStoredZoom] = useStoredString(`${STAGE_ZOOM_KEY}:${stage}`);
  const stageZoom = parseStageZoom(storedZoom);
  const stageBoxRef = useRef<HTMLDivElement>(null);
  const [stageBox, setStageBox] = useState<{ width: number; height: number } | null>(null);
  // Bumped when an explicit zoom change should reopen the stage (see changeStageZoom).
  const [stageEpoch, setStageEpoch] = useState(0);
  useLayoutEffect(() => {
    const box = stageBoxRef.current;
    if (!box) return;
    const measure = () => {
      const width = box.clientWidth;
      const height = box.clientHeight;
      if (width <= 0 || height <= 0) return;
      setStageBox((previous) => (previous && previous.width === width && previous.height === height ? previous : { width, height }));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);
  const windowSize = hostManifest?.windowSize;
  const fitZoom = fitStageZoom(stageBox, windowSize);
  const zoom = stageZoom === "fit" ? fitZoom : stageZoom;
  const stageReady = stageBox !== null || !windowSize || typeof ResizeObserver === "undefined";
  const [audioUrl, setAudioUrl] = useState<string>();
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioTimeMs, setAudioTimeMs] = useState(0);
  // The panel shows one thing at a time: a tab, and within Steps one focused
  // step (or every editor, on request).
  const [panelTab, setPanelTab] = useState<PanelTab>("steps");
  const [liveView, setLiveView] = useState<TutorialViewState>({});
  const liveViewRef = useRef<TutorialViewState>({});
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [expandAll, setExpandAll] = useState(false);
  // What the stage draws on top of the fixture while authoring; per browser.
  const [overlay, setOverlay] = useState<StageOverlayOptions>(DEFAULT_STAGE_OVERLAY_OPTIONS);
  useEffect(() => setOverlay(readStageOverlayOptions()), []);
  const updateOverlay = (patch: Partial<StageOverlayOptions>) =>
    setOverlay((current) => {
      const next = { ...current, ...patch };
      writeStageOverlayOptions(next);
      return next;
    });
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const iframeControllerRef = useRef<TutorialIframeController | null>(null);
  const connectedFrameRef = useRef<HTMLIFrameElement | null>(null);
  const pendingStepViewRef = useRef<{ stepId: string; draftId: string } | null>(null);
  const stepNavigationRef = useRef<ReturnType<typeof createLatestStepNavigation> | null>(null);
  /** The replay the stage last finished, and the view it left, to skip a repeat seek. */
  const seekedRef = useRef<{ frame: HTMLIFrameElement | null; key: string; view: string } | null>(null);
  const actionListenersRef = useRef(new Set<(action: TutorialRecorderAction) => void>());
  const recorderRef = useRef<TutorialRecorder | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  // State setters must not run inside another setter's updater (React re-runs
  // updaters during render, which turns a second setState into a loop), so
  // the updater only records what happened in refs and the bookkeeping
  // state follows in a microtask.
  const editedRef = useRef(false);
  const afterDraftEdit = useCallback(() => {
    window.queueMicrotask(() => {
      if (!editedRef.current) return;
      editedRef.current = false;
      setHistorySize({ past: pastRef.current.length, future: futureRef.current.length });
      setSaveState((state) => (state.status === "saving" ? state : { status: "dirty", at: state.at }));
    });
  }, []);

  const setDraft = useCallback(
    (next: TutorialRecordingDraft | ((current: TutorialRecordingDraft) => TutorialRecordingDraft), options: { history?: boolean } = {}) => {
      setDraftState((current) => {
        const resolved = typeof next === "function" ? next(current) : next;
        if (resolved === current) return current;
        if (options.history !== false) {
          const now = Date.now();
          if (now - lastEditAtRef.current > 500 || pastRef.current.length === 0) {
            pastRef.current = [...pastRef.current.slice(-(HISTORY_LIMIT - 1)), current];
          }
          lastEditAtRef.current = now;
          futureRef.current = [];
        }
        editedRef.current = true;
        onDraftChange?.(resolved);
        afterDraftEdit();
        return resolved;
      });
    },
    [afterDraftEdit, onDraftChange]
  );

  const undo = useCallback(() => {
    setDraftState((current) => {
      const previous = pastRef.current.pop();
      if (!previous) return current;
      futureRef.current.push(current);
      lastEditAtRef.current = 0;
      editedRef.current = true;
      onDraftChange?.(previous);
      afterDraftEdit();
      return previous;
    });
  }, [afterDraftEdit, onDraftChange]);

  const redo = useCallback(() => {
    setDraftState((current) => {
      const next = futureRef.current.pop();
      if (!next) return current;
      pastRef.current.push(current);
      lastEditAtRef.current = 0;
      editedRef.current = true;
      onDraftChange?.(next);
      afterDraftEdit();
      return next;
    });
  }, [afterDraftEdit, onDraftChange]);

  // The Stage setting is a developer default for fresh drafts only; a draft
  // with recorded steps keeps the stage it was recorded on, and a saved copy
  // restored below brings its own launch.
  useEffect(() => {
    const preferred = readTutorialStageSetting();
    setDraftState((current) =>
      current.steps.length || stageOfLaunch(current.launch) === preferred
        ? current
        : { ...current, launch: launchForStage(preferred, current.launch) }
    );
  }, [launchForStage, readTutorialStageSetting, stageOfLaunch]);

  useEffect(() => {
    let active = true;
    // `?open=<id>` (from the library's card menu) opens a built-in tutorial,
    // or a saved draft with that id; otherwise the last local draft returns.
    const requested = requestedDraftIdRef.current !== undefined ? requestedDraftIdRef.current
      : typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("open");
    // A CIH lesson loads on demand, so the built-in lookup is async too.
    void Promise.all([store.get(requested ?? initialDraftIdRef.current), loadBuiltInTutorial(requested)]).then(([saved, builtIn]) => {
      if (!active) return;
      if (saved) {
        setDraftState(normalizeTutorialRecordingDraft(saved));
        setMessage(requested ? `Opened saved draft “${saved.title}”.` : `Restored local draft “${saved.title}”.`);
      } else if (builtIn) {
        setDraftState(tutorialManifestToRecordingDraft(builtIn));
        setMessage(`Editing the built-in tutorial “${builtIn.title}”. Export manifest and paste it into the catalog to ship changes.`);
      } else if (requested) {
        setMessage(`No tutorial or saved draft is called “${requested}”.`);
      }
    }).catch((error: unknown) => {
      if (!active) return;
      setMessage(error instanceof Error ? error.message : "The local tutorial draft could not be loaded.");
    });
    return () => {
      active = false;
    };
  }, [store, loadBuiltInTutorial]);

  useEffect(() => {
    const emit = (action: TutorialRecorderAction) => {
      for (const listener of actionListenersRef.current) listener(action);
    };
    const unsubscribe = subscribeToActions ? subscribeToActions(emit) : subscribeToTutorialActionBus(emit, environment.inferAnchor);
    return typeof unsubscribe === "function" ? unsubscribe : undefined;
  }, [subscribeToActions, environment.inferAnchor]);

  useEffect(() => {
    recorderRef.current = new TutorialRecorder({
      subscribeToActions: (listener) => {
        actionListenersRef.current.add(listener);
        return () => actionListenersRef.current.delete(listener);
      },
      visualRecorder
    });
    return () => recorderRef.current?.clear();
  }, [visualRecorder]);

  useEffect(() => {
    if (!draft.audio) {
      setAudioUrl(undefined);
      return;
    }
    const url = URL.createObjectURL(draft.audio.blob);
    setAudioUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [draft.audio]);

  const authoringUrl = useMemo(() => {
    if (typeof sourceUrl === "function") return sourceUrl(draft);
    if (sourceUrl) return sourceUrl;
    return buildTutorialLaunchUrl(draft.launch);
  }, [draft, sourceUrl]);

  // Previewing swaps the frame to the real runtime: the authoring flag goes,
  // the draft is named by id (resolved from this browser's draft store), a
  // nonce forces a fresh run, and tutorialStep starts it at the focused step.
  const resolvedSourceUrl = useMemo(() => {
    if (!preview) return authoringUrl;
    const { tutorialAuthor: _authoring, ...hash } = draft.launch.hash;
    const launch = buildTutorialLaunchUrl({ ...draft.launch, hash });
    const params = new URLSearchParams({
      tutorial: `draft:${draft.id}`,
      tutorialMode: preview.mode,
      tutorialRun: String(preview.nonce),
      ...(preview.fromStepId ? { tutorialStep: preview.fromStepId } : {}),
    });
    const base = typeof sourceUrl === "function" ? sourceUrl({ ...draft, launch: { ...draft.launch, hash } }) : launch;
    return `${base}${base.includes("#") ? "&" : "#"}${params.toString()}`;
  }, [authoringUrl, draft, preview, sourceUrl]);
  // Identity of the mounted stage frame; null until a windowed stage is measured.
  const stageFrameKey = stageReady ? `${resolvedSourceUrl}#${stageEpoch}` : null;

  const startPreview = async (fromStepId: string | null, mode: TutorialMode) => {
    if (status !== "idle") return;
    try {
      const manifest = tutorialRecordingDraftToManifest(draft); // Validate before launching.
      const playable = new Set(manifest.chapters.flatMap((chapter) => chapter.steps.map((step) => step.id)));
      const requested = fromStepId;
      if (fromStepId && !playable.has(fromStepId)) {
        const at = draft.steps.findIndex((step) => step.id === fromStepId);
        fromStepId = draft.steps.slice(at + 1).find((step) => playable.has(step.id))?.id ?? null;
        if (!fromStepId) { setMessage("This explanation belongs to the reading guide. There is no later playable step; use Preview all to preview the actions."); return; }
      }
      await store.put(draft);
      setSaveState({ status: "saved", at: Date.now() });
      setPreview({ mode, fromStepId, nonce: Date.now() });
      const index = fromStepId ? draft.steps.findIndex((step) => step.id === fromStepId) : -1;
      setMessage(
        requested && requested !== fromStepId ? `The explanation belongs to the reading guide. Previewing the next playable step (${index + 1}).`
          : index > 0
          ? `Previewing from step ${index + 1}: the player catches the earlier steps up first.`
          : "Previewing the whole tutorial in the stage."
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The draft is not a valid tutorial yet.");
    }
  };

  const stopPreview = () => {
    setPreview(null);
    setMessage("Back to authoring.");
  };

  const connectIframe = useCallback(() => {
    stepNavigationRef.current?.cancel();
    iframeControllerRef.current?.destroy();
    const iframe = iframeRef.current;
    if (!iframe) return;
    const controller = createTutorialIframeController(iframe);
    iframeControllerRef.current = controller;
    connectedFrameRef.current = iframe;
    liveViewRef.current = {}; setLiveView({});
    controller.subscribeView((state, ready) => { liveViewRef.current = ready ? state : {}; setLiveView(ready ? state : {}); });
    const subscribe = subscribeToSemanticActionSource(controller.subscribe, environment.inferAnchor);
    subscribe((action) => {
      for (const listener of actionListenersRef.current) listener(action);
    });
    setMessage((current) => (current.startsWith("Previewing") ? current : "Tutorial fixture loaded. Actions in the iframe can now be recorded."));
  }, [environment.inferAnchor]);

  // The fixture iframe is server-rendered, so it can finish loading before
  // hydration attaches a React onLoad handler — the studio would then sit
  // "ready to record" while never receiving a single action from the frame.
  // Bind natively and adopt a frame that has already loaded.
  useEffect(() => {
    // The frame element is keyed on its URL (and zoom reopenings), so rebind
    // whenever that key changes.
    void stageFrameKey;
    const iframe = iframeRef.current;
    if (!iframe) return;
    const onLoad = () => connectIframe();
    iframe.addEventListener("load", onLoad);
    const loaded = iframe.contentDocument;
    if (loaded && loaded.readyState === "complete" && loaded.location.href !== "about:blank") onLoad();
    return () => iframe.removeEventListener("load", onLoad);
  }, [connectIframe, stageFrameKey]);

  useEffect(() => () => { stepNavigationRef.current?.cancel(); iframeControllerRef.current?.destroy(); }, []);

  // Anchor validation is soft: it reports what the fixture shows *right now*,
  // and an anchor may legitimately live on a surface that is not open.
  useEffect(() => {
    const read = () => {
      const doc = iframeRef.current?.contentDocument;
      // A navigating stage briefly exposes a document with no root element.
      if (!doc?.documentElement) return;
      const ids = new Set<string>();
      const rects = new Map<string, AnchorRect>();
      const width = Math.max(1, doc.documentElement.clientWidth);
      const height = Math.max(1, doc.documentElement.clientHeight);
      doc.querySelectorAll("[data-tutorial-id]").forEach((element) => {
        const id = element.getAttribute("data-tutorial-id");
        if (!id) return;
        ids.add(id);
        const rect = element.getBoundingClientRect();
        if (rect.width > 0 || rect.height > 0) {
          rects.set(id, {
            x: Math.min(1, Math.max(0, rect.left / width)),
            y: Math.min(1, Math.max(0, rect.top / height)),
            w: Math.min(1, rect.width / width),
            h: Math.min(1, rect.height / height),
          });
        }
      });
      setFixtureAnchors((previous) => {
        if (previous.size === ids.size && [...ids].every((id) => previous.has(id))) return previous;
        return ids;
      });
      setAnchorRects((previous) => {
        if (previous.size === rects.size && [...rects].every(([id, rect]) => {
          const old = previous.get(id);
          return old && Math.abs(old.x - rect.x) < 0.01 && Math.abs(old.y - rect.y) < 0.01 && Math.abs(old.w - rect.w) < 0.01 && Math.abs(old.h - rect.h) < 0.01;
        })) return previous;
        return rects;
      });
    };
    read();
    const timer = window.setInterval(read, 1_000);
    return () => window.clearInterval(timer);
  }, []);

  // Focus selection stays active across clicks/drags, so a step can explain several areas.
  useEffect(() => {
    if (!focusPicker) return;
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    const preview = doc.createElement("div");
    preview.style.cssText = "position:fixed;pointer-events:none;background:rgba(250,204,21,.4);border:1px solid #ca8a04;z-index:2147483001;display:none;";
    doc.body.append(preview);
    let start: { x: number; y: number } | null = null;
    const reference = () => focusPicker.anchor ? findTutorialAnchor(doc, focusPicker.anchor) : null;
    const point = (event: MouseEvent, rect: DOMRect) => ({ x: Math.max(0, Math.min(1, (event.clientX - rect.x) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.y) / rect.height)) });
    const append = (target: import("../core/schema").TutorialFocusHighlight["target"], toggle = false) => {
      setDraft((current) => {
        const step = current.steps.find((item) => item.id === focusPicker.stepId);
        if (!step) return current;
        const existing = step.highlights ?? [];
        const duplicate = toggle ? existing.findIndex((item) => item.target.kind === "element" && item.target.anchor === target.anchor) : -1;
        const highlights = duplicate >= 0 ? existing.filter((_, i) => i !== duplicate) : existing.length >= 32 ? existing : [...existing,
          { id: nextTutorialHighlightId(existing), target, style: "box" as const, arrowFrom: "left" as const }];
        return updateDraftStep(current, focusPicker.stepId, { highlights: highlights.length ? highlights : undefined, context: tutorialViewContext(liveViewRef.current) });
      });
    };
    const click = (event: MouseEvent) => {
      event.preventDefault(); event.stopPropagation();
      if (focusPicker.kind !== "element") return;
      const el = (event.target as HTMLElement)?.closest?.("[data-tutorial-id]");
      const anchor = el?.getAttribute("data-tutorial-id"); if (anchor) append({ kind: "element", anchor }, true);
    };
    const down = (event: MouseEvent) => {
      event.preventDefault(); event.stopPropagation();
      if (focusPicker.kind !== "area") return;
      const area = reference(), rect = area?.getBoundingClientRect();
      if (!rect || rect.width < 1 || rect.height < 1 || event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return;
      start = point(event, rect);
    };
    const move = (event: MouseEvent) => {
      if (!start) return;
      const rect = reference()?.getBoundingClientRect(); if (!rect) return;
      const end = point(event, rect);
      Object.assign(preview.style, { display: "block", left: `${rect.x + Math.min(start.x, end.x) * rect.width}px`, top: `${rect.y + Math.min(start.y, end.y) * rect.height}px`, width: `${Math.abs(start.x - end.x) * rect.width}px`, height: `${Math.abs(start.y - end.y) * rect.height}px` });
    };
    const up = (event: MouseEvent) => {
      event.preventDefault(); event.stopPropagation();
      if (!start) return;
      const rect = reference()?.getBoundingClientRect();
      if (rect && focusPicker.anchor) {
        const end = point(event, rect), width = Math.abs(start.x - end.x), height = Math.abs(start.y - end.y);
        if (width * rect.width >= 3 && height * rect.height >= 3) append({ kind: "area", anchor: focusPicker.anchor, rect: { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width, height } });
      }
      start = null; preview.style.display = "none";
    };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); setFocusPicker(null); } };
    doc.addEventListener("click", click, true); doc.addEventListener("mousedown", down, true); doc.addEventListener("mousemove", move, true); doc.addEventListener("mouseup", up, true);
    doc.addEventListener("pointerdown", down, true); doc.addEventListener("pointermove", move, true); doc.addEventListener("pointerup", up, true);
    doc.addEventListener("keydown", key, true); window.addEventListener("keydown", key);
    setMessage(focusPicker.kind === "element" ? "Select several highlighted controls. Click again to remove one. Select Done or press Escape when finished." : `Drag several focus rectangles inside “${focusPicker.anchor}”. Select Done or press Escape when finished.`);
    return () => { preview.remove(); doc.removeEventListener("pointerdown", down, true); doc.removeEventListener("pointermove", move, true); doc.removeEventListener("pointerup", up, true); doc.removeEventListener("click", click, true); doc.removeEventListener("mousedown", down, true); doc.removeEventListener("mousemove", move, true); doc.removeEventListener("mouseup", up, true); doc.removeEventListener("keydown", key, true); window.removeEventListener("keydown", key); };
  }, [focusPicker, setDraft, tutorialViewContext]);

  // Click-to-pick: while a step is picking, the next click in the fixture is
  // captured (never delivered to the app) and resolved to the nearest
  // data-tutorial-id ancestor. Escape cancels.
  useEffect(() => {
    if (!pickingStepId) return;
    const doc = iframeRef.current?.contentDocument;
    if (!doc) {
      setPickingStepId(null);
      return;
    }
    let hovered: HTMLElement | null = null;
    // Duck-typed on purpose: the event target belongs to the iframe's realm,
    // where `instanceof Element` against this document's Element is false.
    const anchorOf = (target: EventTarget | null): HTMLElement | null => {
      const element = target as { closest?: (selector: string) => HTMLElement | null } | null;
      return typeof element?.closest === "function"
        ? element.closest("[data-tutorial-id]")
        : null;
    };
    const clearHover = () => {
      hovered?.style.removeProperty("outline");
      hovered?.style.removeProperty("outline-offset");
      hovered = null;
    };
    const onMove = (event: MouseEvent) => {
      const next = anchorOf(event.target);
      if (next === hovered) return;
      clearHover();
      hovered = next;
      if (hovered) {
        hovered.style.outline = "2px solid #0284c7";
        hovered.style.outlineOffset = "2px";
      }
    };
    const onClick = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const picked = anchorOf(event.target);
      clearHover();
      setPickingStepId(null);
      if (!picked) {
        setMessage("That element has no data-tutorial-id anchor — pick a control that highlights as you hover.");
        return;
      }
      const id = picked.getAttribute("data-tutorial-id")!;
      setDraft((current) => updateDraftStep(current, pickingStepId, { anchor: id, context: tutorialViewContext(liveViewRef.current) }));
      setMessage(`Anchor set to “${id}”.`);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      clearHover();
      setPickingStepId(null);
      setMessage("Anchor picking cancelled.");
    };
    doc.addEventListener("mousemove", onMove, true);
    doc.addEventListener("click", onClick, true);
    doc.addEventListener("keydown", onKey, true);
    window.addEventListener("keydown", onKey);
    return () => {
      clearHover();
      doc.removeEventListener("mousemove", onMove, true);
      doc.removeEventListener("click", onClick, true);
      doc.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [pickingStepId, setDraft, tutorialViewContext]);

  const selectedIndex = Math.max(0, draft.steps.findIndex((step) => step.id === selectedStepId));
  const selectedStep = draft.steps[selectedIndex] ?? null;

  const navigateToStepView = useCallback((step: TutorialRecordingStep) => {
    if ((status !== "idle" && status !== "navigating") || preview || pickingStepId || focusPicker) return;
    const index = draft.steps.findIndex((entry) => entry.id === step.id);
    // A host stage is a throwaway fixture, so any step is reachable by
    // replaying the ones before it — including the dialogs, drafts and browser
    // tabs earlier steps opened, which navigation alone cannot reopen. The
    // replay leaves the stage where the step starts, so only the step's own
    // recorded view applies, not the destination its navigation leads to.
    const seek = environment.canSeek(stageOfLaunch(draft.launch)) ? tutorialSeekEntries(draft.steps, index) : null;
    const context = seek ? step.context : selectedStepView(step, draft.steps.slice(0, Math.max(0, index)));
    const controller = iframeControllerRef.current;
    // An Any-view command has no destination. Do not replay it or finish a prior seek.
    if (!context && !seek) {
      stepNavigationRef.current?.cancel();
      pendingStepViewRef.current = null;
      return;
    }
    if (!controller || connectedFrameRef.current !== iframeRef.current || !Object.keys(liveViewRef.current).length) {
      pendingStepViewRef.current = { stepId: step.id, draftId: draft.id };
      setMessage(`Waiting for the stage to open ${context?.label ?? `step ${index + 1}`}…`);
      return;
    }
    pendingStepViewRef.current = null;
    if (!stepNavigationRef.current) stepNavigationRef.current = createLatestStepNavigation(
      (busy) => setStatus((current) => busy ? "navigating" : current === "navigating" ? "idle" : current),
    );
    stepNavigationRef.current.request(async (signal, isCurrent) => {
      try {
        const seekKey = seek && JSON.stringify(seek);
        const seeked = seekedRef.current;
        if (seek && !(seeked?.frame === iframeRef.current && seeked.key === seekKey && seeked.view === JSON.stringify(liveViewRef.current))) {
          setMessage(seek.length ? `Replaying steps 1–${index} to reach “${step.title}”…` : "Resetting the stage to its starting screen…");
          seekedRef.current = null;
          await controller.seek(seek);
          if (!isCurrent() || signal.aborted || controller !== iframeControllerRef.current) return;
          seekedRef.current = { frame: iframeRef.current, key: seekKey!, view: JSON.stringify(liveViewRef.current) };
        }
        if (context && !tutorialContextMatches(context, liveViewRef.current)) {
          setMessage(`Opening ${context.label}…`);
          await controller.restoreView(context);
        }
        if (!isCurrent() || signal.aborted || controller !== iframeControllerRef.current) return;
        const id = step.target ?? step.anchor;
        const doc = iframeRef.current?.contentDocument;
        if (id && doc) {
          const anchor = await waitForTutorialAnchor(doc, id, { timeoutMs: Math.min(step.anchorWaitMs ?? 5_000, 10_000), signal });
          if (!isCurrent() || !tutorialContextMatches(context, liveViewRef.current)) return;
          visibleBoxOf(anchor).scrollIntoView({ block: "center", inline: "center", behavior: "auto" });
        }
        if (isCurrent()) setMessage(context ? `Opened ${context.label} for “${step.title}”.` : `The stage is at step ${index + 1}, “${step.title}”.`);
      } catch (error) {
        if (isCurrent() && !signal.aborted) setMessage(error instanceof Error ? error.message : "Unable to open this step’s view.");
      }
    });
  }, [draft.id, draft.launch, draft.steps, status, preview, pickingStepId, focusPicker, environment, selectedStepView, stageOfLaunch]);

  // A timeline can be selected before the newly imported fixture has hydrated.
  // Keep that intent until the new frame reports its first structural snapshot.
  useEffect(() => {
    const pending = pendingStepViewRef.current;
    if (!pending) return;
    if (pending.draftId !== draft.id) { pendingStepViewRef.current = null; return; }
    if (status !== "idle" || preview || !Object.keys(liveView).length || connectedFrameRef.current !== iframeRef.current) return;
    const step = draft.steps.find((entry) => entry.id === pending.stepId);
    pendingStepViewRef.current = null;
    if (step) navigateToStepView(step);
  }, [liveView, draft.id, draft.steps, status, preview, navigateToStepView]);

  useEffect(() => {
    if (preview || pickingStepId || focusPicker || (status !== "idle" && status !== "navigating")) {
      pendingStepViewRef.current = null;
      stepNavigationRef.current?.cancel();
    }
  }, [preview, pickingStepId, focusPicker, status]);

  useEffect(() => { stepNavigationRef.current?.cancel(); pendingStepViewRef.current = null; }, [draft.id]);

  /** Focus a step everywhere at once: panel, rail, timeline, stage, narration. */
  const focusStep = useCallback(
    (stepId: string) => {
      setSelectedStepId(stepId);
      setPanelTab("steps");
      setExpandAll(false);
      const step = draft.steps.find((entry) => entry.id === stepId);
      if (step && followStepView) navigateToStepView(step);
      const audio = audioRef.current;
      if (step?.narration && audio && draft.audio) audio.currentTime = step.narration.startMs / 1_000;
      window.requestAnimationFrame(() => {
        document.querySelector(`[data-rail-step="${CSS.escape(stepId)}"]`)?.scrollIntoView({ block: "nearest" });
      });
    },
    [draft.audio, draft.steps, followStepView, navigateToStepView]
  );

  // Focusing a step scrolls its control into view on the stage.
  useEffect(() => {
    const id = selectedStep?.target ?? selectedStep?.anchor;
    if (!id || !tutorialContextMatches(selectedStep?.context, liveView)) return;
    let doc: Document | null = null;
    try {
      doc = iframeRef.current?.contentDocument ?? null;
    } catch {
      return;
    }
    if (doc) findTutorialAnchor(doc, id)?.scrollIntoView({ block: "center", inline: "center", behavior: "auto" });
  }, [selectedStep?.id, selectedStep?.anchor, selectedStep?.target, selectedStep?.context, liveView]);

  // The stage overlay: markers on every step's control, a ring on the focused
  // one, optionally its card and arrow. Redrawn on every change and on a short
  // interval so it follows the fixture's own scrolling and re-layouts.
  useEffect(() => {
    const overlaySteps = draft.steps.map((step, index) => ({
      index,
      title: step.title,
      body: step.instruction,
      anchorId: step.anchor,
      targetId: step.target,
      highlights: step.highlights,
      focused: step.id === selectedStep?.id,
      pointer: step.card?.pointer ?? draft.card.pointer,
    }));
    const frame = iframeRef.current;
    if (preview) {
      clearStageOverlay(frame);
      return;
    }
    const sync = () => syncStageOverlay(frame, overlaySteps.filter((entry) => tutorialContextMatches(draft.steps[entry.index]?.context, liveViewRef.current)), overlay);
    sync();
    const timer = window.setInterval(sync, 300);
    return () => {
      window.clearInterval(timer);
      clearStageOverlay(frame);
    };
  }, [draft.steps, draft.card.pointer, selectedStep?.id, overlay, preview, stageFrameKey]);

  const insertAndFocus = (afterStepId: string | null) => {
    // Create the id once in the event handler. React may evaluate an updater
    // more than once; generating ids and scheduling focus there can select a
    // discarded step, leaving the panel on its first step.
    const current = latestDraftRef.current;
    const next = insertDraftStep(current, afterStepId);
    const known = new Set(current.steps.map((step) => step.id));
    const added = next.steps.find((step) => !known.has(step.id));
    setDraft(next);
    if (added) focusStep(added.id);
  };

  const goToStepView = navigateToStepView;

  /** Keeps a snapshot of the draft in the store and prunes the oldest beyond the cap. */
  const saveVersion = async (snapshot: TutorialRecordingDraft) => {
    if (!snapshot.steps.length) return;
    const at = Date.now();
    await store.put({ ...snapshot, id: versionIdFor(snapshot.id, at) });
    lastVersionAtRef.current = at;
    const stale = versionsOf(await store.list(), snapshot.id).slice(VERSIONS_KEPT);
    await Promise.all(stale.map((entry) => store.delete(entry.id)));
  };

  const beginRecording = async (mode: TutorialNarrationMode = narrationMode, placement: TutorialRecordingPlacement = draft.steps.length ? "append" : "replace") => {
    const recorder = recorderRef.current;
    if (!recorder || status !== "idle" || preview) return;
    const segment = placement !== "replace";
    const effectiveMode = segment ? "actions-only" : mode;
    if (!segment && mode !== narrationMode) {
      writeTutorialNarrationMode(mode);
      setNarrationMode(mode);
    }
    const withVoice = effectiveMode === "voice";
    recordingPlacementRef.current = placement;
    setStatus("starting");
    setMessage(withVoice ? "Requesting microphone permission…" : "Starting an actions-only recording…");
    try {
      if (draft.steps.length) await saveVersion(draft);
      await recorder.start({ microphone: withVoice });
      setStatus("recording");
      setMessage(
        withVoice
          ? "Recording voice and semantic actions. Use synthetic data only."
          : segment ? "Recording new actions only. Existing steps and narration are kept; arrange the stage where this segment begins."
          : "Recording semantic actions only; write each step's card text afterwards. Use synthetic data only."
      );
    } catch (error) {
      setStatus("idle");
      setMessage(error instanceof Error ? error.message : "Recording could not start.");
    }
  };

  const toggleRecordingPause = () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    try {
      if (recorder.status === "paused") {
        recorder.resume();
        setStatus("recording");
        setMessage(recorder.excludedPausedActionCount
          ? "Recording resumed. Stage changes made while paused are excluded. Later steps may depend on them; restore the previous state or record the required setup, then preview from the starting fixture."
          : "Recording resumed. Paused time and audio are excluded.");
      } else {
        recorder.pause();
        setStatus("paused");
        setMessage("Recording paused. Actions and audio are excluded. Resume from the same stage state so later steps remain replayable.");
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Recording could not be paused."); }
  };

  const endRecording = async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    setStatus("stopping");
    try {
      const capture = await recorder.stop();
      const current = latestDraftRef.current;
      const next = mergeCaptureIntoDraft(current, capture, recordingPlacementRef.current, new Date(), environment.suggestions);
      setDraft(next);
      const previousIds = new Set(current.steps.map((step) => step.id));
      setSelectedStepId(next.steps.find((step) => !previousIds.has(step.id))?.id ?? next.steps[0]?.id ?? null);
      await store.put(next);
      await saveVersion(next);
      setSaveState({ status: "saved", at: Date.now() });
      setMessage(
        capture.warnings.length
          ? `Recorded ${capture.actions.length} actions. ${capture.warnings.join(" ")}`
          : `Recorded ${capture.actions.length} semantic actions and saved the draft locally.`
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Recording could not be stopped.");
    } finally {
      setStatus("idle");
    }
  };

  const saveDraft = async () => {
    setSaveState({ status: "saving" });
    try {
      await store.put(draft);
      await saveVersion(draft);
      setSaveState({ status: "saved", at: Date.now() });
      setMessage("Draft saved locally, including its audio Blob, and a version kept.");
    } catch (error) {
      setSaveState({ status: "error" });
      setMessage(error instanceof Error ? error.message : "The draft could not be saved.");
    }
  };

  const exportDraft = async () => {
    const serialized = await serializeTutorialRecordingDraft(draft);
    downloadText(serialized, `${safeFilename(draft.title)}.tutorial-draft.json`);
    setMessage("Portable tutorial draft exported with embedded audio.");
  };

  const captureStepScreenshot = async (stepId: string) => {
    const frame = iframeRef.current;
    const step = draft.steps.find((entry) => entry.id === stepId);
    if (!frame || !step) throw new Error("Open a tutorial step and wait for its interface to load.");
    if (!tutorialContextMatches(step.context, liveViewRef.current)) {
      throw new Error(`This step belongs to ${step.context?.label}. Use “Go to step’s view” or “Capture this step” first.`);
    }
    const tutorialId = draft.id;
    const fingerprint = screenshotFingerprintForStep(draft, stepId);
    const screenshot = stampTutorialScreenshot(await (environment.captureRuntime?.captureInterface ?? captureTutorialInterface)(frame, `Interface for ${step.title}`.slice(0, 500)), {
      engine: "dom", capturedAt: new Date().toISOString(), stepFingerprint: fingerprint,
    });
    setDraft((current) => current.id === tutorialId ? updateDraftStep(current, stepId, { screenshot }) : current);
    setMessage("Interface screenshot saved with the step. Review it before exporting.");
  };

  const captureSelectedScreenshots = async (stepIds: string[]) => {
    if (status !== "idle" || preview || screenshotCaptureRef.current) return;
    const original = draft;
    const replay = screenshotSelectionReplayDraft(original, stepIds);
    const controller = new AbortController();
    screenshotCaptureRef.current = controller;
    setStatus("capturing");
    try {
      await captureMissingTutorialScreenshots({ draft: replay }, {
        ...environment.captureRuntime, draftStore: store,
        signal: controller.signal, onProgress: setMessage, framing: "step",
        drawOverlay: (frame, step) => syncStageOverlay(frame, [{ ...step, focused: true, pointer: false }], { highlight: true, markers: false, card: false }),
        focus: (doc, step) => {
          const anchor = step.anchorId ? findTutorialAnchor(doc, step.anchorId) : null;
          const target = step.targetId ? findTutorialAnchor(doc, step.targetId) : null;
          const base = target ?? anchor;
          return base ? [visibleBoxOf(base), resolveRingElement(anchor ?? base, step.targetId)] : [];
        },
        onScreenshot: (stepId, image) => {
          const screenshot = stampTutorialScreenshot(image, { engine: "dom", capturedAt: new Date().toISOString(),
            stepFingerprint: screenshotFingerprintForStep(original, stepId) });
          setDraft((current) => current.id === original.id ? updateDraftStep(current, stepId, { screenshot }) : current);
        },
      });
      setMessage(`Captured ${stepIds.length} ${stepIds.length === 1 ? "step" : "steps"} by replaying in a separate fixture. Review the images; the live stage was kept.`);
    } finally { screenshotCaptureRef.current = null; setStatus("idle"); }
  };

  const captureAndReport = async (stepIds: string[]) => {
    try { await captureSelectedScreenshots(stepIds); }
    catch (error) { setMessage(error instanceof Error ? error.message : "The screenshot could not be captured."); }
  };
  const screenshotRows = draft.steps.map((step) => ({ step, fingerprint: screenshotFingerprintForStep(draft, step.id),
    stale: step.screenshot ? screenshotIsStale(step.screenshot, screenshotFingerprintForStep(draft, step.id)) : false }));
  const staleScreenshotIds = screenshotRows.filter((row) => row.stale && row.step.screenshotMode !== "none" && row.step.action).map((row) => row.step.id);
  const missingScreenshotIds = screenshotRows.filter((row) => !row.step.screenshot && row.step.screenshotMode !== "none" && row.step.action).map((row) => row.step.id);

  const exportManifest = () => {
    try {
      const manifest = tutorialRecordingDraftToManifest(draft, {
        narrationAsset: draft.audio ? `${safeFilename(draft.title)}.webm` : undefined
      });
      downloadText(JSON.stringify(manifest, null, 2), `${safeFilename(draft.title)}.tutorial.json`);
      setMessage("Validated player manifest exported. Export the narration audio separately for publishing.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The manifest is not valid yet.");
    }
  };

  /**
   * Runs the saved draft in the real workspace, exactly as a learner would see
   * it, without hand-pasting the manifest anywhere. The workspace resolves
   * tutorial=draft:<id> from the same local draft store.
   */
  const previewDraft = async () => {
    try {
      tutorialRecordingDraftToManifest(draft); // Validate before launching.
      await store.put(draft);
      // The recording frame runs with tutorialAuthor=1, which the stage
      // treats as "report, do not play"; a preview must launch without it.
      const { tutorialAuthor: _authoring, ...hash } = draft.launch.hash;
      const launch = buildTutorialLaunchUrl({ ...draft.launch, hash });
      const url = `${resolveAppPath("/")}${launch.replace(/^\//, "")}&tutorial=draft:${encodeURIComponent(draft.id)}&tutorialRun=${Date.now()}`;
      window.open(url, "_blank", "noopener");
      setMessage("Draft saved and opened in the workspace as a live tutorial.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The draft is not a valid tutorial yet.");
    }
  };

  const copyAiEditingPrompt = async () => {
    const prompt = (environment.buildAiEditingPrompt ?? buildTutorialAiEditingPrompt)(draft);
    try {
      await copyText(prompt);
      setMessage(
        draft.audio
          ? "AI editing prompt copied. Export and attach the narration audio when you choose an AI tool."
          : "AI editing prompt copied. It requests canonical manifest JSON only."
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The AI editing prompt could not be copied.");
    }
  };

  const importDraft = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const imported = await deserializeTutorialRecordingDraft(await file.text());
      setDraft(imported);
      await store.put(imported);
      setMessage(`Imported “${imported.title}”.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "That tutorial draft is invalid.");
    }
  };

  // Declared after the recording and versioning handlers they call.
  // Autosave: every change lands in the local store after a short pause, and
  // a version snapshot is kept at most every few minutes (pruned to the
  // newest VERSIONS_KEPT). Save draft still saves at once and snapshots.
  useEffect(() => {
    if (saveState.status !== "dirty") return;
    const timer = window.setTimeout(async () => {
      setSaveState({ status: "saving" });
      try {
        await store.put(draft);
        if (Date.now() - lastVersionAtRef.current > VERSION_INTERVAL_MS) await saveVersion(draft);
        setSaveState({ status: "saved", at: Date.now() });
      } catch {
        setSaveState({ status: "error" });
      }
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the draft turns dirty; the draft itself is read at fire time
  }, [saveState.status, draft.updatedAt]);

  // Leaving with an edit the autosave has not written yet asks first.
  useEffect(() => {
    if (saveState.status !== "dirty" && saveState.status !== "saving") return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [saveState.status]);

  // Keyboard: J/K move between steps, R records or stops, ⌘Z / ⇧⌘Z undo and
  // redo, ⌘\ hides or shows the panel (Ctrl on other platforms). Never while
  // typing in a field.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditingTarget(event.target)) return;
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
        return;
      }
      if (meta && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
        return;
      }
      if (meta && event.key === "\\") {
        event.preventDefault();
        setPanelHidden(!panelHidden);
        return;
      }
      if (meta || event.altKey) return;
      if (event.key === "j" || event.key === "k") {
        if (!draft.steps.length) return;
        event.preventDefault();
        const next = Math.max(0, Math.min(draft.steps.length - 1, selectedIndex + (event.key === "j" ? 1 : -1)));
        focusStep(draft.steps[next].id);
      } else if (event.key === "r") {
        event.preventDefault();
        if (status === "recording" || status === "paused") void endRecording();
        else if (status === "idle" && !preview) void beginRecording();
      } else if (event.key === "Escape" && (status === "recording" || status === "paused")) {
        event.preventDefault();
        void endRecording();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const showVersionMenu = async (element: HTMLElement) => {
    try {
      setVersions(versionsOf(await store.list(), draft.id));
    } catch {
      setVersions([]);
    }
    setVersionMenu(menuAnchor(element));
  };

  const restoreVersion = async (versionId: string) => {
    const saved = await store.get(versionId);
    if (!saved) {
      setMessage("That version is gone.");
      return;
    }
    await saveVersion(draft);
    setDraft(normalizeTutorialRecordingDraft({ ...saved, id: draft.id }));
    setMessage(`Restored the version from ${new Date(saved.updatedAt).toLocaleString()}.`);
  };

  // A draft whose id matches a built-in is the shipped tutorial; say whether
  // it still exports to exactly what shipped.
  const { tutorial: shipped } = useEnvironmentTutorial(draft.id);
  // A prerequisite naming a CIH lesson is checked once those lessons load.
  const { tutorials: prerequisiteTutorials, loading: prerequisiteTutorialsLoading } = useEnvironmentTutorials(draft.prerequisites.some(isCihTutorialId));
  const unknownPrerequisites = draft.prerequisites.filter((id) => !prerequisiteTutorials.some((tutorial) => tutorial.id === id));
  const shippedState = useMemo(() => {
    if (!shipped) return null;
    try {
      return JSON.stringify(tutorialRecordingDraftToManifest(draft)) === JSON.stringify(shipped) ? "unchanged" : "modified";
    } catch {
      return "invalid";
    }
  }, [draft, shipped]);

  /**
   * Swaps the editor to another tutorial. The current draft is saved first so
   * nothing is lost; the incoming one is saved too so "Preview in workspace"
   * can resolve it as draft:<id>.
   */
  const switchTo = async (next: TutorialRecordingDraft, note: string) => {
    if (status !== "idle") return;
    try {
      setPreview(null);
      await store.put(draft);
      await saveVersion(draft);
      pastRef.current = [];
      futureRef.current = [];
      setHistorySize({ past: 0, future: 0 });
      setDraft(next);
      await store.put(next);
      setMessage(note);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The tutorial could not be opened.");
    }
  };

  const openBuiltIn = (manifest: TutorialManifest) =>
    switchTo(
      tutorialManifestToRecordingDraft(manifest),
      `Editing the built-in tutorial “${manifest.title}”. Export manifest and paste it into the catalog to ship changes.`
    );

  const openSaved = async (id: string) => {
    const saved = await store.get(id);
    if (!saved) {
      setMessage("That saved draft is gone.");
      return;
    }
    await switchTo(normalizeTutorialRecordingDraft(saved), `Opened saved draft “${saved.title}”.`);
  };

  const newDraft = (onStage: string = readTutorialStageSetting()) => {
    const label = getHostEmulatorManifest(onStage)?.label ?? environment.defaultStageLabel;
    return switchTo(createBlankStudioDraft(onStage, environment), `Started a new draft on ${label}.`);
  };

  const stageLabel = (id: string) => getHostEmulatorManifest(id)?.label ?? environment.defaultStageLabel;

  /**
   * The toolbar's Stage picker. An empty draft simply moves; a draft with
   * content asks first, because a stage change means a new tutorial — the
   * current one is saved (and versioned) and stays reachable from Open.
   */
  const requestStageChange = (next: string) => {
    if (next === stage || status !== "idle" || preview) return;
    writeTutorialStageSetting(next);
    if (!draft.steps.length && !draft.audio) {
      updateMetadata({ launch: launchForStage(next, draft.launch) });
      setMessage(`Stage set to ${stageLabel(next)}.`);
      return;
    }
    setPendingStage(next);
  };

  /**
   * An explicit zoom choice. A stage that paints a fixed window sizes it
   * once, when it opens, so outside a recording or preview the stage reopens
   * at the new size; mid-recording it rescales in place and keeps its state.
   */
  const changeStageZoom = (next: StageZoom) => {
    setStoredZoom(next === "fit" ? null : String(next));
    if (windowSize && status === "idle" && !preview) {
      setStageEpoch((epoch) => epoch + 1);
      setMessage(`Stage reopened at ${formatZoom(next === "fit" ? fitZoom : next)} so the whole ${stageLabel(stage)} window shows.`);
    }
  };

  const stepStageZoom = (direction: -1 | 1) => {
    const next =
      direction < 0
        ? [...STAGE_ZOOM_LEVELS].reverse().find((level) => level < zoom - 0.001)
        : STAGE_ZOOM_LEVELS.find((level) => level > zoom + 0.001);
    if (next !== undefined) changeStageZoom(next);
  };

  const showOpenMenu = async (element: HTMLElement) => {
    try {
      setSavedDrafts((await store.list()).filter((entry) => entry.id !== draft.id && !entry.id.startsWith(VERSION_PREFIX)));
    } catch {
      setSavedDrafts([]);
    }
    setOpenMenu(menuAnchor(element));
  };

  const openMenuItems: ContextMenuItem[] = [
    {
      id: "my-tutorials",
      label: "All my tutorials…",
      icon: <LayoutGrid className="h-3.5 w-3.5" />,
      onSelect: () => window.location.assign(studioHref(undefined, environment))
    },
    { kind: "separator" as const, id: "my-tutorials-sep" },
    { id: "new", label: "New blank draft", icon: <Plus className="h-3.5 w-3.5" />, onSelect: () => void newDraft() },
    ...(savedDrafts.length
      ? [
          { kind: "separator" as const, id: "saved-sep" },
          ...savedDrafts.map((entry) => ({
            id: `saved:${entry.id}`,
            label: `Saved: ${entry.title}`,
            onSelect: () => void openSaved(entry.id)
          }))
        ]
      : []),
    { kind: "separator" as const, id: "built-in-sep" },
    ...BUILT_IN_TUTORIALS.map((manifest) => ({
      id: `built-in:${manifest.id}`,
      label: `Built-in: ${manifest.title}`,
      onSelect: () => void openBuiltIn(manifest)
    }))
  ];

  const clearRecording = async () => {
    recorderRef.current?.clear();
    setStatus("idle");
    const next = clearDraftRecording(draft);
    setDraft(next);
    try {
      await store.put(next);
      setMessage("Recording, persisted audio, and recorded steps cleared from the current draft.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The local recording could not be cleared.");
    }
  };

  const deleteLocalDraft = async () => {
    try {
      await store.delete(draft.id);
      setMessage("The saved local copy was deleted. The current unsaved editor remains open.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The local draft could not be deleted.");
    }
  };

  const updateMetadata = (patch: Partial<TutorialRecordingDraft>) => {
    setDraft((current) => ({ ...current, ...patch, updatedAt: new Date().toISOString() }));
  };

  return (
    <section className={clsx("flex flex-col", className)} aria-label="Tutorial studio">
      {exportOpen && <TutorialExportDialog source={{ draft }} onClose={() => setExportOpen(false)} />}
      {shareOpen && <TutorialShareDialog source={{ draft }} onClose={() => setShareOpen(false)} />}
      {screenshotsOpen && <Modal open size="xl" busy={status === "capturing"} onClose={() => setScreenshotsOpen(false)}>
        <Modal.Header title="Review screenshots" description="Compare each saved image with its instruction. Changed steps are flagged; images without capture metadata have unknown freshness." />
        <Modal.Body className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={status !== "idle" || !selectedScreenshotIds.size} onClick={() => void captureAndReport(draft.steps.filter((step) => selectedScreenshotIds.has(step.id) && step.action).map((step) => step.id))}>Regenerate selected</Button>
            <Button size="sm" disabled={status !== "idle" || !staleScreenshotIds.length} onClick={() => void captureAndReport(staleScreenshotIds)}>Regenerate stale ({staleScreenshotIds.length})</Button>
            <Button size="sm" disabled={status !== "idle" || !missingScreenshotIds.length} onClick={() => void captureAndReport(missingScreenshotIds)}>Capture missing ({missingScreenshotIds.length})</Button>
          </div>
          <p role="status" className="text-sm text-slate-600 dark:text-slate-300">{message}</p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {screenshotRows.map(({ step, stale }, index) => <article key={step.id} className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <label className="flex items-center gap-2 text-sm font-semibold">
                <Checkbox aria-label={`Select screenshot ${index + 1}`} checked={selectedScreenshotIds.has(step.id)} disabled={status !== "idle" || !step.action || step.screenshotMode === "none"}
                  onChange={(event) => setSelectedScreenshotIds((current) => { const next = new Set(current); if (event.target.checked) next.add(step.id); else next.delete(step.id); return next; })} />
                {index + 1}. {step.title}
              </label>
              <p className="whitespace-pre-wrap text-xs text-slate-600 dark:text-slate-300">{step.instruction}</p>
              {step.screenshot ? <>
                <img src={step.screenshot.dataUrl} alt={step.screenshot.alt} className="h-auto w-full rounded border border-slate-200" />
                <p className={clsx("text-xs", stale ? "font-semibold text-amber-700 dark:text-amber-300" : "text-slate-500")}>
                  {stale ? "Changed since capture — regenerate or replace." : !step.screenshot.provenance?.stepFingerprint ? "Freshness unknown — imported or older capture." : "Matches the current step."}
                  {step.screenshot.provenance?.reviewedAt ? " Reviewed." : " Not reviewed yet."}
                  {step.screenshotMode === "none" ? " Omitted from guides." : ""}
                </p>
                <Button size="sm" variant="ghost" disabled={status !== "idle" || stale} onClick={() => setDraft((current) => {
                  const image = current.steps.find((entry) => entry.id === step.id)?.screenshot;
                  if (!image) return current;
                  return updateDraftStep(current, step.id, { screenshot: stampTutorialScreenshot(image, {
                    ...(image.provenance ?? { engine: "import", capturedAt: new Date().toISOString() }), reviewedAt: new Date().toISOString(),
                  }) });
                })}>Mark reviewed</Button>
              </> : <p className="text-xs text-slate-500">{step.screenshotMode === "none" ? "Text-only step." : "No saved screenshot."}</p>}
              {!step.action && step.screenshotMode !== "none" && <p className="text-xs text-slate-500">Capture the current interface or upload an image in the step editor.</p>}
            </article>)}
          </div>
        </Modal.Body>
        <Modal.Footer>{status === "capturing" ? <Button onClick={() => screenshotCaptureRef.current?.abort()}>Cancel capture</Button> : <Button onClick={() => setScreenshotsOpen(false)}>Close</Button>}</Modal.Footer>
      </Modal>}
      {/* One row: the stage is what authors watch, so the toolbar keeps only
          the everyday actions and folds the rest into More. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
        {toolbarStart}
        {status === "recording" || status === "paused" ? (
          <>
            <Button variant="danger" onClick={endRecording} leftIcon={<Square className="h-4 w-4" />}>Stop recording</Button>
            <Button onClick={toggleRecordingPause} leftIcon={status === "paused" ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}>{status === "paused" ? "Resume recording" : "Pause recording"}</Button>
          </>
        ) : (
          <div className="inline-flex" role="group" aria-label="Record tutorial">
            <Button
              variant="primary"
              className="rounded-r-none"
              onClick={() => void beginRecording()}
              disabled={status !== "idle" || preview !== null}
              leftIcon={narrationMode === "voice" ? <Mic className="h-4 w-4" /> : <MousePointerClick className="h-4 w-4" />}
              title={draft.steps.length ? "Append actions while keeping existing steps and narration" : narrationMode === "voice" ? "Record narration and actions" : "Record actions only, no microphone"}
            >
              {draft.steps.length ? "Append actions" : narrationMode === "voice" ? "Record tutorial" : "Record actions only"}
            </Button>
            <Button
              variant="primary"
              iconOnly
              className="rounded-l-none border-l border-white/30"
              aria-label="Recording options"
              aria-haspopup="menu"
              aria-expanded={recordMenu !== null}
              disabled={status !== "idle" || preview !== null}
              onClick={(event) => setRecordMenu(menuAnchor(event.currentTarget))}
              leftIcon={<ChevronDown className="h-4 w-4" />}
            />
          </div>
        )}
        <ContextMenu
          open={recordMenu !== null}
          x={recordMenu?.x ?? 0}
          y={recordMenu?.y ?? 0}
          ariaLabel="Recording options"
          onClose={() => setRecordMenu(null)}
          items={[
            {
              id: "voice",
              label: draft.steps.length ? "Replace recording with narration (microphone)" : "Record with narration (microphone)",
              icon: <Mic className="h-3.5 w-3.5" />,
              onSelect: () => void beginRecording("voice", "replace")
            },
            {
              id: "actions-only",
              label: draft.steps.length ? "Replace recording with actions only" : "Record actions only (no microphone)",
              icon: <MousePointerClick className="h-3.5 w-3.5" />,
              onSelect: () => void beginRecording("actions-only", "replace")
            },
            { id: "append", label: "Append actions (keep existing narration)", disabled: !draft.steps.length,
              onSelect: () => void beginRecording("actions-only", "append") },
            { id: "insert", label: "Record actions after selected step", disabled: !selectedStep,
              onSelect: () => selectedStep && void beginRecording("actions-only", { afterStepId: selectedStep.id }) },
          ]}
        />
        <Button
          onClick={(event) => void showOpenMenu(event.currentTarget)}
          disabled={status !== "idle"}
          aria-haspopup="menu"
          aria-expanded={openMenu !== null}
          leftIcon={<FolderOpen className="h-4 w-4" />}
          {...toolbarLabel("Open")}
        />
        <ContextMenu
          open={openMenu !== null}
          x={openMenu?.x ?? 0}
          y={openMenu?.y ?? 0}
          ariaLabel="Open a tutorial"
          onClose={() => setOpenMenu(null)}
          items={openMenuItems}
        />
        <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
          <span className="hidden 2xl:inline">Stage</span>
          <BuilderSelect
            aria-label="Tutorial stage"
            value={stage}
            disabled={status !== "idle" || preview !== null}
            onChange={requestStageChange}
            controlClassName="h-9 w-52 text-xs"
            options={[
              { value: WORKSPACE_STAGE, label: environment.defaultStageLabel },
              ...HOST_EMULATOR_MANIFESTS.map((manifest) => ({ value: manifest.id, label: manifest.label })),
            ]}
          />
        </label>
        <ConfirmDialog
          open={pendingStage !== null}
          title={`Start a new tutorial on ${pendingStage ? stageLabel(pendingStage) : ""}?`}
          description={
            <>
              Changing the stage starts a fresh draft. “{draft.title || "Untitled tutorial"}” is saved locally first
              {saveState.status === "dirty" || saveState.status === "saving" ? " (it has unsaved changes)" : ""}, keeps a
              version, and stays available under Open.
            </>
          }
          confirmLabel="Save and switch"
          cancelLabel="Keep editing"
          onCancel={() => setPendingStage(null)}
          onConfirm={() => {
            const next = pendingStage;
            setPendingStage(null);
            if (next) void newDraft(next);
          }}
        />
        <Button
          iconOnly
          variant="ghost"
          aria-label="Undo"
          title="Undo (⌘Z)"
          disabled={historySize.past === 0}
          onClick={undo}
          leftIcon={<Undo2 className="h-4 w-4" />}
        />
        <Button
          iconOnly
          variant="ghost"
          aria-label="Redo"
          title="Redo (⇧⌘Z)"
          disabled={historySize.future === 0}
          onClick={redo}
          leftIcon={<Redo2 className="h-4 w-4" />}
        />
        <Button onClick={saveDraft} leftIcon={<Save className="h-4 w-4" />} {...toolbarLabel("Save draft")} />
        <Button
          onClick={(event) => void showVersionMenu(event.currentTarget)}
          aria-haspopup="menu"
          aria-expanded={versionMenu !== null}
          leftIcon={<RotateCcwClock className="h-4 w-4" />}
          {...toolbarLabel("Versions")}
        />
        <ContextMenu
          open={versionMenu !== null}
          x={versionMenu?.x ?? 0}
          y={versionMenu?.y ?? 0}
          ariaLabel="Saved versions"
          onClose={() => setVersionMenu(null)}
          items={
            versions.length
              ? versions.map((entry) => ({
                  id: entry.id,
                  label: `${new Date(entry.updatedAt).toLocaleString()} · ${entry.title}`,
                  onSelect: () => void restoreVersion(entry.id),
                }))
              : [{ id: "none", label: "No saved versions yet", onSelect: () => undefined, disabled: true }]
          }
        />
        <Button onClick={() => setExportOpen(true)} disabled={status !== "idle"} leftIcon={<Download className="h-4 w-4" />} {...toolbarLabel("Export…", "xl")} />
        <Button onClick={() => setScreenshotsOpen(true)} disabled={status !== "idle" || !draft.steps.length} leftIcon={<Eye className="h-4 w-4" />} {...toolbarLabel("Review screenshots", "2xl")} />
        <Button onClick={() => setShareOpen(true)} disabled={status !== "idle"} leftIcon={<Link2 className="h-4 w-4" />} {...toolbarLabel("Share link…", "xl")} />
        <Button
          iconOnly
          variant="ghost"
          aria-label="More actions"
          title="More actions"
          aria-haspopup="menu"
          aria-expanded={moreMenu !== null}
          onClick={(event) => setMoreMenu(menuAnchor(event.currentTarget))}
          leftIcon={<MoreHorizontal className="h-4 w-4" />}
        />
        {StudioReviewHost && <StudioReviewHost draft={draft} onFocusStep={focusStep} />}
        <ContextMenu
          open={moreMenu !== null}
          x={moreMenu?.x ?? 0}
          y={moreMenu?.y ?? 0}
          ariaLabel="More actions"
          onClose={() => setMoreMenu(null)}
          items={[
            { id: "preview-workspace", label: "Preview in workspace", icon: <Play className="h-3.5 w-3.5" />, onSelect: () => void previewDraft() },
            { id: "copy-ai-prompt", label: "Copy AI prompt", icon: <Copy className="h-3.5 w-3.5" />, onSelect: () => void copyAiEditingPrompt() },
            // Feedback reviewers sent back from review links (Share link… › Review) and from the emulators.
            ...(environment.review?.openInbox ? [{ id: "review-feedback", label: "Review feedback", icon: <MessageSquareText className="h-3.5 w-3.5" />, onSelect: environment.review.openInbox }] : []),
            { kind: "separator", id: "files-sep" },
            { id: "export-draft", label: "Export draft", icon: <Download className="h-3.5 w-3.5" />, onSelect: () => void exportDraft() },
            { id: "export-manifest", label: "Export manifest", icon: <Download className="h-3.5 w-3.5" />, onSelect: exportManifest },
            { id: "import", label: "Import…", icon: <Upload className="h-3.5 w-3.5" />, onSelect: () => importInputRef.current?.click() },
            { kind: "separator", id: "danger-sep" },
            {
              id: "clear-recording",
              label: "Clear recording",
              icon: <Square className="h-3.5 w-3.5" />,
              disabled: status !== "idle" || (!draft.steps.length && !draft.audio),
              onSelect: () => void clearRecording()
            },
            {
              id: "delete-local",
              label: "Delete local copy",
              icon: <Trash2 className="h-3.5 w-3.5" />,
              danger: true,
              disabled: status !== "idle",
              onSelect: () => void deleteLocalDraft()
            }
          ]}
        />
        <input ref={importInputRef} type="file" accept="application/json,.json" hidden onChange={importDraft} />
        {toolbarEnd}
        {/* Grows into the leftover room and truncates, so a long message never
            wraps the toolbar onto a second row. */}
        <span className="ml-auto flex min-w-32 flex-1 basis-0 items-center justify-end gap-3 text-xs text-slate-500">
          {shipped ? (
            <span
              data-testid="shipped-badge"
              className={clsx(
                "whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold",
                shippedState === "unchanged"
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200"
                  : "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200"
              )}
              title={shippedState === "unchanged" ? "Exports to exactly what shipped in the catalog" : "Differs from the shipped catalog entry"}
            >
              {shippedState === "unchanged" ? "Shipped · unchanged" : shippedState === "modified" ? "Shipped · modified locally" : "Shipped · currently invalid"}
            </span>
          ) : (
            <span className="whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">Local draft</span>
          )}
          <span data-testid="save-state" aria-live="polite" className="whitespace-nowrap">
            {saveState.status === "saving" ? "Saving…" : saveState.status === "dirty" ? "Unsaved changes" : saveState.status === "error" ? "Could not save" : saveState.at ? `Saved ${new Date(saveState.at).toLocaleTimeString()}` : "Saved"}
          </span>
          <span role="status" className="min-w-0 truncate" title={message}>{message}</span>
        </span>
        <Button
          iconOnly
          variant="ghost"
          className="hidden lg:inline-flex"
          aria-label={panelHidden ? "Show tutorial panel" : "Hide tutorial panel"}
          aria-pressed={!panelHidden}
          title={panelHidden ? "Show the steps panel (⌘\\)" : "Hide the steps panel to give the stage the full width (⌘\\)"}
          onClick={() => setPanelHidden(!panelHidden)}
          leftIcon={panelHidden ? <PanelRightOpen className="h-4 w-4" /> : <PanelRightClose className="h-4 w-4" />}
        />
      </div>

      {/* Side by side from lg: the stage and the panel each scroll on their
          own and the page does not; stacked below lg, where the page scrolls. */}
      <div
        className={clsx(
          "relative grid min-h-0 flex-1 grid-cols-1 lg:grid-rows-[minmax(0,1fr)]",
          panelHidden ? "lg:grid-cols-[minmax(0,1fr)]" : "lg:grid-cols-[minmax(0,1fr)_var(--studio-panel-width)]"
        )}
        style={{ "--studio-panel-width": `${panelWidth}px` } as CSSProperties}
      >
        <div className="flex min-h-[540px] flex-col border-r lg:min-h-0 border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-950">
          {/* The fixture URL is on hover (and shown on very wide screens) so
              the bar stays one row above the stage. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-200 px-3 py-1.5 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300">
            <span className="min-w-24 flex-1 basis-0 truncate" title={resolvedSourceUrl}>
              {hostManifest ? `Live stage: ${hostManifest.label}` : "Live synthetic fixture"}
              <span className="ml-3 hidden font-mono 2xl:inline">{resolvedSourceUrl}</span>
            </span>
            {preview ? (
              <div className="ml-auto flex items-center gap-2" data-testid="preview-banner">
                <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-semibold text-brand-800 dark:bg-brand-500/15 dark:text-brand-100">
                  Previewing {preview.fromStepId ? `from step ${draft.steps.findIndex((step) => step.id === preview.fromStepId) + 1}` : "from the start"} · {preview.mode === "autoplay" ? "Watch" : "Try it"}
                </span>
                <Button size="sm" onClick={() => setPreview((current) => (current ? { ...current, nonce: Date.now() } : current))}>Restart</Button>
                <Button size="sm" variant="primary" onClick={stopPreview}>Back to authoring</Button>
              </div>
            ) : (
              <div role="group" aria-label="Preview" className="ml-auto flex items-center gap-2">
                <BuilderSelect
                  aria-label="Preview mode"
                  value={previewMode ?? draft.defaultMode}
                  onChange={(value) => setPreviewMode(value as TutorialMode)}
                  controlClassName="h-7 text-xs"
                  options={[{ value: "practice", label: "Try it" }, { value: "autoplay", label: "Watch" }]}
                />
                <Button
                  size="sm"
                  leftIcon={<Eye className="h-3.5 w-3.5" />}
                  disabled={status !== "idle" || !selectedStep}
                  onClick={() => void startPreview(selectedStep?.id ?? null, previewMode ?? draft.defaultMode)}
                >
                  Preview from step {selectedStep ? selectedIndex + 1 : ""}
                </Button>
                <Button size="sm" disabled={status !== "idle" || !draft.steps.length} onClick={() => void startPreview(null, previewMode ?? draft.defaultMode)}>
                  Preview all
                </Button>
              </div>
            )}
            <div role="group" aria-label="Stage overlay" className={clsx("flex items-center gap-3", preview && "hidden")}>
              <label className="flex items-center gap-1.5">
                <Checkbox aria-label="Follow selected step’s view" checked={followStepView} disabled={status !== "idle" && status !== "navigating"}
                  onChange={(event) => { setFollowStepViewSetting(event.target.checked ? null : "0"); if (!event.target.checked) { stepNavigationRef.current?.cancel(); pendingStepViewRef.current = null; } }} />
                Follow step view
              </label>
              <label className="flex items-center gap-1.5" title="Highlight focused step">
                <Checkbox aria-label="Highlight focused step" checked={overlay.highlight} onChange={(event) => updateOverlay({ highlight: event.target.checked })} />
                Highlight
              </label>
              <label className="flex items-center gap-1.5" title="Keep step markers">
                <Checkbox aria-label="Keep step markers" checked={overlay.markers} onChange={(event) => updateOverlay({ markers: event.target.checked })} />
                Markers
              </label>
              <label className="flex items-center gap-1.5" title="Show card and arrow">
                <Checkbox aria-label="Show card and arrow" checked={overlay.card} onChange={(event) => updateOverlay({ card: event.target.checked })} />
                Card &amp; arrow
              </label>
            </div>
          </div>
          {/* Keyed on the URL: a src change alone did not always navigate the
              frame (opening one tutorial while another stage was still
              loading left the old stage in place), so a new URL gets a new element. */}
          {/* Zoomed out, the frame lays out at the box's size ÷ zoom and is
              scaled down into the box, so the interface sees a larger screen. */}
          <div ref={stageBoxRef} className="relative min-h-0 flex-1 overflow-hidden">
            {stageReady ? (
              <iframe
                key={stageFrameKey ?? undefined}
                ref={iframeRef}
                title="Tutorial recording fixture"
                src={resolvedSourceUrl}
                allow="microphone; autoplay"
                className="absolute left-0 top-0 origin-top-left border-0 bg-white"
                style={{
                  width: `${100 / zoom}%`,
                  height: `${100 / zoom}%`,
                  transform: zoom === 1 ? undefined : `scale(${zoom})`
                }}
              />
            ) : null}
          </div>
          <Timeline
            draft={draft}
            selectedStepId={selectedStep?.id ?? null}
            playheadMs={audioPlaying ? audioTimeMs : undefined}
            onSelect={focusStep}
            collapsed={timelineCollapsed}
            onCollapsedChange={setTimelineCollapsed}
            trailing={
              <div role="group" aria-label="Stage zoom" className="flex items-center gap-0.5">
                <Button
                  size="sm"
                  variant="ghost"
                  iconOnly
                  aria-label="Zoom stage out"
                  title="Zoom stage out"
                  disabled={zoom <= STAGE_ZOOM_MIN + 0.001}
                  onClick={() => stepStageZoom(-1)}
                  leftIcon={<ZoomOut className="h-3.5 w-3.5" />}
                />
                <BuilderSelect
                  aria-label="Stage zoom"
                  value={stageZoom === "fit" ? "fit" : String(stageZoom)}
                  onChange={(value) => changeStageZoom(value === "fit" ? "fit" : Number(value))}
                  controlClassName="h-7 w-28 text-xs"
                  options={[
                    { value: "fit", label: windowSize ? `Fit · ${formatZoom(fitZoom)}` : "Fit · 100%" },
                    ...STAGE_ZOOM_LEVELS.map((level) => ({ value: String(level), label: formatZoom(level) }))
                  ]}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  iconOnly
                  aria-label="Zoom stage in"
                  title="Zoom stage in"
                  disabled={zoom >= 1 - 0.001}
                  onClick={() => stepStageZoom(1)}
                  leftIcon={<ZoomIn className="h-3.5 w-3.5" />}
                />
              </div>
            }
          />
        </div>

        {/* Drag (or arrow-key) the divider to give the stage or the step list
            more room; the width is remembered per browser. */}
        {/* display: contents keeps the wrapper out of the grid's cells; the
            handle itself is absolutely positioned against the grid. */}
        <div className={clsx("hidden", !panelHidden && "lg:contents")}>
          <PanelResizeHandle
            label="tutorial steps"
            side="right"
            width={panelWidth}
            min={PANEL_WIDTH_MIN}
            max={PANEL_WIDTH_MAX}
            onResize={setPanelWidth}
            style={{ right: "calc(var(--studio-panel-width) - 8px)" }}
          />
        </div>

        <aside className={clsx("flex min-h-0 flex-col bg-white dark:bg-slate-900", panelHidden && "lg:hidden")}>
          <div role="tablist" aria-label="Tutorial panel" className="flex shrink-0 border-b border-slate-200 dark:border-slate-700">
            {PANEL_TABS.map((tab) => {
              const active = panelTab === tab.id;
              const count = tab.id === "steps" ? draft.steps.length : tab.id === "chapters" ? draft.chapters.length : null;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  id={`studio-tab-${tab.id}`}
                  aria-selected={active}
                  aria-controls={`studio-panel-${tab.id}`}
                  onClick={() => setPanelTab(tab.id)}
                  className={clsx(
                    "flex-1 border-b-2 px-2 py-2 text-xs font-semibold",
                    active
                      ? "border-brand-600 text-brand-700 dark:border-brand-400 dark:text-brand-200"
                      : "border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-white"
                  )}
                >
                  {tab.label}
                  {count !== null ? <span className="ml-1 font-normal opacity-60">{count}</span> : null}
                </button>
              );
            })}
          </div>

          <div
            role="tabpanel"
            id={`studio-panel-${panelTab}`}
            aria-labelledby={`studio-tab-${panelTab}`}
            className="min-h-0 flex-1 overflow-y-auto p-4"
          >
            {panelTab === "settings" ? (
              <>
              <div className="space-y-3">
            <Field label="Tutorial title">
              <Input value={draft.title} onChange={(event) => updateMetadata({ title: event.target.value })} />
            </Field>
            <Field label="Description">
              <Textarea rows={2} value={draft.description} onChange={(event) => updateMetadata({ description: event.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Default mode">
                <BuilderSelect
                  value={draft.defaultMode}
                  onChange={(nextValue) => updateMetadata({ defaultMode: nextValue as "autoplay" | "practice" })}
                  controlClassName="h-8 text-xs"
                  options={[{ value: "autoplay", label: "Autoplay" }, { value: "practice", label: "Wait for user" }]}
                />
              </Field>
              <Field label="Highlight style">
                <BuilderSelect
                  value={draft.spotlightStyle}
                  onChange={(nextValue) => updateMetadata({ spotlightStyle: nextValue as "dim" | "glow" })}
                  controlClassName="h-8 text-xs"
                  options={[{ value: "dim", label: "Dim background" }, { value: "glow", label: "Yellow glow" }]}
                />
              </Field>
              <Field label="Interaction">
                <BuilderSelect
                  value={draft.interaction}
                  onChange={(nextValue) => updateMetadata({ interaction: nextValue as "free" | "guided" })}
                  controlClassName="h-8 text-xs"
                  options={[{ value: "free", label: "Whole workspace" }, { value: "guided", label: "Highlighted control only" }]}
                />
              </Field>
              <Field label="Tutorial id">
                <Input aria-label="Tutorial id" value={draft.id} onChange={(event) => updateMetadata({ id: event.target.value })} />
              </Field>
              <Field label="Fixture">
                {hostManifest ? (
                  <BuilderSelect
                    aria-label="Stage fixture"
                    value={draft.launch.fixture}
                    onChange={(nextValue) => updateMetadata({ launch: { ...draft.launch, fixture: nextValue } })}
                    controlClassName="h-8 text-xs"
                    options={hostManifest.fixtures.map((fixture) => ({ value: fixture.id, label: fixture.label }))}
                  />
                ) : (
                  <Input value={draft.launch.fixture} onChange={(event) => updateMetadata({ launch: { ...draft.launch, fixture: event.target.value } })} />
                )}
              </Field>
              {hostManifest ? null : (
                <Field label="Launch hash (JSON)">
                  <JsonInput
                    aria-label="Launch hash"
                    value={editableHash(draft.launch.hash)}
                    onValid={(parsed) => {
                      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("The hash must be an object.");
                      const authoring = draft.launch.hash.tutorialAuthor;
                      updateMetadata({
                        launch: {
                          ...draft.launch,
                          hash: { ...(parsed as Record<string, string | number | boolean>), ...(authoring === undefined ? {} : { tutorialAuthor: authoring }) }
                        }
                      });
                    }}
                  />
                </Field>
              )}
            </div>

              </div>
              {audioUrl && (
            <div className="my-4 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <div className="flex items-center gap-2">
                <Button
                  iconOnly
                  aria-label={audioPlaying ? "Pause narration" : "Play narration"}
                  onClick={() => {
                    const audio = audioRef.current;
                    if (!audio) return;
                    if (audio.paused) void audio.play(); else audio.pause();
                  }}
                >
                  {audioPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </Button>
                <div>
                  <div className="text-sm font-semibold">Recorded narration</div>
                  <div className="text-xs text-slate-500">{formatTime(draft.audio?.durationMs ?? 0)}</div>
                </div>
                <Button
                  className="ml-auto"
                  size="sm"
                  onClick={() => draft.audio && downloadBlob(draft.audio.blob, `${safeFilename(draft.title)}.webm`)}
                >
                  Export audio
                </Button>
              </div>
              <audio
                ref={audioRef}
                src={audioUrl}
                onPlay={() => setAudioPlaying(true)}
                onPause={() => setAudioPlaying(false)}
                onEnded={() => setAudioPlaying(false)}
                onTimeUpdate={(event) => setAudioTimeMs(event.currentTarget.currentTime * 1_000)}
              />
            </div>
          )}
              </>
            ) : null}

            {panelTab === "library" ? (
              <div className="space-y-3">
              <LessonSetupEditor setup={draft.setup} onChange={(setup) => updateMetadata({ setup })} />
              <div className="mt-2 grid grid-cols-2 gap-3">
                <Field label="Track">
                  <BuilderSelect
                    aria-label="Library track"
                    value={draft.track}
                    onChange={(nextValue) => updateMetadata({ track: nextValue as TutorialRecordingDraft["track"] })}
                    controlClassName="h-8 text-xs"
                    options={TUTORIAL_TRACKS.map((track) => ({ value: track.id, label: track.title }))}
                  />
                </Field>
                <Field label="Level">
                  <BuilderSelect
                    aria-label="Level"
                    value={draft.level}
                    onChange={(nextValue) => updateMetadata({ level: nextValue as TutorialRecordingDraft["level"] })}
                    controlClassName="h-8 text-xs"
                    options={[{ value: "beginner", label: "Beginner" }, { value: "intermediate", label: "Intermediate" }]}
                  />
                </Field>
                <Field label="Estimated minutes">
                  <Input
                    aria-label="Estimated minutes"
                    type="number"
                    min={1}
                    max={60}
                    value={draft.estimatedMinutes}
                    onChange={(event) => updateMetadata({ estimatedMinutes: Math.max(1, Math.min(60, Number(event.target.value) || 1)) })}
                  />
                </Field>
                <label className="flex items-center gap-2 self-end pb-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
                  <Checkbox aria-label="Listed in the library" checked={draft.listed} onChange={(event) => updateMetadata({ listed: event.target.checked })} />
                  Listed in the library
                </label>
                <Field label="Prerequisites (ids, comma-separated)">
                  <Input
                    aria-label="Prerequisites"
                    placeholder="interface-vocabulary, organize-with-sections"
                    value={draft.prerequisites.join(", ")}
                    onChange={(event) =>
                      updateMetadata({
                        prerequisites: event.target.value.split(",").map((value) => value.trim()).filter(Boolean)
                      })
                    }
                  />
                </Field>
                <Field label="Docs page (site path)">
                  <Input
                    aria-label="Docs page"
                    placeholder="/docs/features/building/…"
                    value={draft.docs ?? ""}
                    onChange={(event) => updateMetadata({ docs: event.target.value || undefined })}
                  />
                </Field>
                <Field label="Card placement">
                  <BuilderSelect
                    aria-label="Card placement"
                    value={draft.card.placement}
                    onChange={(nextValue) => updateMetadata({ card: { ...draft.card, placement: nextValue as TutorialRecordingDraft["card"]["placement"] } })}
                    controlClassName="h-8 text-xs"
                    options={CARD_PLACEMENTS}
                  />
                </Field>
                <Field label="Card size">
                  <BuilderSelect
                    aria-label="Card size"
                    value={draft.card.size}
                    onChange={(nextValue) => updateMetadata({ card: { ...draft.card, size: nextValue as "default" | "large" } })}
                    controlClassName="h-8 text-xs"
                    options={CARD_SIZES}
                  />
                </Field>
                <label className="col-span-2 flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
                  <Checkbox aria-label="Card pointer arrow" checked={draft.card.pointer} onChange={(event) => updateMetadata({ card: { ...draft.card, pointer: event.target.checked } })} />
                  Draw a pointer from the card to the control
                </label>
              </div>
              {!prerequisiteTutorialsLoading && unknownPrerequisites.length > 0 ? (
                <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400">
                  Unknown prerequisite id(s): {unknownPrerequisites.join(", ")}.
                </p>
              ) : null}
              </div>
            ) : null}

            {panelTab === "chapters" ? (
              <ChaptersEditor
              chapters={draft.chapters}
              stepCounts={new Map(draft.chapters.map((chapter) => [chapter.id, draft.steps.filter((step) => stepChapterId(draft, step) === chapter.id).length]))}
              onAdd={() => setDraft((current) => addDraftChapter(current))}
              onChange={(chapterId, patch) => setDraft((current) => updateDraftChapter(current, chapterId, patch))}
              onMove={(chapterId, direction) => setDraft((current) => moveDraftChapter(current, chapterId, direction))}
              onDelete={(chapterId) => setDraft((current) => deleteDraftChapter(current, chapterId))}
            />
            ) : null}

            {panelTab === "steps" ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-bold text-slate-900 dark:text-white">Steps</h2>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" aria-pressed={expandAll} onClick={() => setExpandAll((value) => !value)}>
                      {expandAll ? "Focus one" : "Show all"}
                    </Button>
                    <Button size="sm" variant="ghost" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => insertAndFocus(null)}>
                      Add step
                    </Button>
                  </div>
                </div>
                {draft.steps.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500 dark:border-slate-600">
                    Start recording and interact with the fixture — narrating as you go, or silently with actions only. Semantic actions will become editable steps.
                  </p>
                ) : expandAll ? (
                  draft.steps.map((step, index) => (
                    <StepEditor
                      key={step.id}
                      step={step}
                      onCaptureScreenshot={() => captureStepScreenshot(step.id)}
                      onCaptureStep={() => captureSelectedScreenshots([step.id])}
                      expectedFingerprint={screenshotFingerprintForStep(draft, step.id)}
                      screenshotDisabled={status !== "idle" || preview !== null}
                      index={index}
                      count={draft.steps.length}
                      chapters={draft.chapters}
                      chapterId={stepChapterId(draft, step)}
                      onInsertAfter={() => insertAndFocus(step.id)}
                      onDuplicate={() => setDraft((current) => duplicateDraftStep(current, step.id))}
                      suggestion={suggestedCheckForStep(draft, step.id, environment.suggestions)}
                      liveView={liveView}
                      onGoToView={step.context && !preview && status === "idle" ? () => void goToStepView(step) : undefined}
                      anchorOnScreen={tutorialContextMatches(step.context, liveView) && (!step.anchor || fixtureAnchors.has(step.anchor))}
                      paths={hostManifest?.snapshotPaths ?? WORKSPACE_SNAPSHOT_PATHS}
                      picking={pickingStepId === step.id}
                      pickingFocus={focusPicker?.stepId === step.id}
                      onPickFocus={(request) => { setPickingStepId(null); setFocusPicker(request ? { ...request, stepId: step.id } : null); }}
                      onPick={() => {
                        setFocusPicker(null);
                        setPickingStepId((current) => (current === step.id ? null : step.id));
                        setMessage("Pick an anchor: hover the fixture and click the highlighted control. Escape cancels.");
                      }}
                      onChange={(patch) => setDraft((current) => updateDraftStep(current, step.id, patch))}
                      onMove={(direction) => setDraft((current) => moveDraftStep(current, step.id, direction))}
                      onSplit={() => setDraft((current) => splitDraftStep(current, step.id))}
                      onDelete={() => {
                        const neighbour = draft.steps[index + 1]?.id ?? draft.steps[index - 1]?.id ?? null;
                        setDraft((current) => deleteDraftStep(current, step.id));
                        setSelectedStepId(neighbour);
                      }}
                    />
                  ))
                ) : (
                  <>
                    <StepRail
                      draft={draft}
                      selectedStepId={selectedStep?.id ?? null}
                      fixtureAnchors={fixtureAnchors}
                      anchorRects={anchorRects}
                      onSelect={focusStep}
                      onReorder={(stepId, toIndex) => setDraft((current) => moveDraftStepTo(current, stepId, toIndex))}
                    />
                    {selectedStep ? (
                      <div className="space-y-2" data-testid="focused-step">
                        <div className="flex items-center justify-between text-xs text-slate-500">
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={selectedIndex <= 0}
                            onClick={() => focusStep(draft.steps[selectedIndex - 1].id)}
                          >
                            ← Previous
                          </Button>
                          <span>
                            Step {selectedIndex + 1} of {draft.steps.length}
                          </span>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={selectedIndex >= draft.steps.length - 1}
                            onClick={() => focusStep(draft.steps[selectedIndex + 1].id)}
                          >
                            Next →
                          </Button>
                        </div>
                        {(() => {
                          const step = selectedStep;
                          const index = selectedIndex;
                          return (
                            <StepEditor
                              key={step.id}
                              step={step}
                              onCaptureScreenshot={() => captureStepScreenshot(step.id)}
                              onCaptureStep={() => captureSelectedScreenshots([step.id])}
                              expectedFingerprint={screenshotFingerprintForStep(draft, step.id)}
                              screenshotDisabled={status !== "idle" || preview !== null}
                              index={index}
                              count={draft.steps.length}
                              chapters={draft.chapters}
                              chapterId={stepChapterId(draft, step)}
                              onInsertAfter={() => insertAndFocus(step.id)}
                      onDuplicate={() => setDraft((current) => duplicateDraftStep(current, step.id))}
                              suggestion={suggestedCheckForStep(draft, step.id, environment.suggestions)}
                              liveView={liveView}
                      onGoToView={step.context && !preview && status === "idle" ? () => void goToStepView(step) : undefined}
                      anchorOnScreen={tutorialContextMatches(step.context, liveView) && (!step.anchor || fixtureAnchors.has(step.anchor))}
                              paths={hostManifest?.snapshotPaths ?? WORKSPACE_SNAPSHOT_PATHS}
                              picking={pickingStepId === step.id}
                      pickingFocus={focusPicker?.stepId === step.id}
                      onPickFocus={(request) => { setPickingStepId(null); setFocusPicker(request ? { ...request, stepId: step.id } : null); }}
                              onPick={() => {
                                setFocusPicker(null);
                        setPickingStepId((current) => (current === step.id ? null : step.id));
                                setMessage("Pick an anchor: hover the fixture and click the highlighted control. Escape cancels.");
                              }}
                              onChange={(patch) => setDraft((current) => updateDraftStep(current, step.id, patch))}
                              onMove={(direction) => setDraft((current) => moveDraftStep(current, step.id, direction))}
                              onSplit={() => setDraft((current) => splitDraftStep(current, step.id))}
                              onDelete={() => {
                                const neighbour = draft.steps[index + 1]?.id ?? draft.steps[index - 1]?.id ?? null;
                                setDraft((current) => deleteDraftStep(current, step.id));
                                setSelectedStepId(neighbour);
                              }}
                            />
                          );
                        })()}
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}
          </div>
        </aside>
      </div>
    </section>
  );
}

function safeFilename(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "tutorial";
}

function downloadText(content: string, filename: string): void {
  downloadBlob(new Blob([content], { type: "application/json" }), filename);
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Clipboard access is unavailable. Export the draft instead.");
}


