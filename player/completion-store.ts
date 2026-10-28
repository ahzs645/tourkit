import { browserTutorialStorage, createTutorialStorageChannel, tutorialStorageKey, type TutorialStorageOptions } from "../shared/storage";
import type { TutorialMode } from "./types";

/**
 * Durable completion records, the launcher-side memory that checklist-style
 * onboarding products keep: which tutorials this browser has finished, and
 * when. Unlike mid-run progress (sessionStorage, one tab, cleared on finish),
 * completions live in localStorage so the library and the completion card can
 * show "Completed" and suggest what to try next across sessions.
 */
export interface TutorialCompletionRecord {
  /** Epoch ms of the finish. */
  completedAt: number;
  /** Mode the finishing run used. */
  mode: TutorialMode;
}

/** Without a namespace the store uses the shared `tourkit:completions` key. */
export function createTutorialCompletionStore(options: TutorialStorageOptions = {}) {
  const key = tutorialStorageKey("completions", options.namespace);
  const channel = createTutorialStorageChannel(options.storage ?? (() => browserTutorialStorage("localStorage")), (changed) => changed === null || changed === key);
  function read(): Record<string, TutorialCompletionRecord> {
    try {
      const parsed: unknown = JSON.parse(channel.storage()?.getItem(key) ?? "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      const records: Record<string, TutorialCompletionRecord> = {};
      for (const [id, value] of Object.entries(parsed)) {
        if (!value || typeof value !== "object" || Array.isArray(value)) continue;
        const { completedAt, mode } = value as Partial<TutorialCompletionRecord>;
        if (typeof completedAt !== "number" || !Number.isFinite(completedAt)) continue;
        if (mode !== "practice" && mode !== "autoplay") continue;
        Object.defineProperty(records, id, { value: { completedAt, mode }, enumerable: true, configurable: true, writable: true });
      }
      return records;
    } catch { return {}; }
  }
  function mark(tutorialId: string, mode: TutorialMode): void {
    try {
      const storage = channel.storage();
      if (!storage) return;
      storage.setItem(key, JSON.stringify({ ...read(), [tutorialId]: { completedAt: Date.now(), mode } }));
      channel.notify(key, storage);
    } catch { /* Storage must not break a finished tutorial. */ }
  }
  function clear(tutorialId?: string): void {
    try {
      const storage = channel.storage();
      if (!storage) return;
      if (tutorialId === undefined) storage.removeItem(key);
      else { const records = read(); delete records[tutorialId]; storage.setItem(key, JSON.stringify(records)); }
      channel.notify(key, storage);
    } catch { /* Optional local persistence. */ }
  }
  return { read, mark, clear, subscribe: channel.subscribe };
}

export type TutorialCompletionStore = ReturnType<typeof createTutorialCompletionStore>;
export const defaultTutorialCompletionStore = createTutorialCompletionStore();
export const readTutorialCompletions = defaultTutorialCompletionStore.read;
export const markTutorialCompleted = defaultTutorialCompletionStore.mark;
export const subscribeTutorialCompletions = defaultTutorialCompletionStore.subscribe;
