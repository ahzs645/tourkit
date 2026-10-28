import { browserTutorialStorage, createTutorialStorageChannel, tutorialStorageKey, type TutorialStorageOptions } from "../shared/storage";
import type { TutorialMode } from "./types";

/**
 * Mid-run progress persistence, the way multi-page onboarding flows keep their
 * place: a reload or navigation resumes the learner at the step they were on
 * instead of restarting at step one. sessionStorage scopes it to the tab, and
 * finishing or explicitly stopping a tutorial clears it — resuming only ever
 * happens for a run that was interrupted, never one the learner ended.
 */
export interface TutorialSavedProgress {
  stepIndex: number;
  /** Launch mode; saved progress from a different mode is ignored. */
  mode: TutorialMode;
  /** Alias snapshot so later steps' {$ref} arguments survive the reload. */
  aliases: Record<string, unknown>;
  /** Epoch ms of the last save. */
  savedAt?: number;
}

export function createTutorialProgressStore(options: TutorialStorageOptions = {}) {
  const keyPrefix = tutorialStorageKey("progress:", options.namespace);
  const channel = createTutorialStorageChannel(options.storage ?? (() => browserTutorialStorage("sessionStorage")), (changed) => changed === null || changed.startsWith(keyPrefix));
  function read(
    tutorialId: string,
    mode: TutorialMode,
    stepCount: number,
  ): TutorialSavedProgress | null {
    const store = channel.storage();
    if (!store) return null;
    try {
      const raw = store.getItem(keyPrefix + tutorialId);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<TutorialSavedProgress>;
      if (!Number.isInteger(parsed.stepIndex)) return null;
      const stepIndex = parsed.stepIndex as number;
      if (stepIndex <= 0 || stepIndex >= stepCount) return null;
      if (parsed.mode !== mode) return null;
      const aliases = parsed.aliases && typeof parsed.aliases === "object" && !Array.isArray(parsed.aliases)
        ? (parsed.aliases as Record<string, unknown>)
        : {};
      return { stepIndex, mode: parsed.mode, aliases, savedAt: parsed.savedAt };
    } catch {
      return null;
    }
  }

  /**
   * Launcher-side peek at an interrupted run: step reached and mode, without the
   * mode/step-count gate `readTutorialProgress` applies at resume time. Lets the
   * library show "In progress — step N" beside a tutorial.
   */
  function peek(
    tutorialId: string,
  ): { stepIndex: number; mode: TutorialMode } | null {
    const store = channel.storage();
    if (!store) return null;
    try {
      const raw = store.getItem(keyPrefix + tutorialId);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<TutorialSavedProgress>;
      if (!Number.isInteger(parsed.stepIndex) || (parsed.stepIndex as number) <= 0) return null;
      if (parsed.mode !== "practice" && parsed.mode !== "autoplay") return null;
      return { stepIndex: parsed.stepIndex as number, mode: parsed.mode };
    } catch {
      return null;
    }
  }

  function save(tutorialId: string, progress: TutorialSavedProgress): void {
    try {
      const storage = channel.storage();
      if (!storage) return;
      storage.setItem(keyPrefix + tutorialId, JSON.stringify(progress));
      channel.notify(keyPrefix + tutorialId, storage);
    } catch {
      // Quota or serialization problems must never break a running tutorial.
    }
  }

  function clear(tutorialId: string): void {
    try {
      const storage = channel.storage();
      if (!storage) return;
      storage.removeItem(keyPrefix + tutorialId);
      channel.notify(keyPrefix + tutorialId, storage);
    } catch {
      // Ignore.
    }
  }


  return { read, peek, save, clear, subscribe: channel.subscribe };
}

export type TutorialProgressStore = ReturnType<typeof createTutorialProgressStore>;
export const defaultTutorialProgressStore = createTutorialProgressStore();
export const readTutorialProgress = defaultTutorialProgressStore.read;
export const peekTutorialProgress = defaultTutorialProgressStore.peek;
export const saveTutorialProgress = defaultTutorialProgressStore.save;
export const clearTutorialProgress = defaultTutorialProgressStore.clear;
export const subscribeTutorialProgress = defaultTutorialProgressStore.subscribe;
