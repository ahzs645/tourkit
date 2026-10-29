import { z } from "zod";
import { TutorialScreenshotSchema } from "./screenshot";

const identifier = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9][a-z0-9._:-]*$/i, "Use letters, numbers, dots, colons, underscores, or hyphens.");

export const TutorialIdSchema = identifier;
export const TutorialActionIdSchema = identifier;
export const TutorialAnchorIdSchema = identifier;
export const TutorialAliasSchema = identifier;

export const TutorialModeSchema = z.enum(["autoplay", "practice"]);
export type TutorialMode = z.infer<typeof TutorialModeSchema>;

export const TutorialSpotlightStyleSchema = z.enum(["dim", "glow"]);
export type TutorialSpotlightStyle = z.infer<typeof TutorialSpotlightStyleSchema>;

/**
 * How much of the workspace the learner may press during a step.
 *
 * `free` is the default and the premise of practice grading: any route to the
 * outcome counts, so every control stays live. `guided` suits a tour that
 * names regions rather than building anything — there is no outcome to reach
 * by another route, and a stray click on unrelated chrome can bury the tour
 * under a modal it never asked for. Guided confines *pointer* input to the
 * ringed control and the transient layers it opens (menus, dialogs); the
 * keyboard is never trapped in either mode.
 */
export const TutorialInteractionSchema = z.enum(["free", "guided"]);
export type TutorialInteraction = z.infer<typeof TutorialInteractionSchema>;

export const TutorialReferenceSchema = z.strictObject({
  $ref: z
    .string()
    .min(1)
    .regex(
      /^[a-z0-9][a-z0-9._:-]*(?:\.(?:[a-z0-9_-]+|\d+))*$/i,
      "References must start with an alias and may include a dotted property path.",
    ),
});
export type TutorialReference = z.infer<typeof TutorialReferenceSchema>;

export type TutorialValue =
  | string
  | number
  | boolean
  | null
  | TutorialReference
  | TutorialValue[]
  | { [key: string]: TutorialValue };

export const TutorialValueSchema: z.ZodType<TutorialValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    TutorialReferenceSchema,
    z.array(TutorialValueSchema),
    z.record(z.string(), TutorialValueSchema),
  ]),
);

export const TutorialSemanticActionSchema = z.strictObject({
  id: TutorialActionIdSchema,
  args: z.record(z.string(), TutorialValueSchema).optional(),
  resultAlias: TutorialAliasSchema.optional(),
  match: z.enum(["subset", "exact"]).default("subset"),
});
export type TutorialSemanticAction = z.infer<typeof TutorialSemanticActionSchema>;

/**
 * A single outcome assertion against the portable workspace snapshot, for
 * example "the document contains one more text field than it did when this step
 * started". Checks describe the goal instead of the click that reaches it, so
 * any legitimate route — palette, keyboard, or converting an existing field
 * with the inspector Type control — completes the step.
 */
export const TutorialCheckClauseSchema = z.strictObject({
  /** Dotted path into the workspace snapshot, for example "builder.fields". */
  path: z
    .string()
    .min(1)
    .max(160)
    .regex(/^[a-z0-9_][a-z0-9._-]*$/i, "Use a dotted snapshot path such as builder.fields."),
  /** Subset match applied to each array item, or to the value itself. */
  where: z.record(z.string(), TutorialValueSchema).optional(),
  /** Exact comparison for scalar paths such as workspace.activeTab. */
  equals: TutorialValueSchema.optional(),
  count: z.strictObject({
    min: z.number().int().min(0).optional(),
    max: z.number().int().min(0).optional(),
  })
    .optional(),
  /**
   * `absolute` compares the current snapshot only. `delta` compares it with
   * the snapshot captured when the step started, so "add a field" still
   * requires a new field even when a matching one already exists.
   */
  mode: z.enum(["absolute", "delta"]).default("absolute"),
  /**
   * Whether the player keeps watching this clause after the step is done
   * and reports "an earlier step came undone" when it stops holding. Off
   * for clauses that describe a moment rather than a lasting outcome — "the
   * section holds exactly one field" is true right after the first field
   * lands and false, by design, once the next step adds a second.
   */
  watch: z.boolean().optional(),
  /** Bind the matched value to an alias for later {$ref} arguments. */
  captureAlias: TutorialAliasSchema.optional(),
})
  .refine(
    ({ count }) => count?.min === undefined || count.max === undefined || count.min <= count.max,
    { error: "count.min must not exceed count.max.", path: ["count"] },
  );
