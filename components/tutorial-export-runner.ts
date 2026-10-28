"use client";

import { exportTutorial, tutorialExportFormat, type TutorialExportFormat, type TutorialExportSource } from "../export";
import type { TutorialExportOptions } from "../export/options";
import { tutorialScreenshotFingerprint, type TutorialScreenshot } from "../core/screenshot";
import type { TutorialCaptureStep } from "../recording/capture-all";
import { findTutorialAnchor, resolveRingElement, visibleBoxOf } from "../player/anchor";
import type { TutorialStudioEnvironment } from "../studio/environment";
import { syncStageOverlay } from "../studio/stage-overlay";

/**
 * Screenshots taken for an export, kept for this page session only and never
 * written back into the tutorial. Keyed by tutorial and framing, then step.
 */
export type TutorialScreenshotCache = Map<string, Record<string, TutorialScreenshot>>;

export function tutorialSourceId(source: TutorialExportSource): string {
  return "draft" in source ? source.draft.id : source.manifest.id;
}

export function tutorialSourceTitle(source: TutorialExportSource): string {
  return "draft" in source ? source.draft.title : source.manifest.title;
}

/** A changed launch or replay sequence must not reuse another screen from this dialog's cache. */
export function tutorialScreenshotCacheKey(source: TutorialExportSource, framing: TutorialExportOptions["screenshotFraming"]): string {
  const value = "draft" in source ? source.draft : source.manifest;
  const steps = "draft" in source ? source.draft.steps : source.manifest.chapters.flatMap((chapter) => chapter.steps);
  return `${tutorialSourceId(source)}:${framing}:${tutorialScreenshotFingerprint({ launch: value.launch,
    steps: steps.map((step) => ({ id: step.id, action: step.action, check: step.check, anchor: step.anchor, target: step.target,
      title: "instruction" in step ? step.title : step.overlay.title,
      instruction: "instruction" in step ? step.instruction : step.overlay.body, screenshotMode: step.screenshotMode })) })}`;
}

export function tutorialSourceSteps(source: TutorialExportSource): { id: string; screenshot?: TutorialScreenshot; screenshotMode?: "auto" | "none" }[] {
  return "draft" in source ? source.draft.steps : source.manifest.chapters.flatMap((chapter) => chapter.steps);
}

/** Steps an export will have to photograph: no saved screenshot and none taken yet this session. */
export function stepsNeedingScreenshots(source: TutorialExportSource, taken: Record<string, TutorialScreenshot> = {}): number {
  return tutorialSourceSteps(source).filter((step) => step.screenshotMode !== "none" && !step.screenshot && !taken[step.id]).length;
}

/** Saved (authored) screenshots win; session screenshots fill the rest. */
function withScreenshots(source: TutorialExportSource, taken: Record<string, TutorialScreenshot>): TutorialExportSource {
  const pick = <T extends { id: string; screenshot?: TutorialScreenshot; screenshotMode?: "auto" | "none" }>(step: T): T =>
    ({ ...step, screenshot: step.screenshotMode === "none" ? step.screenshot : step.screenshot ?? taken[step.id] });
  return "draft" in source
    ? { draft: { ...source.draft, steps: source.draft.steps.map(pick) } }
    : { manifest: { ...source.manifest, chapters: source.manifest.chapters.map((chapter) => ({ ...chapter, steps: chapter.steps.map(pick) })) } };
}

/** What a step rings, and the list it has open, so a crop shows both. */
function focusOf(doc: Document, step: TutorialCaptureStep): Element[] {
  const anchor = step.anchorId ? findTutorialAnchor(doc, step.anchorId) : null;
  const target = step.targetId ? findTutorialAnchor(doc, step.targetId) : null;
  const base = target ?? anchor;
  if (!base) return [];
  return [visibleBoxOf(base), resolveRingElement(anchor ?? base, step.targetId)];
}

function drawOverlay(frame: HTMLIFrameElement, step: TutorialCaptureStep) {
  syncStageOverlay(frame, [{ ...step, focused: true, pointer: false }], { highlight: true, markers: false, card: false });
}

/**
 * Builds one export file. Guide formats that include screenshots replay the
 * tutorial off-screen first and photograph each step on demand; nothing is
 * captured ahead of time and nothing is saved into the tutorial.
 */
export async function runTutorialExport({ source, format, options, cache, signal, onProgress, environment }: {
  source: TutorialExportSource;
  format: TutorialExportFormat;
  options: TutorialExportOptions;
  cache: TutorialScreenshotCache;
  signal: AbortSignal;
  onProgress: (message: string) => void;
  environment?: Pick<TutorialStudioEnvironment, "exportRuntime" | "captureRuntime"> & Partial<Pick<TutorialStudioEnvironment, "createDraftStore">>;
}): Promise<{ blob: Blob; filename: string }> {
  const entry = tutorialExportFormat(format);
  let input = source;
  if (entry.reading && options.includeScreenshots) {
    const key = tutorialScreenshotCacheKey(source, options.screenshotFraming);
    const taken = { ...cache.get(key) };
    if (stepsNeedingScreenshots(source, taken) > 0) {
      const { captureMissingTutorialScreenshots } = await import("../recording/capture-all");
      try {
        await captureMissingTutorialScreenshots(withScreenshots(source, taken), {
          ...environment?.captureRuntime,
          draftStore: environment?.captureRuntime?.draftStore ?? environment?.createDraftStore?.(),
          signal, onProgress, drawOverlay, focus: focusOf, framing: options.screenshotFraming,
          onScreenshot: (stepId, screenshot) => { taken[stepId] = screenshot; },
        });
      } finally {
        // A cancelled or failed run keeps what it took, so trying again resumes.
        cache.set(key, taken);
      }
    }
    input = withScreenshots(source, taken);
  }
  signal.throwIfAborted();
  onProgress(`Building ${entry.label}…`);
  return exportTutorial(input, format, onProgress, options, environment?.exportRuntime);
}

