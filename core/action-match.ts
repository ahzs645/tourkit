import { actionMatches, type TutorialActionEvent } from "./actions";
import { TutorialAliasStore } from "./references";
import type { TutorialSemanticAction } from "./schema";

export type TutorialObservedAction = TutorialActionEvent | TutorialSemanticAction;

export function matchesTutorialAction(
  expected: TutorialSemanticAction,
  observed: TutorialObservedAction,
  aliases = new TutorialAliasStore(),
): boolean {
  const event: TutorialActionEvent = "action" in observed
    ? observed
    : {
        action: observed.id,
        payload: observed.args,
        source: "system",
        timestamp: 0,
        sequence: 0,
      };
  return actionMatches(event, expected, aliases);
}

