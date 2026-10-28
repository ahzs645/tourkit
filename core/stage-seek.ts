import { z } from "zod";
import { TutorialAliasStore, resolveTutorialReferences } from "./references";
import {
  TutorialSemanticActionSchema,
  TutorialValueSchema,
  TutorialViewContextSchema,
  type TutorialSemanticAction,
  type TutorialViewContext,
} from "./schema";
import { tutorialContextMatches, type TutorialContextActionResolver } from "./view-context";

const noContextActions: TutorialContextActionResolver = () => [];

/**
 * Seeking a stage to a step: start from the lesson's fixture and replay every
 * earlier step, the way "Preview from step" catches a learner up. Navigation
 * alone cannot reach a state an earlier step created — a dialog it opened, a
 * draft it started, a form it submitted — so a multi-page host lesson (an
 * Add Form → Start Filling → Approve path) is only reachable by
 * replaying it. Only stages whose state is a throwaway fixture offer this.
 */
export const TutorialSeekEntrySchema = z.strictObject({
  action: TutorialSemanticActionSchema.optional(),
  context: TutorialViewContextSchema.optional(),
});
export type TutorialSeekEntry = z.infer<typeof TutorialSeekEntrySchema>;
export const TutorialSeekEntriesSchema = z.array(TutorialSeekEntrySchema).max(500);

/** What to replay to stand just before `steps[index]`: its predecessors' views and actions. */
export function tutorialSeekEntries(
  steps: readonly { action?: TutorialSemanticAction; context?: TutorialViewContext }[],
  index: number,
): TutorialSeekEntry[] {
  return steps.slice(0, Math.max(0, index)).flatMap((step) =>
    step.action || step.context ? [{ ...(step.action ? { action: step.action } : {}), ...(step.context ? { context: step.context } : {}) }] : []);
}

export interface TutorialSeekRunner {
  execute: (action: TutorialSemanticAction) => unknown;
  /** The stage's current snapshot, read fresh after every action. */
  readState: () => unknown;
  signal?: AbortSignal;
  /** Navigation is supplied by the consuming application, never inferred by the kit. */
  resolveContextActions?: TutorialContextActionResolver;
}

/** Replays seek entries on a freshly reset stage. Errors name the step that failed. */
export async function replayTutorialSeek(entries: readonly TutorialSeekEntry[], { execute, readState, signal, resolveContextActions = noContextActions }: TutorialSeekRunner): Promise<void> {
  const aliases = new TutorialAliasStore();
  for (const [index, entry] of entries.entries()) {
    signal?.throwIfAborted();
    try {
      if (entry.context && !tutorialContextMatches(entry.context, readState())) {
        for (const action of resolveContextActions(entry.context)) await execute(action);
        await settle(() => tutorialContextMatches(entry.context, readState()), signal);
      }
      if (entry.action) {
        const args = entry.action.args ? TutorialValueSchema.parse(resolveTutorialReferences(entry.action.args, aliases)) : undefined;
        if (args !== undefined && (!args || typeof args !== "object" || Array.isArray(args))) throw new Error("Action arguments must be an object.");
        const before = readState();
        const result = await execute({ ...entry.action, args: args as TutorialSemanticAction["args"] });
        if (entry.action.resultAlias) aliases.set(entry.action.resultAlias, result);
        // Let the stage commit before the next step reads its state; an action
        // that changes nothing the snapshot holds simply runs out the wait.
        await settle(() => readState() !== before, signal, 250);
        for (let turn = 0; turn < 3; turn++) await nextTask();
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Replaying step ${index + 1} failed: ${reason}`);
    }
  }
}

async function settle(done: () => boolean, signal: AbortSignal | undefined, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  do {
    await nextTask();
    signal?.throwIfAborted();
  } while (!done() && Date.now() < deadline);
}

/** One macrotask. A message, unlike a timer, is not throttled while the studio tab is in the background. */
function nextTask(): Promise<void> {
  if (typeof MessageChannel === "undefined") return new Promise((resolve) => setTimeout(resolve, 0));
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => { channel.port1.close(); resolve(); };
    channel.port2.postMessage(null);
  });
}

