import { TutorialViewStateSchema, type TutorialViewState } from "../core/view-context";

/** Private, same-origin handshake between an export dialog and its isolated replay frame. */
export const TUTORIAL_CAPTURE_PROTOCOL = "tourkit-capture-v1";
export type TutorialCaptureMessage = {
  protocol: typeof TUTORIAL_CAPTURE_PROTOCOL;
  token: string;
  /** `before` is sent only to a parent that asked for it (`tutorialCaptureBefore`):
      the step's interface as a learner meets it, before its action runs. */
  type: "before" | "step" | "captured" | "complete" | "error";
  stepId?: string;
  error?: string;
  /** Allowlisted surface slugs only, so audits can bind controls to their actual pre-action view. */
  view?: TutorialViewState;
};

export function isCaptureMessage(value: unknown, token: string): value is TutorialCaptureMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as TutorialCaptureMessage;
  return message.protocol === TUTORIAL_CAPTURE_PROTOCOL && message.token === token
    && ["before", "step", "captured", "complete", "error"].includes(message.type)
    && (message.stepId === undefined || typeof message.stepId === "string")
    && (message.error === undefined || typeof message.error === "string")
    && (message.view === undefined || TutorialViewStateSchema.safeParse(message.view).success);
}

