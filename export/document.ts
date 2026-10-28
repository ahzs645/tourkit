import type { TutorialManifest } from "../core/schema";
import type { TutorialRecordingDraft } from "../recording/types";
import { stepChapterId } from "../recording/draft";
import { readingScreenshot, TutorialScreenshotSchema, type TutorialScreenshot } from "../core/screenshot";
import { TutorialExportOptionsSchema, type TutorialExportOptions } from "./options";

export type TutorialExportSource = { manifest: TutorialManifest } | { draft: TutorialRecordingDraft };
export interface TutorialDocumentStep {
  screenshot?: TutorialScreenshot;
  screenshotMode?: "auto" | "none";
  contentKind?: "action" | "introduction" | "note" | "tip" | "warning" | "prerequisite" | "summary";
  pageBreakBefore?: boolean;
  number: number;
  actionNumber?: number;
  title: string;
  instruction: string;
  outcome?: string;
  transcript?: string;
}
export interface TutorialDocument {
  paperSize?: "A4" | "LETTER";
  pdfTemplate?: TutorialExportOptions["pdfTemplate"];
  newPagePerChapter?: boolean;
  newPagePerScreenshot?: boolean;
  pdfFont?: TutorialExportOptions["pdfFont"];
  includeCover?: boolean;
  includeTableOfContents?: boolean;
  branding?: TutorialExportOptions["branding"];
  title: string;
  description: string;
  estimatedMinutes: number;
  chapters: { title: string; description?: string; steps: TutorialDocumentStep[] }[];
}

/** Reading exports need no executable action, so unfinished Studio drafts can be documented too. */
export function tutorialDocument(source: TutorialExportSource, input: Partial<TutorialExportOptions> = {}): TutorialDocument {
  const options = TutorialExportOptionsSchema.parse(input);
  let number = 0;
  const value = "draft" in source ? source.draft : source.manifest;
  const chapters = "draft" in source
    ? source.draft.chapters.map((chapter) => ({
        title: chapter.title,
        description: chapter.description,
        steps: source.draft.steps.filter((step) => stepChapterId(source.draft, step) === chapter.id).map((step) => ({
          number: ++number, title: step.title, instruction: step.instruction,
          outcome: options.includeOutcomes ? step.check?.description : undefined,
          transcript: options.includeTranscripts ? step.narration?.transcript : undefined,
          screenshotMode: step.screenshotMode,
          contentKind: step.contentKind, pageBreakBefore: step.pageBreakBefore,
          screenshot: options.includeScreenshots && step.screenshotMode !== "none" && step.screenshot ? readingScreenshot(TutorialScreenshotSchema.parse(step.screenshot)) : undefined,
        })),
      }))
    : source.manifest.chapters.map((chapter) => ({
        title: chapter.title,
        description: chapter.description,
        steps: chapter.steps.map((step) => ({
          number: ++number, title: step.overlay.title, instruction: step.overlay.body,
          outcome: options.includeOutcomes ? step.check?.description : undefined,
          transcript: options.includeTranscripts ? step.narration?.transcript : undefined,
          screenshotMode: step.screenshotMode,
          contentKind: step.contentKind, pageBreakBefore: step.pageBreakBefore,
          screenshot: options.includeScreenshots && step.screenshotMode !== "none" && step.screenshot ? readingScreenshot(TutorialScreenshotSchema.parse(step.screenshot)) : undefined,
        })),
      }));
  if (!number) throw new Error("Add at least one step before exporting a guide.");
  let actionNumber = 0;
  for (const chapter of chapters) for (const step of chapter.steps) {
    if (!step.contentKind || step.contentKind === "action") Object.assign(step, { actionNumber: ++actionNumber });
  }
  if (value.setup) {
    const setup = value.setup;
    const references = setup.sources.map((source) => `${source.title} (${source.version}${source.capturedAt ? `; archive generated ${source.capturedAt}` : ""})${source.articleIds.length ? ` — articles ${source.articleIds.join(", ")}` : ""}`);
    chapters.unshift({ title: "Lesson setup", description: undefined, steps: [{
      number: 0, title: "Before you begin", contentKind: "prerequisite", screenshotMode: "none",
      instruction: [
        `Lesson type: ${setup.kind}. Goal: ${setup.goal}`,
        setup.audience.length ? `For: ${setup.audience.join("; ")}` : "",
        setup.access.length ? `Access and preparation: ${setup.access.join("; ")}` : "",
        `Starting screen: ${setup.startingScreen}${setup.scenarioDate ? `. Training date: ${setup.scenarioDate}` : ""}`,
        setup.applicationVersion ? `Interface: ${setup.applicationVersion}` : "",
        ...references.map((reference) => `Reference: ${reference}`),
        ...setup.limitations.map((limitation) => `Completion and simulator limits: ${limitation}`),
      ].filter(Boolean).join("\n\n"),
      outcome: undefined, transcript: undefined, screenshot: undefined, pageBreakBefore: undefined,
    }] });
  }
  return { title: value.title, description: value.description ?? "", estimatedMinutes: value.estimatedMinutes, paperSize: options.paperSize,
    pdfFont: options.pdfFont, includeCover: options.includeCover, includeTableOfContents: options.includeTableOfContents, branding: options.branding,
    pdfTemplate: options.pdfTemplate, newPagePerChapter: options.newPagePerChapter, newPagePerScreenshot: options.newPagePerScreenshot,
    chapters: chapters.filter((chapter) => chapter.steps.length) };
}