export type TutorialCheckClause = z.infer<typeof TutorialCheckClauseSchema>;

export const TutorialCheckSchema = z.strictObject({
  /** Learner-facing success criterion, rendered as "Done when …". */
  description: z.string().min(1).max(200).optional(),
  all: z.array(TutorialCheckClauseSchema).min(1),
});
export type TutorialCheck = z.infer<typeof TutorialCheckSchema>;

/** Structural surface identifiers only; never patient ids, labels, or entered values. */
export const TutorialViewPathSchema = z.enum(["host.emulator", "host.module", "host.node", "host.view", "host.tab", "host.page", "host.menu", "host.browserTab", "host.dialog", "workspace.activeTab"]);
export const TutorialViewContextSchema = z.strictObject({
  label: z.string().min(1).max(200),
  all: z.array(z.strictObject({ path: TutorialViewPathSchema, equals: z.union([z.string().max(160), z.null()]) })).min(1).max(10),
});
export type TutorialViewContext = z.infer<typeof TutorialViewContextSchema>;

export const TutorialAnchorSchema = z.strictObject({
  id: TutorialAnchorIdSchema,
  placement: z
    .enum(["auto", "top", "right", "bottom", "left", "center"])
    .default("auto"),
  /**
   * Where the attached card lines up along the side `placement` chose:
   * `start` with the control's top or left edge, `end` with its bottom or
   * right edge. Omitted centres the card on the control.
   */
  align: z.enum(["start", "center", "end"]).optional(),
  waitMs: z.number().int().min(0).max(60_000).default(5_000),
});
export type TutorialAnchor = z.infer<typeof TutorialAnchorSchema>;

export const TutorialNarrationRangeSchema = z.strictObject({
  src: z.string().min(1),
  startMs: z.number().int().min(0),
  endMs: z.number().int().positive(),
  transcript: z.string().optional(),
})
  .refine(({ startMs, endMs }) => endMs > startMs, {
    error: "Narration endMs must be greater than startMs.",
    path: ["endMs"],
  });
export type TutorialNarrationRange = z.infer<typeof TutorialNarrationRangeSchema>;

/**
 * Where the instruction card sits and how it points. `attached` (the default)
 * places the card beside the highlighted control — on the side the step's
 * anchor placement prefers, never covering the control or the region it
 * belongs to — so the instruction and the ring read as one thing on any
 * screen width. `docked` keeps a compact bottom-right card and lets the ring
 * do the pointing; `center` puts a larger card in the middle of the screen
 * (sliding to the bottom when it would cover the highlighted control).
 * `pointer` draws an arrow from the card to the control.
 */
export const TutorialCardPlacementSchema = z.enum(["attached", "docked", "center"]);
export type TutorialCardPlacement = z.infer<typeof TutorialCardPlacementSchema>;

/** `compact` suits short product-tour copy; `large` suits screen-recorded lessons. */
export const TutorialCardSizeSchema = z.enum(["compact", "default", "large"]);
export type TutorialCardSize = z.infer<typeof TutorialCardSizeSchema>;

export const TutorialCardLayoutSchema = z.strictObject({
  placement: TutorialCardPlacementSchema.default("attached"),
  size: TutorialCardSizeSchema.default("default"),
  pointer: z.boolean().default(true),
});
export type TutorialCardLayout = z.infer<typeof TutorialCardLayoutSchema>;

/** Step-level override; unset fields inherit the manifest's card layout. */
export const TutorialCardLayoutOverrideSchema = z.strictObject({
  placement: TutorialCardPlacementSchema.optional(),
  size: TutorialCardSizeSchema.optional(),
  pointer: z.boolean().optional(),
});

export const TutorialOverlaySchema = z.strictObject({
  title: z.string().min(1).max(160),
  body: z.string().min(1).max(4_000),
  showProgress: z.boolean().default(true),
});
export type TutorialOverlay = z.infer<typeof TutorialOverlaySchema>;

/** Omitted keeps automatic screenshots; none intentionally makes a reading step text-only. */
export const TutorialScreenshotModeSchema = z.enum(["auto", "none"]);
export type TutorialScreenshotMode = z.infer<typeof TutorialScreenshotModeSchema>;

/** Explanatory blocks can be included in reading guides without inventing an application action. */
export const TutorialContentKindSchema = z.enum(["action", "introduction", "note", "tip", "warning", "prerequisite", "summary"]);
export type TutorialContentKind = z.infer<typeof TutorialContentKindSchema>;

