import { DEFAULT_TUTORIAL_STUDIO_ENVIRONMENT, type TutorialStudioEnvironment } from "./environment";
import {
  createTutorialRecordingDraft,
  deserializeTutorialRecordingDraft,
  tutorialManifestToRecordingDraft,
  type TutorialRecordingDraft,
} from "../recording";
import { buildTutorialLaunchUrl, parseTutorialManifest, type TutorialMode } from "../core/schema";

/** Saved snapshots of a draft live in the same store under this prefix. */
export const STUDIO_VERSION_PREFIX = "version:";

export function isStudioVersionId(id: string): boolean {
  return id.startsWith(STUDIO_VERSION_PREFIX);
}

/** The studio route: the "My tutorials" list, or the editor on one draft. */
export function studioHref(openId?: string, environment: TutorialStudioEnvironment = DEFAULT_TUTORIAL_STUDIO_ENVIRONMENT): string {
  const base = environment.resolvePath(environment.studioPath);
  return openId ? `${base}?open=${encodeURIComponent(openId)}` : base;
}

/** A fresh, empty studio draft on the given stage (the browser's Stage setting by default). */
export function createBlankStudioDraft(stage?: string, environment: TutorialStudioEnvironment = DEFAULT_TUTORIAL_STUDIO_ENVIRONMENT): TutorialRecordingDraft {
  return environment.createDraft(stage ?? environment.readPreferredStage());
}

/**
 * Runs a saved draft on its stage exactly as a learner would see it. The
 * stage resolves tutorial=draft:<id> from this browser's draft store, so the
 * draft must be saved first.
 */
export function draftPlayHref(draft: Pick<TutorialRecordingDraft, "id" | "launch">, mode: TutorialMode, environment: TutorialStudioEnvironment = DEFAULT_TUTORIAL_STUDIO_ENVIRONMENT): string {
  // tutorialAuthor=1 means "report, do not play"; a run must launch without it.
  const { tutorialAuthor: _authoring, ...hash } = draft.launch.hash;
  const launch = buildTutorialLaunchUrl({ ...draft.launch, hash });
  const params = new URLSearchParams({
    tutorial: `draft:${draft.id}`,
    tutorialMode: mode,
    tutorialRun: String(Date.now()),
  });
  return `${environment.resolvePath("/")}${launch.replace(/^\//, "")}&${params.toString()}`;
}

/** A copy that can sit beside the original in the store. */
export function copyOfDraft(draft: TutorialRecordingDraft, title = `${draft.title} (copy)`): TutorialRecordingDraft {
  const now = new Date().toISOString();
  const { id } = createTutorialRecordingDraft();
  return { ...draft, id, title, createdAt: now, updatedAt: now };
}

/**
 * Reads a shared tutorial file: the studio's portable draft
 * (.tutorial-draft.json, with embedded audio) or a player manifest
 * (.tutorial.json, as exported for the catalog).
 */
export async function readSharedTutorialFile(text: string): Promise<TutorialRecordingDraft> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That file is not JSON. Import a .tutorial-draft.json or .tutorial.json file.");
  }
  const record = parsed as { steps?: unknown; chapters?: unknown } | null;
  const isManifest = Boolean(record) && !Array.isArray(record?.steps) && Array.isArray(record?.chapters)
    && (record!.chapters as unknown[]).some((chapter) => Array.isArray((chapter as { steps?: unknown })?.steps));
  if (isManifest) {
    return tutorialManifestToRecordingDraft(parseTutorialManifest(parsed));
  }
  return deserializeTutorialRecordingDraft(text);
}

export function safeTutorialFilename(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "tutorial";
}

export function downloadStudioFile(content: Blob | string, filename: string): void {
  const blob = typeof content === "string" ? new Blob([content], { type: "application/json" }) : content;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

