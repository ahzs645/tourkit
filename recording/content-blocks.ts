import { browserTutorialStorage, tutorialStorageKey, type TutorialStorageOptions } from "../shared/storage";
import { z } from "zod";
import { TutorialContentKindSchema, type TutorialContentKind, type TutorialStepCompletion } from "../core/schema";

export const TUTORIAL_CONTENT_KINDS: { value: TutorialContentKind; label: string; title: string; instruction: string }[] = [
  { value: "action", label: "Action step", title: "New step", instruction: "Describe what to do here." },
  { value: "introduction", label: "Introduction", title: "Before you begin", instruction: "Explain the goal of this tutorial and what the learner will achieve." },
  { value: "prerequisite", label: "Prerequisite", title: "What you need", instruction: "List the access, setup, and knowledge needed before starting." },
  { value: "note", label: "Note", title: "Note", instruction: "Add useful context for this part of the workflow." },
  { value: "tip", label: "Tip", title: "Tip", instruction: "Describe a helpful shortcut or an alternative way to complete the task." },
  { value: "warning", label: "Warning", title: "Take care", instruction: "Explain what to check before proceeding and how to avoid the problem." },
  { value: "summary", label: "Summary", title: "What you learned", instruction: "Recap the result and explain the next task." },
];

/** Only deliberately typed, non-interactive blocks are left out of player exports. */
export function isTutorialGuideBlock(step: { contentKind?: TutorialContentKind; action?: unknown; check?: unknown; completion?: TutorialStepCompletion }): boolean {
  return Boolean(step.completion !== "continue" && step.contentKind && step.contentKind !== "action" && !step.action && !step.check);
}

export function tutorialContentLabel(kind?: TutorialContentKind): string {
  return TUTORIAL_CONTENT_KINDS.find((item) => item.value === kind)?.label ?? "Action step";
}

/** A reusable block contains editorial content, never an action tied to another fixture. */
export const TutorialContentTemplateSchema = z.strictObject({
  id: z.string().min(1).max(160),
  name: z.string().trim().min(1).max(100),
  contentKind: TutorialContentKindSchema,
  title: z.string().max(160),
  instruction: z.string().max(4000),
  pageBreakBefore: z.boolean().optional(),
});
export type TutorialContentTemplate = z.infer<typeof TutorialContentTemplateSchema>;
const TemplatesSchema = z.array(TutorialContentTemplateSchema).max(100);
export function createTutorialContentTemplateStore(options: TutorialStorageOptions = {}) {
  const key = tutorialStorageKey("content-templates", options.namespace);
  const storage = options.storage ?? (() => browserTutorialStorage("localStorage"));
  return {
    read(): TutorialContentTemplate[] {
      try { return TemplatesSchema.parse(JSON.parse(storage()?.getItem(key) ?? "[]")); }
      catch { return []; }
    },
    save(templates: TutorialContentTemplate[]): void {
      const store = storage();
      if (!store) throw new Error("This browser cannot save text blocks. Export them to keep a copy.");
      store.setItem(key, JSON.stringify(TemplatesSchema.parse(templates)));
    },
  };
}
export type TutorialContentTemplateStore = ReturnType<typeof createTutorialContentTemplateStore>;
export const defaultTutorialContentTemplateStore = createTutorialContentTemplateStore();
export const readTutorialContentTemplates = defaultTutorialContentTemplateStore.read;
export const saveTutorialContentTemplates = defaultTutorialContentTemplateStore.save;

export function parseTutorialContentTemplates(text: string): TutorialContentTemplate[] {
  return TemplatesSchema.parse(JSON.parse(text));
}

export function serializeTutorialContentTemplates(templates: TutorialContentTemplate[]): string {
  return JSON.stringify(TemplatesSchema.parse(templates), null, 2);
}


