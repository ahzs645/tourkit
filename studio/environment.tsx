"use client";

import { createContext, useContext, useEffect, useState, type ComponentType, type ReactNode } from "react";
import { buildTutorialLaunchUrl, type TutorialLaunch, type TutorialManifest, type TutorialMode, type TutorialSemanticAction, type TutorialViewContext } from "../core/schema";
import { tutorialActionChangesView, type TutorialViewState } from "../core/view-context";
import { createTutorialRecordingDraft } from "../recording/draft";
import { createDefaultTutorialDraftStore, type TutorialDraftStore } from "../recording/draft-store";
import type { TutorialRecordingDraft, TutorialRecordingStep } from "../recording/types";
import type { TutorialAnchorResolver } from "../recording/action-source";
import type { TutorialCheckSuggestionProvider } from "../recording/check-suggestions";
import type { captureTutorialInterface } from "../recording/capture-interface";
import type { TutorialExportRuntime } from "../export";
import type { TutorialExportOptions } from "../export/options";
import type { TutorialExportPresetProfile } from "../export/presets";
import type { buildTutorialAiEditingPrompt } from "../recording/ai-prompt";
import { createTutorialShareCodec, type TutorialShareCodec } from "../share";

/** A stage is an application-owned screen, not an implementation of an EMR. */
export interface TutorialStudioStage {
  id: string;
  label: string;
  path: string;
  defaultFixture: string;
  fixtures: readonly { id: string; label: string; description?: string }[];
  snapshotPaths: readonly string[];
  windowSize?: { width: number; height: number };
}

export interface TutorialReviewHostProps {
  draft: TutorialRecordingDraft;
  onFocusStep: (stepId: string) => void;
}

/**
 * All application choices needed by the authoring interface. It is supplied
 * per React tree; two editors may use different apps, catalogs and stores.
 * The defaults do not import a host registry, lesson pack or form builder.
 */
export interface TutorialStudioEnvironment {
  builtInTutorials: readonly TutorialManifest[];
  tracks: readonly { id: TutorialManifest["track"]; title: string }[];
  isDeferredTutorialId: (id: string | null | undefined) => boolean;
  isBuiltInTutorialId: (id: string) => boolean;
  peekTutorial: (id: string | null | undefined) => TutorialManifest | null;
  loadTutorial: (id: string | null | undefined) => Promise<TutorialManifest | null>;
  peekAllTutorials: () => readonly TutorialManifest[];
  loadAllTutorials: () => Promise<readonly TutorialManifest[]>;
  stages: readonly TutorialStudioStage[];
  defaultStageId: string;
  defaultStageLabel: string;
  getStage: (id: string) => TutorialStudioStage | null;
  stageOfLaunch: (launch: TutorialLaunch) => string;
  launchForStage: (id: string, current: TutorialLaunch) => TutorialLaunch;
  readPreferredStage: () => string;
  writePreferredStage: (id: string) => void;
  canSeek: (id: string) => boolean;
  defaultSnapshotPaths: readonly string[];
  createInitialDraft?: () => TutorialRecordingDraft;
  createDraft: (stage?: string) => TutorialRecordingDraft;
  createDraftStore: () => TutorialDraftStore;
  resolvePath: (path: string) => string;
  studioPath: string;
  buildTutorialHref: (tutorial: TutorialManifest, mode: TutorialMode) => string;
  viewContext: (state: TutorialViewState) => TutorialViewContext | undefined;
  resolveContextActions: (context: TutorialViewContext) => readonly TutorialSemanticAction[];
  actionChangesView: (action: Pick<TutorialSemanticAction, "id">) => boolean;
  selectedStepView: (step: TutorialRecordingStep, preceding: readonly TutorialRecordingStep[]) => TutorialViewContext | undefined;
  suggestions?: TutorialCheckSuggestionProvider;
  inferAnchor?: TutorialAnchorResolver;
  exportRuntime?: TutorialExportRuntime;
  buildAiEditingPrompt?: typeof buildTutorialAiEditingPrompt;
  exportPresets?: TutorialExportPresetProfile;
  contentTemplates?: import("../recording/content-blocks").TutorialContentTemplateStore;
  exportPreferences?: { defaults: TutorialExportOptions; read: () => TutorialExportOptions; save: (options: TutorialExportOptions) => void };
  interactiveExportDescription: string;
  actionExample: string;
  captureRuntime?: { draftStore?: TutorialDraftStore; resolveLaunchUrl?: (launch: TutorialLaunch) => string; captureInterface?: typeof captureTutorialInterface };
  shareCodec: TutorialShareCodec;
  review?: {
    Host?: ComponentType<TutorialReviewHostProps>;
    openInbox?: () => void;
    startUrl: (url: string, origin?: string) => string;
  };
  hubAreas: readonly { id: string; label: string; href: string; stage?: boolean }[];
  homeLink?: { label: string; href: string };
}

