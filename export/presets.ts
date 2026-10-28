import { browserTutorialStorage, tutorialStorageKey, type TutorialStorageOptions } from "../shared/storage";
import { z } from "zod";
import { TutorialExportOptionsSchema, type TutorialExportOptions } from "./options";
import { TutorialScreenshotSchema, type TutorialScreenshot } from "../core/screenshot";

export const TutorialExportPresetSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(80),
  options: TutorialExportOptionsSchema,
});
export type TutorialExportPreset = z.infer<typeof TutorialExportPresetSchema>;
const MAX_PRESET_BYTES = 9_000_000;

/** Bind schema defaults once for an application; persisted v1 records remain compatible. */
export function createTutorialExportPresetProfile(optionsSchema: z.ZodType<TutorialExportOptions> = TutorialExportOptionsSchema, storageOptions: TutorialStorageOptions = {}) {
  const storageKey = tutorialStorageKey("export-presets", storageOptions.namespace);
  const storage = storageOptions.storage ?? (() => browserTutorialStorage("localStorage"));
  const schema = TutorialExportPresetSchema.extend({ options: optionsSchema });
  /** Invalid individual presets never prevent opening other saved presets. */
  function readTutorialExportPresets(): TutorialExportPreset[] {
    try {
      const raw: unknown = JSON.parse(storage()?.getItem(storageKey) ?? "[]");
      if (!Array.isArray(raw)) return [];
      return raw.flatMap((value) => {
        const parsed = schema.safeParse(value);
        return parsed.success ? [parsed.data] : [];
      }).slice(0, 30);
    } catch { return []; }
  }

  function saveTutorialExportPresets(presets: TutorialExportPreset[]): void {
    if (presets.length > 30) throw new Error("You can save up to 30 export presets. Remove one before adding another.");
    const validated = presets.map((preset) => schema.parse(preset));
    try { const store = storage(); if (!store) throw new Error("No storage"); store.setItem(storageKey, JSON.stringify(validated)); }
    catch { throw new Error("This browser could not save the presets. Export a preset file to keep a copy."); }
  }

  function makeTutorialExportPreset(name: string, options: TutorialExportOptions): TutorialExportPreset {
    return schema.parse({ schemaVersion: 1, id: crypto.randomUUID(), name, options });
  }

  function serializeTutorialExportPreset(preset: TutorialExportPreset): string {
    return JSON.stringify(schema.parse(preset), null, 2);
  }

  function parseTutorialExportPreset(text: string): TutorialExportPreset {
    if (text.length > MAX_PRESET_BYTES) throw new Error("This export preset is too large.");
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { throw new Error("This preset file is not valid JSON."); }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) throw new Error("This file is not a valid tutorial export preset. Its logo must be an embedded PNG.");
    return parsed.data;
  }

  return { TutorialExportPresetSchema: schema, readTutorialExportPresets, saveTutorialExportPresets, makeTutorialExportPreset, serializeTutorialExportPreset, parseTutorialExportPreset };
}

export type TutorialExportPresetProfile = ReturnType<typeof createTutorialExportPresetProfile>;
export const DEFAULT_TUTORIAL_EXPORT_PRESETS = createTutorialExportPresetProfile();
export const { readTutorialExportPresets, saveTutorialExportPresets, makeTutorialExportPreset, serializeTutorialExportPreset, parseTutorialExportPreset } = DEFAULT_TUTORIAL_EXPORT_PRESETS;

/** Normalize an uploaded PNG into a small embedded logo, without remote image references. */
export async function readTutorialBrandLogo(file: File): Promise<TutorialScreenshot> {
  if (file.type !== "image/png" || file.size > 4_000_000) throw new Error("Choose a PNG logo smaller than 4 MB.");
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 640 / bitmap.width, 320 / bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot prepare a logo.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return TutorialScreenshotSchema.parse({ dataUrl: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height, alt: "Organization logo" });
  } finally { bitmap.close(); }
}


