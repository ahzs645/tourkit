import { labelNear } from "./dom";
import {
  TUTORIAL_ANCHOR_ATTRIBUTE,
  type ReviewableField,
  type ReviewItem,
  type ReviewSubjectKind,
} from "./model";

/**
 * What a review needs to know about the thing being reviewed. The feedback
 * layer, the files and the inbox are the same for every surface; a surface
 * says what a pin attaches to, what a "page" is, and which parts it
 * fingerprints so a later version can say what changed.
 */
export interface ReviewPick {
  attribute: string;
  value: string;
  element: HTMLElement;
}

export interface ReviewPlace {
  /** The reviewed part (form field, tutorial step, emulator screen), when known. */
  partId: string | null;
  /** What the item is tied to, for people: a field's label, a control's name. */
  label: string | null;
  /** The page the item belongs to: a form page/section, "Step 4 · …", an emulator screen. */
  page: string;
}

export interface ReviewSurface {
  kind: ReviewSubjectKind;
  /** Stable id of the subject (tutorial id, emulator id); forms are named by `name`. */
  subjectId?: string;
  name: string;
  /** Form: share preview target; tutorial: mode; emulator: host id. */
  target: string;
  /** The link that opens this subject again (without the review flag). */
  shareUrl: string | null;
  /** The `data-*` attributes a pin can attach to, most specific first. */
  anchorAttributes: readonly string[];
  /** The parts fingerprinted when the review starts. */
  parts: readonly ReviewableField[];
  /** Where an item made on `pick` (or on nothing) belongs, right now. */
  place(pick: ReviewPick | null): ReviewPlace;
  /**
   * Whether an item belongs on screen now, beyond its element being visible:
   * a tutorial shows a step's feedback only on that step.
   */
  showsItem?(item: ReviewItem): boolean;
  /** Changes when the view changes in a way the DOM may not (a tutorial's step). */
  viewKey?: string;
}

/** The current page URL without the review flags, to reopen what is being reviewed. */
export function reviewableUrl(): string | null {
  if (typeof window === "undefined") return null;
  return window.location.href.replace(/([#&])review=(continue|start)&?/, "$1").replace(/[#&]$/, "");
}

/** True when the page was opened as a review (`#review=start`) or to continue one (`#review=continue`). */
export function readReviewFlag(): boolean {
  if (typeof window === "undefined") return false;
  const read = (text: string) => new URLSearchParams(text.replace(/^[#?]/, "")).get("review");
  const value = read(window.location.hash) ?? read(window.location.search);
  return value === "start" || value === "continue";
}

/** A readable name for an element named by a tutorial anchor: its label, else its id in words. */
export function anchorLabel(id: string, element: HTMLElement): string {
  const named = element.getAttribute("aria-label") ?? element.getAttribute("title") ?? labelNear(element);
  if (named && named.length <= 60) return named;
  const words = id.split(/[._:-]+/).filter(Boolean).join(" ")
    .replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : id;
}

/** What a reviewer sees of a tutorial step; its fingerprint changes when the step does. */
export interface ReviewTutorialStep {
  id: string;
  title: string;
  body: string;
  anchorId?: string;
  targetId?: string;
  actionId?: string;
}

/**
 * A running tutorial: feedback belongs to the step it was made on (and shows
 * only on that step); pins attach to the step card or to any anchored control.
 */
export function tutorialReviewSurface(input: {
  tutorialId: string;
  title: string;
  mode: string;
  steps: readonly ReviewTutorialStep[];
  stepIndex: number;
  shareUrl?: string | null;
  labelAnchor?: (id: string, element: HTMLElement) => string;
}): ReviewSurface {
  const current = input.steps[input.stepIndex] ?? null;
  const page = current ? `Step ${input.stepIndex + 1} · ${current.title}` : "Tutorial";
  return {
    kind: "tutorial",
    subjectId: input.tutorialId,
    name: input.title,
    target: input.mode,
    shareUrl: input.shareUrl === undefined ? reviewableUrl() : input.shareUrl,
    anchorAttributes: ["data-tutorial-step", TUTORIAL_ANCHOR_ATTRIBUTE],
    parts: tutorialReviewParts(input.steps),
    place(pick) {
      const label = !pick ? null
        : pick.attribute === "data-tutorial-step" ? "The step card"
        : (input.labelAnchor ?? anchorLabel)(pick.value, pick.element);
      return { partId: current?.id ?? null, label, page };
    },
    showsItem: (item) => !item.anchor.fieldId || item.anchor.fieldId === current?.id,
    viewKey: current?.id ?? "",
  };
}

/** A tutorial's steps as review parts: one fingerprint per step, from what a reviewer saw of it. */
export function tutorialReviewParts(steps: readonly ReviewTutorialStep[]): ReviewableField[] {
  return steps.map((step) => ({
    id: step.id,
    label: step.title,
    type: "tutorial-step",
    options: [step.title, step.body, step.anchorId ?? "", step.targetId ?? "", step.actionId ?? ""],
  }));
}