/** Continue steps are explanations acknowledged by the learner instead of graded outcomes. */
export const TutorialStepCompletionSchema = z.enum(["continue", "outcome"]);
export type TutorialStepCompletion = z.infer<typeof TutorialStepCompletionSchema>;

/** Additional visual focus areas. They never change the action target or practice grading. */
export const TutorialFocusRectSchema = z.strictObject({
  x: z.number().min(0).max(1), y: z.number().min(0).max(1),
  width: z.number().positive().max(1), height: z.number().positive().max(1),
}).refine((rect) => rect.x + rect.width <= 1.000001 && rect.y + rect.height <= 1.000001,
  { error: "The focus rectangle must fit inside its reference area." });
export const TutorialFocusHighlightSchema = z.strictObject({
  id: TutorialIdSchema,
  label: z.string().max(160).optional(),
  target: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("element"), anchor: TutorialAnchorIdSchema }),
    z.strictObject({ kind: z.literal("area"), anchor: TutorialAnchorIdSchema, rect: TutorialFocusRectSchema }),
  ]),
  style: z.enum(["box", "arrow", "both"]).default("box"),
  arrowFrom: z.enum(["top", "right", "bottom", "left"]).default("left"),
});
export type TutorialFocusHighlight = z.infer<typeof TutorialFocusHighlightSchema>;
export const TutorialFocusHighlightsSchema = z.array(TutorialFocusHighlightSchema).max(32)
  .refine((items) => new Set(items.map((item) => item.id)).size === items.length,
    { error: "Focus highlight ids must be unique within the step." });

export const TutorialStepSchema = z.strictObject({
  highlights: TutorialFocusHighlightsSchema.optional(),
  id: TutorialIdSchema,
  title: z.string().min(1).max(160).optional(),
  mode: TutorialModeSchema.optional(),
  spotlightStyle: TutorialSpotlightStyleSchema.optional(),
  interaction: TutorialInteractionSchema.optional(),
  card: TutorialCardLayoutOverrideSchema.optional(),
  anchor: TutorialAnchorSchema.optional(),
  /**
   * The one control to press, when it differs from the anchor. The anchor is
   * the region the step describes (cut out of the backdrop, pointed at by the
   * arrow); the target is where the yellow ring goes. Without a target the
   * ring wraps the anchor itself.
   */
  target: z.strictObject({ id: TutorialAnchorIdSchema }).optional(),
  action: TutorialSemanticActionSchema.optional(),
  /**
   * Host actions that bring this step's surface on screen (open a drawer,
   * switch a tab) before its anchor is located. They run through the
   * player's executor in every mode, again each time the step is entered —
   * Back included — so they must be repeatable navigation, never the
   * mutation the step teaches. They are not the learner's action and are
   * never graded.
   */
  prepare: z.array(TutorialSemanticActionSchema).max(10).optional(),
  context: TutorialViewContextSchema.optional(),
  completion: TutorialStepCompletionSchema.optional(),
  /**
   * Practice gate. When present the step advances on the resulting
   * application state rather than on the recorded action, and the action is
   * used only for autoplay and for the "Show me how" escape hatch.
   */
  check: TutorialCheckSchema.optional(),
  overlay: TutorialOverlaySchema,
  screenshot: TutorialScreenshotSchema.optional(),
  screenshotMode: TutorialScreenshotModeSchema.optional(),
  contentKind: TutorialContentKindSchema.optional(),
  pageBreakBefore: z.boolean().optional(),
  narration: TutorialNarrationRangeSchema.optional(),
  advanceDelayMs: z.number().int().min(0).max(60_000).default(250),
});
export type TutorialStep = z.infer<typeof TutorialStepSchema>;

export const TutorialChapterSchema = z.strictObject({
  id: TutorialIdSchema,
  title: z.string().min(1).max(160),
  description: z.string().max(2_000).optional(),
  steps: z.array(TutorialStepSchema).min(1),
});
export type TutorialChapter = z.infer<typeof TutorialChapterSchema>;

const TutorialHashValueSchema = z.union([z.string(), z.number(), z.boolean()]);

export const TutorialLaunchSchema = z.strictObject({
  fixture: z.string().min(1),
  path: z.string().startsWith("/").default("/"),
  hash: z.record(z.string(), TutorialHashValueSchema).default({}),
});
export type TutorialLaunch = z.infer<typeof TutorialLaunchSchema>;

