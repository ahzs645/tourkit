import { NEUTRAL_TUTORIAL_DOM_POLICY, type TutorialDomPolicy } from "../../player/dom-policy";

/** The project host owns the meaning of its snapshot paths; the kit does not infer them. */
export const PROJECT_DOM_POLICY: TutorialDomPolicy = {
  ...NEUTRAL_TUTORIAL_DOM_POLICY,
  stepExpectsDialog: (step) => (step.check?.all ?? []).some((clause) =>
    clause.path === "surfaces.create.open" && clause.equals === true),
};
