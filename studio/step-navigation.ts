import type { TutorialViewContext } from "../core/schema";
import type { TutorialRecordingStep } from "../recording/types";

/** Explicit step context is portable. Applications may supply navigation inference. */
export function selectedStepView(step: TutorialRecordingStep, preceding: readonly TutorialRecordingStep[], resolve?: (step: TutorialRecordingStep, preceding: readonly TutorialRecordingStep[]) => TutorialViewContext | undefined): TutorialViewContext | undefined {
  return resolve ? resolve(step, preceding) : step.context;
}

type NavigationJob = (signal: AbortSignal, isCurrent: () => boolean) => Promise<void>;

/** Coalesce clicks while navigation settles; never run frame restorations concurrently. */
export function createLatestStepNavigation(onBusy: (busy: boolean) => void, onError?: (error: unknown) => void) {
  let generation = 0;
  let pending: { generation: number; run: NavigationJob } | undefined;
  let running = false;
  let active: AbortController | undefined;
  const drain = async () => {
    running = true;
    onBusy(true);
    try {
      while (pending) {
        const job = pending;
        pending = undefined;
        active = new AbortController();
        try { await job.run(active.signal, () => job.generation === generation); }
        catch (error) { if (job.generation === generation) onError?.(error); }
      }
    } finally {
      running = false;
      active = undefined;
      onBusy(false);
    }
  };
  return {
    request(run: NavigationJob) {
      pending = { generation: ++generation, run };
      active?.abort();
      if (!running) void drain();
    },
    cancel() {
      generation++;
      pending = undefined;
      active?.abort();
    },
  };
}