/** Explanations get their own label; inserting one never leaves gaps in action numbers. */
export function documentStepTitle(step: TutorialDocumentStep): string {
  const kind = step.contentKind ?? "action";
  if (kind !== "action") return `${kind.charAt(0).toUpperCase() + kind.slice(1)}: ${step.title}`;
  const number = step.actionNumber ?? step.number;
  const title = step.title.replace(new RegExp(`^\\s*(?:${step.number}|${number})\\s*[.·)]\\s+`), "");
  return `${number}. ${title}`;
}

export function stepParagraphs(step: TutorialDocumentStep): string[] {
  return [step.instruction, step.outcome ? `Done when: ${step.outcome}` : "",
    step.transcript && step.transcript !== step.instruction ? `Narration: ${step.transcript}` : ""].filter(Boolean);
}

export function tutorialFilename(title: string): string {
  return title.normalize("NFKC").replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^[.-]+|[.-]+$/g, "").slice(0, 100) || "tutorial";
}

/**
 * Escapes only what Markdown would read as markup: inline emphasis, code,
 * links, HTML and tables anywhere, and block syntax (headings, quotes,
 * lists, rules) at the start of a line. Ordinary punctuation stays readable.
 */
const markdownText = (text: string) => text
  .replace(/([\\`*_[\]<>|~])/g, "\\$1")
  .replace(/^(\s*)([#>+=-])/gm, "$1\\$2")
  .replace(/^(\s*\d+)([.)])/gm, "$1\\$2");

export function tutorialMarkdown(doc: TutorialDocument): string {
  return [`# ${markdownText(doc.title)}`, markdownText(doc.description), `${doc.estimatedMinutes} minute guide`,
    ...doc.chapters.flatMap((chapter) => [
      `## ${markdownText(chapter.title)}`, markdownText(chapter.description ?? ""),
      ...chapter.steps.flatMap((step) => [`### ${markdownText(documentStepTitle(step))}`,
        ...stepParagraphs(step).map(markdownText),
        ...(step.screenshot ? [`![${markdownText(step.screenshot.alt)}](${step.screenshot.dataUrl})`] : [])]),
    ])].filter(Boolean).join("\n\n") + "\n";
}

/** Wraps even unbroken strings; used for bounded slides and GIF cards without dropping text. */
export function wrapText(text: string, fits: (line: string) => boolean): string[] {
  return text.split("\n").flatMap((paragraph) => {
    const lines: string[] = [];
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && !fits(`${line} ${word}`)) { lines.push(line); line = ""; }
      for (const char of (line ? " " : "") + word) {
        if (line && !fits(line + char)) { lines.push(line); line = ""; }
        line += char;
      }
    }
    lines.push(line);
    return lines;
  });
}

