import { publishedScreenshot } from "../core/screenshot";
import { TutorialManifestSchema } from "../core/schema";
import { tutorialManifestToRecordingDraft, tutorialRecordingDraftToManifest } from "../recording/draft";
import { serializeTutorialRecordingDraft } from "../recording/serialization";
import { tutorialDocument, tutorialFilename, tutorialMarkdown, type TutorialExportSource } from "./document";
import { TutorialBrandingSchema, type TutorialExportOptions } from "./options";
import type { TutorialExportRuntime } from "./runtime";
export type { TutorialExportRuntime, TutorialExportMetadata, TutorialPdfFontUrls } from "./runtime";

export const TUTORIAL_EXPORT_GROUPS = [
  { id: "guide", label: "Guides", description: "Step-by-step instructions with screenshots, to read or print." },
  { id: "training", label: "Training", description: "Courses a learner works through." },
  { id: "source", label: "For editing", description: "The tutorial itself, to edit in Studio or ship in the catalog." },
] as const;

/** `reading` formats are built from the step text and screenshots; the others carry the tutorial itself. */
export const TUTORIAL_EXPORT_FORMATS = [
  { id: "pdf", group: "guide", reading: true, label: "PDF", extension: ".pdf", description: "A paginated guide for printing and sharing." },
  { id: "docx", group: "guide", reading: true, label: "Word", extension: ".docx", description: "An editable document with chapters and numbered steps." },
  { id: "pptx", group: "guide", reading: true, label: "PowerPoint", extension: ".pptx", description: "Editable slides, with continuation slides for long steps." },
  { id: "html", group: "guide", reading: true, label: "HTML", extension: ".html", description: "A static illustrated guide in one self-contained file. Read offline in any browser." },
  { id: "markdown", group: "guide", reading: true, label: "Markdown", extension: ".md", description: "A text guide for documentation and knowledge bases." },
  { id: "gif", group: "guide", reading: true, label: "Animated GIF", extension: ".gif", description: "Looping instructions and interface screenshots, paced for reading. No audio." },
  { id: "interactive-html", group: "training", reading: false, label: "Interactive HTML", extension: ".interactive.html", description: "The application interface and tutorial player in one offline file, when supplied by the host. Watch or practise each step." },
  { id: "scorm", group: "training", reading: true, label: "SCORM 1.2", extension: ".zip", description: "An offline reading course with LMS progress, completion, and time tracking." },
  { id: "draft", group: "source", reading: false, label: "Studio draft", extension: ".tutorial-draft.json", description: "An editable copy to import into Tutorial Studio, with its narration and saved screenshots." },
  { id: "json", group: "source", reading: false, label: "Player manifest", extension: ".tutorial.json", description: "The validated manifest the player runs, as shipped in the catalog. Export narration separately." },
] as const;
export type TutorialExportFormat = (typeof TUTORIAL_EXPORT_FORMATS)[number]["id"];
export type TutorialExportFormatEntry = (typeof TUTORIAL_EXPORT_FORMATS)[number];
export const tutorialExportFormat = (id: TutorialExportFormat): TutorialExportFormatEntry =>
  TUTORIAL_EXPORT_FORMATS.find((entry) => entry.id === id)!;
export type { TutorialExportSource } from "./document";

export async function exportTutorial(source: TutorialExportSource, format: TutorialExportFormat, onProgress?: (text: string) => void, options: Partial<TutorialExportOptions> = {}, runtime: TutorialExportRuntime = {}): Promise<{ blob: Blob; filename: string }> {
  const value = "draft" in source ? source.draft : source.manifest;
  let blob: Blob;
  if (format === "interactive-html") {
    blob = await (await import("./interactive")).exportInteractiveTutorial(source, onProgress, options, runtime);
  } else if (format === "draft") {
    const draft = "draft" in source ? source.draft : tutorialManifestToRecordingDraft(source.manifest);
    blob = new Blob([await serializeTutorialRecordingDraft(draft)], { type: "application/json" });
  } else if (format === "json") {
    const manifest = "draft" in source ? tutorialRecordingDraftToManifest(source.draft, {
      narrationAsset: source.draft.audio ? `${value.title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "tutorial"}.webm` : undefined,
    }) : TutorialManifestSchema.parse(source.manifest);
    const published = { ...manifest, chapters: manifest.chapters.map((chapter) => ({ ...chapter, steps: chapter.steps.map((step) => ({
      ...step, screenshot: step.screenshot ? publishedScreenshot(step.screenshot) : undefined,
    })) })) };
    blob = new Blob([JSON.stringify(published, null, 2)], { type: "application/json" });
  } else {
    const doc = tutorialDocument(source, runtime.metadata?.defaultAuthor !== undefined && options.branding === undefined
      ? { ...options, branding: TutorialBrandingSchema.parse({ author: runtime.metadata.defaultAuthor }) }
      : options);
    if (options.includeScreenshots !== false) {
      const missing = doc.chapters.flatMap((chapter) => chapter.steps).filter((step) => step.screenshotMode !== "none" && !step.screenshot);
      if (missing.length) throw new Error(`${missing.length} steps have no screenshot. Capture them, mark those steps as text-only, or turn off “Include screenshots”.`);
    }
    switch (format) {
      case "html": blob = new Blob([(await import("./html")).tutorialHtml(doc)], { type: "text/html;charset=utf-8" }); break;
      case "markdown": blob = new Blob([tutorialMarkdown(doc)], { type: "text/markdown;charset=utf-8" }); break;
      case "scorm": blob = await (await import("./html")).tutorialScorm(doc); break;
      case "docx": blob = await (await import("./office")).tutorialWord(doc, runtime.metadata); break;
      case "pptx": blob = await (await import("./office")).tutorialPowerPoint(doc, runtime.metadata); break;
      case "pdf": blob = await (await import("./pdf")).tutorialPdf(doc, runtime); break;
      case "gif": blob = await (await import("./gif")).tutorialGif(doc, onProgress); break;
      default: throw new Error(`Unknown export format: ${format}`);
    }
  }
  return { blob, filename: tutorialFilename(value.title) + tutorialExportFormat(format).extension };
}

export function downloadTutorialFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = filename;
  document.body.appendChild(link);
  link.click(); link.remove();
  // Keep the URL alive until browsers have consumed the download.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}



export { createTutorialExportPreferences, TutorialExportOptionsSchema, DEFAULT_TUTORIAL_EXPORT_OPTIONS } from "./options";
export type { TutorialExportOptions } from "./options";
export { createTutorialExportPresetProfile } from "./presets";
export type { TutorialExportPresetProfile } from "./presets";
