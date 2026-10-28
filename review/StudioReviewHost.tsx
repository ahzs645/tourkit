"use client";

import { useMemo } from "react";
import { Crosshair } from "lucide-react";

import { Button } from "../ui/button";
import type { ReviewableField, ReviewSubjectKind } from "./model";
import { ReviewInboxHost } from "./ReviewInboxDrawer";
import { tutorialReviewParts } from "./surfaces";

const STUDIO_KINDS = ["tutorial"] as const;

/** Manifest ids are draft ids with unsafe characters replaced (recording/draft.ts). */
const manifestId = (id: string) => id.trim().replace(/[^a-z0-9._:-]+/gi, "-").replace(/^-+|-+$/g, "");

export interface StudioReviewDraft {
  id: string;
  steps: ReadonlyArray<{ id: string; title: string; instruction: string; label?: string; anchor?: string; target?: string; action?: { id: string } }>;
}

/**
 * Tutorial Studio's review inbox: tutorial reviews against the draft that is
 * open (an item goes to its step), and EMR emulator reviews, worked through
 * as a fidelity checklist.
 */
export function StudioReviewHost({ draft, onFocusStep, kinds = STUDIO_KINDS }: { draft: StudioReviewDraft; onFocusStep: (stepId: string) => void; kinds?: readonly ReviewSubjectKind[] }) {
  const stepIdFor = useMemo(() => new Map(draft.steps.map((step) => [manifestId(step.id), step.id])), [draft.steps]);
  const parts = useMemo(() => new Map<string, ReviewableField>(tutorialReviewParts(draft.steps.map((step) => ({
    id: manifestId(step.id),
    title: step.label ?? step.title,
    body: step.instruction,
    anchorId: step.anchor,
    targetId: step.target,
    actionId: step.action?.id,
  }))).map((part) => [part.id, part])), [draft.steps]);
  const isThisDraft = (id: string | undefined) => Boolean(id) && (id === draft.id || id === manifestId(draft.id));

  return (
    <ReviewInboxHost
      kinds={kinds}
      dropHint="open it here"
      partsFor={(bundle) => (bundle.form.kind === "tutorial" && isThisDraft(bundle.form.id) ? parts : new Map())}
      itemActions={(item, bundle, close) => {
        const stepId = item.anchor.fieldId ? stepIdFor.get(item.anchor.fieldId) : undefined;
        if (bundle.form.kind !== "tutorial" || !isThisDraft(bundle.form.id) || !stepId) return null;
        return (
          <Button size="sm" variant="secondary" leftIcon={<Crosshair className="h-3.5 w-3.5" />} onClick={() => { onFocusStep(stepId); close(); }}>
            Go to step
          </Button>
        );
      }}
    />
  );
}