const EMPTY_TUTORIALS: readonly TutorialManifest[] = [];
const DEFAULT_LAUNCH: TutorialLaunch = { fixture: "tutorial-fixture", path: "/", hash: { tutorialAuthor: 1 } };

export const DEFAULT_TUTORIAL_STUDIO_ENVIRONMENT: TutorialStudioEnvironment = {
  builtInTutorials: EMPTY_TUTORIALS,
  tracks: [
    { id: "getting-started", title: "Getting started" },
    { id: "building", title: "Building" },
    { id: "logic", title: "Logic" },
    { id: "clinical-data", title: "Data" },
    { id: "delivery", title: "Delivery" },
  ],
  isDeferredTutorialId: () => false,
  isBuiltInTutorialId: () => false,
  peekTutorial: () => null,
  loadTutorial: async () => null,
  peekAllTutorials: () => EMPTY_TUTORIALS,
  loadAllTutorials: async () => EMPTY_TUTORIALS,
  stages: [],
  defaultStageId: "workspace",
  defaultStageLabel: "Application",
  getStage: () => null,
  stageOfLaunch: () => "workspace",
  launchForStage: (_id, current) => current,
  readPreferredStage: () => "workspace",
  writePreferredStage: () => {},
  canSeek: () => false,
  defaultSnapshotPaths: [],
  createDraft: () => createTutorialRecordingDraft({ title: "New tutorial", fixture: DEFAULT_LAUNCH.fixture, path: DEFAULT_LAUNCH.path, hash: DEFAULT_LAUNCH.hash }),
  createDraftStore: createDefaultTutorialDraftStore,
  resolvePath: (path) => path,
  studioPath: "/tutorial/studio/",
  buildTutorialHref: (tutorial, mode) => buildTutorialLaunchUrl({ ...tutorial.launch, hash: { ...tutorial.launch.hash, tutorial: tutorial.id, tutorialMode: mode, tutorialSpotlight: tutorial.spotlightStyle } }),
  viewContext: () => undefined,
  resolveContextActions: () => [],
  actionChangesView: tutorialActionChangesView,
  selectedStepView: (step) => step.context,
  interactiveExportDescription: "Includes the configured training interface, Watch and Try it modes, and recorded narration when available.",
  actionExample: "application.action",
  shareCodec: createTutorialShareCodec({ allowedLaunchPaths: () => new Set(["/"]) }),
  hubAreas: [
    { id: "tutorials", label: "Tutorials", href: "/tutorial/" },
    { id: "studio", label: "Studio", href: "/tutorial/studio/" },
  ],
};

const EnvironmentContext = createContext<TutorialStudioEnvironment>(DEFAULT_TUTORIAL_STUDIO_ENVIRONMENT);

export function TutorialStudioEnvironmentProvider({ environment, children }: { environment: TutorialStudioEnvironment; children: ReactNode }) {
  return <EnvironmentContext.Provider value={environment}>{children}</EnvironmentContext.Provider>;
}

export function useTutorialStudioEnvironment(): TutorialStudioEnvironment {
  return useContext(EnvironmentContext);
}

/** Lazy catalog reads are implemented here; adapters supply data, not hooks. */
export function useEnvironmentTutorial(id: string | null | undefined) {
  const environment = useTutorialStudioEnvironment();
  const [resolved, setResolved] = useState<{ environment: TutorialStudioEnvironment; id: string | null | undefined; tutorial: TutorialManifest | null } | null>(null);
  const known = environment.peekTutorial(id);
  const deferred = environment.isDeferredTutorialId(id);
  useEffect(() => {
    if (known || !deferred) return;
    let active = true;
    void environment.loadTutorial(id).then((tutorial) => { if (active) setResolved({ environment, id, tutorial }); }, () => { if (active) setResolved({ environment, id, tutorial: null }); });
    return () => { active = false; };
  }, [deferred, environment, id, known]);
  const loaded = resolved?.environment === environment && resolved.id === id ? resolved : null;
  return { tutorial: known ?? loaded?.tutorial ?? null, loading: !known && deferred && !loaded };
}

export function useEnvironmentTutorials(enabled = true) {
  const environment = useTutorialStudioEnvironment();
  const [loaded, setLoaded] = useState<{ environment: TutorialStudioEnvironment; tutorials: readonly TutorialManifest[] } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void environment.loadAllTutorials().then((tutorials) => { if (active) setLoaded({ environment, tutorials }); }, () => { if (active) setLoaded({ environment, tutorials: environment.peekAllTutorials() }); });
    return () => { active = false; };
  }, [enabled, environment]);
  const current = loaded?.environment === environment ? loaded.tutorials : null;
  return { tutorials: current ?? environment.peekAllTutorials(), loading: enabled && current === null };
}

