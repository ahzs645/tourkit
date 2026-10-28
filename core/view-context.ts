import { z } from "zod";
import { readTutorialStatePath } from "./checks";
import { TutorialViewPathSchema, type TutorialSemanticAction, type TutorialViewContext } from "./schema";

/** Application-provided navigation that restores a step's structural view. */
export type TutorialContextActionResolver = (context: TutorialViewContext) => readonly TutorialSemanticAction[];

export const TutorialViewStateSchema = z.partialRecord(TutorialViewPathSchema, z.union([z.string().max(160), z.null()]));

export type TutorialViewState = Partial<Record<TutorialViewContext["all"][number]["path"], string | null>>;
export const TUTORIAL_NAVIGATION_ACTION_KINDS = new Set(["selectModule", "selectNode", "selectTab", "navigate", "switchBrowserTab", "selectMenuItem", "selectView"]);

/** Only allowlisted surface slugs cross the authoring frame boundary. */
export function tutorialViewState(state: unknown): TutorialViewState {
  const result: TutorialViewState = {};
  for (const path of TutorialViewPathSchema.options) {
    const value = readTutorialStatePath(state, path);
    if (value === null || (typeof value === "string" && value.length <= 160)) result[path] = value;
  }
  return result;
}

export function tutorialContextMatches(context: TutorialViewContext | undefined, state: unknown): boolean {
  return !context || context.all.every(({ path, equals }) => {
    const value = state && typeof state === "object" && Object.prototype.hasOwnProperty.call(state, path)
      ? (state as TutorialViewState)[path] : readTutorialStatePath(state, path);
    return value === equals;
  });
}

export function tutorialActionChangesView(action: Pick<TutorialSemanticAction, "id">): boolean {
  return TUTORIAL_NAVIGATION_ACTION_KINDS.has(action.id.split(".").at(-1)!)
    || /\.(openWindow|openUtility|closeWindow|menu|lookup|status)$/.test(action.id);
}
