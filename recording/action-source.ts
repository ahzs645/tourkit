import {
  tutorialActionBus,
  type TutorialActionEvent
} from "../core/actions";
import type { TutorialSemanticAction, TutorialViewContext } from "../core/schema";
import type {
  SubscribeToTutorialActions,
  TutorialRecorderAction
} from "./types";

export type TutorialAnchorResolver = (action: string, args?: Readonly<Record<string, import("../core/schema").TutorialValue>>) => string | undefined;

export interface RecorderActionSource {
  subscribe: SubscribeToTutorialActions;
}

export function createRecorderActionSource(
  subscribe: SubscribeToTutorialActions
): RecorderActionSource {
  return { subscribe };
}

/** Default adapter for application UI wired to the canonical tutorial action bus. */
export function subscribeToTutorialActionBus(
  listener: (action: TutorialRecorderAction) => void,
  inferAnchor?: TutorialAnchorResolver,
  bus: Pick<import("../core/actions").TutorialActionBus, "subscribe"> = tutorialActionBus,
): () => void {
  return bus.subscribe((event) => {
    // One gesture, one step: actions it caused are replayed by the gesture itself.
    if (event.source !== "derived") listener(actionEventForRecording(event, inferAnchor));
  });
}

export function actionEventForRecording(event: TutorialActionEvent, inferAnchor?: TutorialAnchorResolver): TutorialRecorderAction {
  return {
    id: event.action,
    args: event.payload,
    anchor: inferAnchor?.(event.action, event.payload),
    label: humanizeActionId(event.action)
  };
}

/** Adapter for iframe controllers whose stream already uses canonical semantic actions. */
export function subscribeToSemanticActionSource(
  subscribe: (listener: (action: TutorialSemanticAction, context?: TutorialViewContext) => void) => void | (() => void),
  inferAnchor?: TutorialAnchorResolver,
): SubscribeToTutorialActions {
  return (listener) =>
    subscribe((action, context) => {
      listener({
        context,
        id: action.id,
        args: action.args,
        resultAlias: action.resultAlias,
        anchor: inferAnchor?.(action.id, action.args),
        label: humanizeActionId(action.id)
      });
    });
}

function humanizeActionId(id: string): string {
  const words = id.replace(/[._:-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "Recorded action";
}


