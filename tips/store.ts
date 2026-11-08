/**
 * One-time tips: which tip may be on screen and which ones a person dismissed.
 *
 * The queue is shared by every tip on the page, so only one is ever visible.
 * Tips queue in mount order. After a dismissal the next tip waits for a later
 * page load rather than chaining. Dismissals persist in localStorage under a
 * host-chosen key (scope it per user, for example), and storage failures only
 * mean a tip shows again. Nothing here imports React.
 */

export const DEFAULT_TIP_STORAGE_KEY = "tourkit.tips.dismissed";
export const DEFAULT_TIP_FORCE_KEY = "tourkit.tips.force";

export interface TipQueueState {
  /** Keys asking to be shown, in mount order. */
  readonly queue: readonly string[];
  /** Set after a dismissal so a second tip waits for the next page load. */
  readonly cooledDown: boolean;
  /** Bumped whenever persisted dismissals change. */
  readonly version: number;
}

let state: TipQueueState = { queue: [], cooledDown: false, version: 0 };
const listeners = new Set<() => void>();

function emit(next: Partial<TipQueueState>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

export function subscribeTips(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getTipQueueState(): TipQueueState {
  return state;
}

export function readDismissedTips(storageKey: string = DEFAULT_TIP_STORAGE_KEY): string[] {
  try {
    const raw = window.localStorage.getItem(storageKey);
    const value: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(value) ? value.filter((key): key is string => typeof key === "string") : [];
  } catch {
    return [];
  }
}

function writeDismissedTips(storageKey: string, keys: readonly string[]) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(keys));
  } catch {
    // Storage blocked (private mode, quota): the tip simply shows again next time.
  }
}

/** Ask for `key` to be shown once it reaches the front of the queue. */
export function requestTip(key: string): void {
  if (!state.queue.includes(key)) emit({ queue: [...state.queue, key] });
}

/** Withdraw `key` from the queue without dismissing it (it unmounted or lost its anchor). */
export function releaseTip(key: string): void {
  if (state.queue.includes(key)) emit({ queue: state.queue.filter((queued) => queued !== key) });
}

/** Remember that `key` was dismissed and hold further tips until the next page load. */
export function dismissTip(key: string, storageKey: string = DEFAULT_TIP_STORAGE_KEY): void {
  const keys = readDismissedTips(storageKey);
  if (!keys.includes(key)) writeDismissedTips(storageKey, [...keys, key]);
  emit({
    queue: state.queue.filter((queued) => queued !== key),
    cooledDown: true,
    version: state.version + 1,
  });
}

/** Forget every dismissed tip under `storageKey` so they show again. */
export function resetTips(storageKey: string = DEFAULT_TIP_STORAGE_KEY): void {
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // Nothing persisted to clear.
  }
  emit({ cooledDown: false, version: state.version + 1 });
}

/**
 * Tips are for people. Automated browsers (end-to-end tests, screenshot
 * scripts, crawlers) report `navigator.webdriver`, and get the page without
 * tips so one never covers the control a script is about to use. Setting
 * localStorage `forceKey` to "1" shows tips under automation.
 */
export function isAutomatedBrowser(forceKey: string = DEFAULT_TIP_FORCE_KEY): boolean {
  if (typeof navigator === "undefined" || !navigator.webdriver) return false;
  try {
    return window.localStorage.getItem(forceKey) !== "1";
  } catch {
    return true;
  }
}
