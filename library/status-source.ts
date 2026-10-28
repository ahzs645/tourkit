"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { EMPTY_TUTORIAL_LIBRARY_STATUSES, type TutorialLibraryStatuses, type TutorialLibraryStatus } from "./model";

export interface TutorialLibraryStatusSource {
  /** Return an immutable, referentially stable snapshot until the source changes. */
  getSnapshot(tutorialIds: readonly string[]): TutorialLibraryStatuses;
  subscribe(listener: () => void): () => void;
}

export interface TutorialLibraryStatusReaders {
  readCompletions(): Readonly<Record<string, { completedAt: number }>>;
  readProgress(tutorialId: string): { stepIndex: number } | null | undefined;
  /** Include same-document writes as well as cross-tab storage events. */
  subscribe?(listener: () => void): () => void;
}

/**
 * Adapts any persistence scope. Each instance owns its cache and subscriptions;
 * changing a catalog to different IDs of the same length cannot reuse its status.
 * invalidate() is also available for hosts without an observable backing store.
 */
export function createTutorialLibraryStatusSource(readers: TutorialLibraryStatusReaders): TutorialLibraryStatusSource & { invalidate(): void } {
  const snapshots = new Map<string, TutorialLibraryStatuses>();
  const listeners = new Set<() => void>();
  let unsubscribe: (() => void) | undefined;
  const invalidate = () => {
    snapshots.clear();
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot(tutorialIds) {
      const key = JSON.stringify(tutorialIds);
      const cached = snapshots.get(key);
      if (cached) return cached;
      const completions = readers.readCompletions();
      const statuses: Record<string, TutorialLibraryStatus> = {};
      for (const id of tutorialIds) {
        const status: TutorialLibraryStatus = {};
        if (completions[id]) status.completedAt = completions[id].completedAt;
        const progress = readers.readProgress(id);
        if (progress && Number.isInteger(progress.stepIndex) && progress.stepIndex >= 0) {
          status.inProgressStep = progress.stepIndex + 1;
        }
        if (status.completedAt !== undefined || status.inProgressStep !== undefined) statuses[id] = Object.freeze(status);
      }
      const snapshot = Object.freeze(statuses);
      snapshots.set(key, snapshot);
      return snapshot;
    },
    subscribe(listener) {
      if (listeners.size === 0) {
        // The backing store may have changed while no library was mounted.
        snapshots.clear();
        unsubscribe = readers.subscribe?.(invalidate);
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          unsubscribe?.();
          unsubscribe = undefined;
          snapshots.clear();
        }
      };
    },
    invalidate,
  };
}

export function useTutorialLibraryStatuses(tutorialIds: readonly string[], source: TutorialLibraryStatusSource): TutorialLibraryStatuses {
  const idsKey = JSON.stringify(tutorialIds);
  const ids = useMemo<readonly string[]>(() => JSON.parse(idsKey), [idsKey]);
  const getSnapshot = useCallback(() => source.getSnapshot(ids), [source, ids]);
  const subscribe = useCallback((listener: () => void) => source.subscribe(listener), [source]);
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_TUTORIAL_LIBRARY_STATUSES);
}
