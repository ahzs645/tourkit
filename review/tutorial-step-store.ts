/** Each mounted player/review pair can have its own current-step channel. */
export interface TutorialReviewStepStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): number;
  getServerSnapshot(): number;
  /** Pass directly to the player's onStepChange callback. */
  reportStep(step: unknown, index: number): void;
  reset(): void;
}
export function createTutorialReviewStepStore(): TutorialReviewStepStore {
  let currentStepIndex = 0;
  const listeners = new Set<() => void>();
  const update = (index: number) => {
    if (!Number.isInteger(index) || index < 0 || index === currentStepIndex) return;
    currentStepIndex = index;
    listeners.forEach((listener) => listener());
  };
  return {
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => currentStepIndex,
    getServerSnapshot: () => 0,
    reportStep: (_step, index) => update(index),
    reset: () => update(0),
  };
}
