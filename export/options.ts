import { browserTutorialStorage, tutorialStorageKey, type TutorialStorageOptions } from "../shared/storage";
import { z } from "zod";
import { readingScreenshot, TutorialScreenshotSchema } from "../core/screenshot";
import { TUTORIAL_HIGHLIGHT_STYLES } from "../core/highlight";

export const TutorialBrandingSchema = z.object({
  logo: TutorialScreenshotSchema.transform(readingScreenshot).optional(),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#174cb6"),
  author: z.string().max(200).default(""),
  organization: z.string().max(200).default(""),
  footer: z.string().max(300).default(""),
});
export type TutorialBranding = z.infer<typeof TutorialBrandingSchema>;

export const TutorialExportOptionsSchema = z.object({
  includeScreenshots: z.boolean().default(true),
  /** "step" zooms each screenshot to the control the step rings; "screen" keeps the whole interface. */
  screenshotFraming: z.enum(["step", "screen"]).default("step"),
  includeOutcomes: z.boolean().default(true),
  includeTranscripts: z.boolean().default(true),
  paperSize: z.enum(["A4", "LETTER"]).default("A4"),
  pdfTemplate: z.enum(["guide", "compact", "presentation"]).default("guide"),
  pdfFont: z.enum(["Roboto", "LiberationSans"]).default("Roboto"),
  includeCover: z.boolean().default(false),
  includeTableOfContents: z.boolean().default(false),
  branding: TutorialBrandingSchema.default(() => TutorialBrandingSchema.parse({})),
  newPagePerChapter: z.boolean().default(false),
  newPagePerScreenshot: z.boolean().default(false),
  highlightStyle: z.enum(TUTORIAL_HIGHLIGHT_STYLES).default("box"),
});
export type TutorialExportOptions = z.infer<typeof TutorialExportOptionsSchema>;
export const DEFAULT_TUTORIAL_EXPORT_OPTIONS = TutorialExportOptionsSchema.parse({});
/** Saved export preferences; without a namespace the key is `tourkit:export-settings`. */
export function createTutorialExportPreferences(options: TutorialStorageOptions = {}) {
  const key = tutorialStorageKey("export-settings", options.namespace);
  const storage = options.storage ?? (() => browserTutorialStorage("localStorage"));
  return {
    defaults: DEFAULT_TUTORIAL_EXPORT_OPTIONS,
    read(): TutorialExportOptions {
      try { return TutorialExportOptionsSchema.parse(JSON.parse(storage()?.getItem(key) ?? "{}")); }
      catch { return TutorialExportOptionsSchema.parse({}); }
    },
    save(value: TutorialExportOptions): void {
      try { storage()?.setItem(key, JSON.stringify(TutorialExportOptionsSchema.parse(value))); }
      catch { /* Export still works without storage. */ }
    },
  };
}
export const defaultTutorialExportPreferences = createTutorialExportPreferences();
export const readTutorialExportOptions = defaultTutorialExportPreferences.read;
export const saveTutorialExportOptions = defaultTutorialExportPreferences.save;
