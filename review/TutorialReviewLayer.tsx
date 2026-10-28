"use client";

import { useMemo, useSyncExternalStore } from "react";
import type { TutorialManifest } from "../core/schema";
import { ReviewFeedbackLayer } from "./ReviewFeedbackLayer";
import { readReviewFlag, tutorialReviewSurface, type ReviewTutorialStep } from "./surfaces";
import type { TutorialReviewStepStore } from "./tutorial-step-store";

const subscribeClientReady = () => () => {};
const readClientReady = () => true;
const readServerReady = () => false;

export interface TutorialReviewLayerProps {
  manifest: TutorialManifest;
  mode: string;
  /** The same scoped store whose reportStep callback is passed to the player. */
  stepStore: TutorialReviewStepStore;
  /** Omit to read #review=start / #review=continue after hydration. */
  enabled?: boolean;
  labelAnchor?: (id: string, element: HTMLElement) => string;
}

/** Optional review for a running lesson; no global player or application registry. */
export function TutorialReviewLayer({ manifest, mode, stepStore, enabled, labelAnchor }: TutorialReviewLayerProps) {
  const clientReady = useSyncExternalStore(subscribeClientReady, readClientReady, readServerReady);
  const stepIndex = useSyncExternalStore(stepStore.subscribe, stepStore.getSnapshot, stepStore.getServerSnapshot);
  const steps = useMemo<ReviewTutorialStep[]>(() => manifest.chapters.flatMap((chapter) => chapter.steps.map((step) => ({
    id: step.id,
    title: step.title ?? step.overlay.title,
    body: step.overlay.body,
    anchorId: step.anchor?.id,
    targetId: step.target?.id,
    actionId: step.action?.id,
  }))), [manifest]);
  const surface = useMemo(() => tutorialReviewSurface({ tutorialId: manifest.id, title: manifest.title, mode, steps, stepIndex, labelAnchor }),
    [manifest.id, manifest.title, mode, steps, stepIndex, labelAnchor]);
  if (!clientReady || !(enabled ?? readReviewFlag())) return null;
  return <ReviewFeedbackLayer surface={surface} fullscreen offerFeedback={false} />;
}