/**
 * Learning-path tracks. The library groups tutorials by track in this order,
 * so the ids double as the curriculum outline.
 */
export const TutorialTrackSchema = z.enum([
  "getting-started",
  "building",
  "logic",
  "clinical-data",
  "delivery",
]);
export type TutorialTrack = z.infer<typeof TutorialTrackSchema>;

export const TutorialLevelSchema = z.enum(["beginner", "intermediate"]);
export type TutorialLevel = z.infer<typeof TutorialLevelSchema>;

/** Portable lesson expectations; a walkthrough must not imply task competency. */
export const TutorialSetupSchema = z.strictObject({
  kind: z.enum(["orientation", "navigation", "task", "overview"]),
  goal: z.string().min(1).max(1_000),
  audience: z.array(z.string().min(1).max(200)).max(10),
  access: z.array(z.string().min(1).max(300)).max(10),
  startingScreen: z.string().min(1).max(300),
  scenarioDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  sources: z.array(z.strictObject({
    title: z.string().min(1).max(200),
    version: z.string().min(1).max(100),
    articleIds: z.array(TutorialIdSchema).max(50),
    capturedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })).max(10),
  applicationVersion: z.string().min(1).max(100).optional(),
  limitations: z.array(z.string().min(1).max(1_000)).max(10),
});
export type TutorialSetup = z.infer<typeof TutorialSetupSchema>;

export const TutorialManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: TutorialIdSchema,
  title: z.string().min(1).max(200),
  description: z.string().max(4_000).optional(),
  setup: TutorialSetupSchema.optional(),
  /** Library grouping; defaults keep studio drafts and older manifests valid. */
  track: TutorialTrackSchema.default("getting-started"),
  level: TutorialLevelSchema.default("beginner"),
  /** Rough reading-and-doing time shown on the library card. */
  estimatedMinutes: z.number().int().min(1).max(60).default(5),
  /** Tutorials worth finishing first; shown as a hint, never enforced. */
  prerequisites: z.array(TutorialIdSchema).default([]),
  /** False keeps a tutorial launchable by id but out of the library and "Up next". */
  listed: z.boolean().default(true),
  /** Site-relative path of the documentation page this tutorial teaches, for "Read the guide" links. */
  docs: z.string().startsWith("/").optional(),
  defaultMode: TutorialModeSchema.default("practice"),
  spotlightStyle: TutorialSpotlightStyleSchema.default("glow"),
  interaction: TutorialInteractionSchema.default("free"),
  card: TutorialCardLayoutSchema.prefault({}),
  launch: TutorialLaunchSchema,
  chapters: z.array(TutorialChapterSchema).min(1),
})
  .superRefine((manifest, context) => {
    const chapterIds = new Set<string>();
    const stepIds = new Set<string>();
    for (const chapter of manifest.chapters) {
      if (chapterIds.has(chapter.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate chapter id: ${chapter.id}`,
          path: ["chapters"],
        });
      }
      chapterIds.add(chapter.id);

      for (const step of chapter.steps) {
        if (stepIds.has(step.id)) {
          context.addIssue({
            code: "custom",
            message: `Duplicate step id: ${step.id}`,
            path: ["chapters"],
          });
        }
        stepIds.add(step.id);

        // Explanations can wait for Continue without an application action.
        // Outcome steps keep the existing action/check contract.
        if (step.completion !== "continue" && !step.action && !step.check) {
          context.addIssue({
            code: "custom",
            message: `Step ${step.id} must define a semantic action, a state check, or both.`,
            path: ["chapters"],
          });
        }

        const mode = step.mode ?? manifest.defaultMode;
        if (mode === "autoplay" && step.completion !== "continue" && !step.action) {
          context.addIssue({
            code: "custom",
            message: `autoplay step ${step.id} must define a semantic action.`,
            path: ["chapters"],
          });
        }
      }
    }
  });
export type TutorialManifest = z.infer<typeof TutorialManifestSchema>;

export function parseTutorialManifest(input: unknown): TutorialManifest {
  return TutorialManifestSchema.parse(input);
}

/** Build the same hash-based launch URLs used by the builder (for example, #edit=1&fixture=...). */
export function buildTutorialLaunchUrl(launch: TutorialLaunch, origin = ""): string {
  const parsed = TutorialLaunchSchema.parse(launch);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(parsed.hash)) {
    params.set(key, String(value));
  }
  params.set("fixture", parsed.fixture);
  return `${origin}${parsed.path}#${params.toString()}`;
}

