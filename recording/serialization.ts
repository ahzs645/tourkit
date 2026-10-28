import { z } from "zod";
import { TutorialScreenshotSchema } from "../core/screenshot";
import {
  TutorialFocusHighlightsSchema,
  TutorialCardLayoutOverrideSchema,
  TutorialCardLayoutSchema,
  TutorialCheckSchema,
  TutorialViewContextSchema,
  TutorialStepCompletionSchema,
  TutorialContentKindSchema,
  TutorialLaunchSchema,
  TutorialLevelSchema,
  TutorialSemanticActionSchema,
  TutorialScreenshotModeSchema,
  TutorialTrackSchema,
  TutorialValueSchema,
  TutorialSetupSchema
} from "../core/schema";
import { normalizeTutorialRecordingDraft } from "./draft";
import type { TutorialRecordingDraft, TutorialValue } from "./types";

const recordingStepSchema = z.object({
  highlights: TutorialFocusHighlightsSchema.optional(),
  completion: TutorialStepCompletionSchema.optional(),
  context: TutorialViewContextSchema.optional(),
  screenshot: TutorialScreenshotSchema.optional(),
  screenshotMode: TutorialScreenshotModeSchema.optional(),
  contentKind: TutorialContentKindSchema.optional(),
  pageBreakBefore: z.boolean().optional(),
  id: z.string().min(1),
  atMs: z.number().nonnegative(),
  title: z.string(),
  instruction: z.string(),
  label: z.string().optional(),
  chapterId: z.string().optional(),
  anchor: z.string().optional(),
  anchorPlacement: z.enum(["auto", "top", "right", "bottom", "left", "center"]).optional(),
  anchorWaitMs: z.number().int().nonnegative().optional(),
  target: z.string().optional(),
  mode: z.enum(["autoplay", "practice"]),
  spotlightStyle: z.enum(["dim", "glow"]).optional(),
  interaction: z.enum(["free", "guided"]).optional(),
  card: TutorialCardLayoutOverrideSchema.optional(),
  showProgress: z.boolean().optional(),
  advanceDelayMs: z.number().int().nonnegative().optional(),
  action: TutorialSemanticActionSchema.optional(),
  check: TutorialCheckSchema.optional(),
  narration: z
    .object({
      startMs: z.number().nonnegative(),
      endMs: z.number().positive(),
      transcript: z.string().optional()
    })
    .refine(({ startMs, endMs }) => endMs > startMs, "Narration end must be after its start.")
    .optional()
});

const portableDraftSchema = z.object({
  setup: TutorialSetupSchema.optional(),
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  title: z.string(),
  description: z.string(),
  // Drafts saved before chapters became a list carry a single chapter id/title.
  chapterId: z.string().optional(),
  chapterTitle: z.string().optional(),
  chapters: z
    .array(z.object({ id: z.string().min(1), title: z.string(), description: z.string().optional() }))
    .optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  durationMs: z.number().nonnegative(),
  syntheticDataOnly: z.literal(true),
  track: TutorialTrackSchema.optional(),
  level: TutorialLevelSchema.optional(),
  estimatedMinutes: z.number().int().positive().optional(),
  prerequisites: z.array(z.string()).optional(),
  listed: z.boolean().optional(),
  docs: z.string().optional(),
  defaultMode: z.enum(["autoplay", "practice"]),
  spotlightStyle: z.enum(["dim", "glow"]).default("dim"),
  interaction: z.enum(["free", "guided"]).default("free"),
  card: TutorialCardLayoutSchema.optional(),
  launch: TutorialLaunchSchema,
  steps: z.array(recordingStepSchema),
  audio: z
    .object({
      dataUrl: z.string().startsWith("data:audio/"),
      mimeType: z.string(),
      durationMs: z.number()
    })
    .optional(),
  visualReference: z
    .object({ kind: z.string(), version: z.number(), data: TutorialValueSchema })
    .optional()
});

type PortableTutorialRecordingDraft = z.infer<typeof portableDraftSchema>;

export async function serializeTutorialRecordingDraft(
  draft: TutorialRecordingDraft
): Promise<string> {
  const portable: PortableTutorialRecordingDraft = {
    ...draft,
    visualReference: draft.visualReference
      ? { ...draft.visualReference, data: draft.visualReference.data as TutorialValue }
      : undefined,
    audio: draft.audio
      ? {
          dataUrl: await blobToDataUrl(draft.audio.blob),
          mimeType: draft.audio.mimeType,
          durationMs: draft.audio.durationMs
        }
      : undefined
  };
  return JSON.stringify(portable, null, 2);
}

export async function deserializeTutorialRecordingDraft(
  serialized: string
): Promise<TutorialRecordingDraft> {
  const portable = portableDraftSchema.parse(JSON.parse(serialized));
  return normalizeTutorialRecordingDraft({
    ...portable,
    audio: portable.audio
      ? {
          blob: dataUrlToBlob(portable.audio.dataUrl),
          mimeType: portable.audio.mimeType,
          durationMs: portable.audio.durationMs
        }
      : undefined
  });
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  if (typeof FileReader !== "undefined") {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error("Could not read tutorial audio."));
      reader.readAsDataURL(blob);
    });
  }
  return blob.arrayBuffer().then((buffer) => {
    const base64 = Buffer.from(buffer).toString("base64");
    return `data:${blob.type || "application/octet-stream"};base64,${base64}`;
  });
}

export function dataUrlToBlob(dataUrl: string): Blob {
  if (!dataUrl.startsWith("data:")) throw new Error("Invalid tutorial audio data URL.");
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex < 0) throw new Error("Invalid tutorial audio data URL.");
  const metadata = dataUrl.slice(5, commaIndex);
  const isBase64 = /;base64$/i.test(metadata);
  const mimeType = metadata.replace(/;base64$/i, "") || "application/octet-stream";
  const encoded = dataUrl.slice(commaIndex + 1);
  const binary = isBase64
    ? typeof atob === "function"
      ? atob(encoded)
      : Buffer.from(encoded, "base64").toString("binary")
    : decodeURIComponent(encoded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: mimeType });
}

