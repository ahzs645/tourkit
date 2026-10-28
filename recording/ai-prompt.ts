import type { TutorialRecordingDraft } from "./types";
import type { TutorialCheck, TutorialLaunch } from "../core/schema";

/**
 * Creates a provider-neutral editing handoff. Audio stays local and is never
 * embedded in the prompt; an author can explicitly attach the exported file to
 * an AI service that supports transcription.
 */
export interface TutorialAiPromptOptions {
  applicationName?: string;
  snapshotPaths?: readonly string[];
  launchHashExample?: TutorialLaunch["hash"];
  checkExample?: TutorialCheck;
}

export function buildTutorialAiEditingPrompt(draft: TutorialRecordingDraft, options: TutorialAiPromptOptions = {}): string {
  const checkExample = options.checkExample ? `\n          "check": ${JSON.stringify(options.checkExample)},` : "";
  const timeline = draft.steps.map((step, index) => ({
    order: index + 1,
    id: step.id,
    atMs: step.atMs,
    narrationRange: step.narration
      ? {
          startMs: step.narration.startMs,
          endMs: step.narration.endMs,
          transcript: step.narration.transcript
        }
      : undefined,
    title: step.title,
    instruction: step.instruction,
    chapterId: step.chapterId ?? draft.chapters[0]?.id,
    anchor: step.anchor,
    target: step.target,
    ...(step.highlights?.length ? { highlights: step.highlights } : {}),
    mode: step.mode,
    action: step.action,
    check: step.check
  }));

  const source = {
    tutorial: {
      id: draft.id,
      title: draft.title,
      description: draft.description,
      defaultMode: draft.defaultMode,
      spotlightStyle: draft.spotlightStyle,
      launch: draft.launch,
      chapters: draft.chapters,
      durationMs: draft.durationMs,
      syntheticDataOnly: draft.syntheticDataOnly
    },
    audio: draft.audio
      ? {
          attached: true,
          mimeType: draft.audio.mimeType,
          durationMs: draft.audio.durationMs,
          note: "The author will attach the exported narration audio alongside this prompt."
        }
      : {
          attached: false,
          note: "No narration audio is attached. Do not invent a transcript."
        },
    recordedTimeline: timeline
  };

  return `You are editing an interactive ${options.applicationName ?? "application"} tutorial recorded against synthetic data.

Use the source package below to produce a polished tutorial. If narration audio is attached with this prompt, transcribe it first and align the transcript to the supplied millisecond timing ranges. If no audio is attached, do not invent spoken content.

Editing goals:
- Improve the tutorial title, chapter title, step titles, and concise learner-facing overlay instructions.
- Use the narration and semantic-action timings to improve step boundaries. You may merge accidental duplicate actions or split a step only when the resulting steps remain executable.
- Preserve every meaningful semantic action ID and its args exactly. Never convert semantic actions into CSS selectors, click coordinates, or executable code.
- Preserve stable anchor IDs when present. Anchors are only for highlighting; semantic actions are the replay contract.
- Keep both modes valid: autoplay performs the action, while practice highlights the anchor and waits for the step's outcome.
- Preserve each step's "check" as-is. A check grades the resulting application state, so any legitimate route to that outcome completes the step. Only add a check when the outcome is false at the moment the step begins, and only using snapshot paths supplied by the host${options.snapshotPaths?.length ? `: ${options.snapshotPaths.join(", ")}` : "; if none are documented, do not invent new paths"}. Use "mode": "delta" for "one more of X than before". Leave a step action-based when no path covers it.
- Keep launch.fixture, launch.path, and launch.hash compatible with the recorded synthetic fixture.
- This is synthetic-data-only material. Remove any accidental person, patient, credential, free-text form value, or other identifying content. Do not infer or add real clinical data.
- Use the attached audio only for transcription and tutorial editing. Do not request that it be uploaded elsewhere.

Return canonical tutorial manifest JSON only. Do not wrap it in Markdown and do not include commentary. The JSON must have this shape:
{
  "schemaVersion": 1,
  "id": "tutorial-id",
  "title": "Tutorial title",
  "description": "Optional description",
  "defaultMode": "autoplay or practice",
  "spotlightStyle": "dim or glow",
  "launch": {
    "fixture": "synthetic-fixture-id",
    "path": "/",
    "hash": ${JSON.stringify(options.launchHashExample ?? {})}
  },
  "chapters": [
    {
      "id": "chapter-id",
      "title": "Chapter title",
      "steps": [
        {
          "id": "step-id",
          "title": "Optional short title",
          "mode": "autoplay or practice",
          "anchor": { "id": "stable-anchor", "placement": "auto", "waitMs": 5000 },
          "action": { "id": "semantic.action", "args": {}, "match": "subset" },${checkExample}
          "overlay": { "title": "Step title", "body": "Clear instruction", "showProgress": true },
          "narration": { "src": "narration-file.webm", "startMs": 0, "endMs": 1000, "transcript": "Optional aligned transcript" },
          "advanceDelayMs": 250
        }
      ]
    }
  ]
}

Omit optional anchor, check, and narration objects when the source does not support them. Preserve the completion contract: action/outcome steps need a supported action or check, while explicit continue-after-reading steps may omit both. Ensure IDs contain only letters, numbers, dots, colons, underscores, or hyphens, narration endMs is greater than startMs, and all chapter and step IDs are unique.

SOURCE PACKAGE:
${JSON.stringify(source, null, 2)}`;
}

