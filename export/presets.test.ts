// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { TutorialExportOptionsSchema } from "./options";
import { makeTutorialExportPreset, parseTutorialExportPreset, readTutorialExportPresets, saveTutorialExportPresets, serializeTutorialExportPreset } from "./presets";

const logo = { dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=", width: 1, height: 1, alt: "Test logo" };
beforeEach(() => localStorage.clear());

describe("tutorial export presets", () => {
  it("round trips appearance and all reading settings with an embedded PNG", () => {
    const options = TutorialExportOptionsSchema.parse({ pdfTemplate: "compact", pdfFont: "LiberationSans", newPagePerChapter: true, includeCover: true, includeTableOfContents: true,
      branding: { logo, accent: "#235a79", organization: "Example training", author: "Trainer", footer: "Training only" } });
    const preset = makeTutorialExportPreset(" Training handout ", options);
    saveTutorialExportPresets([preset]);
    expect(readTutorialExportPresets()).toEqual([preset]);
    expect(parseTutorialExportPreset(serializeTutorialExportPreset(preset))).toEqual(preset);
    expect(preset.name).toBe("Training handout");
  });
  it("upgrades legacy options and keeps presets with valid schemas when storage has a corrupt entry", () => {
    const legacy = { schemaVersion: 1, id: "legacy", name: "Old", options: { paperSize: "LETTER" } };
    localStorage.setItem("tourkit:export-presets", JSON.stringify([legacy, { name: "Invalid" }]));
    expect(readTutorialExportPresets()).toMatchObject([{ id: "legacy", options: { paperSize: "LETTER", pdfFont: "Roboto", includeCover: false, branding: { author: "" } } }]);
  });
  it("rejects remote logos, unsupported fonts and invalid colours on import", () => {
    const base = makeTutorialExportPreset("Valid", TutorialExportOptionsSchema.parse({}));
    for (const options of [{ branding: { logo: { ...logo, dataUrl: "https://example.com/logo.png" } } }, { pdfFont: "unknown" }, { branding: { accent: "url(secret)" } }]) {
      expect(() => parseTutorialExportPreset(JSON.stringify({ ...base, options }))).toThrow("not a valid tutorial export preset");
    }
    expect(() => parseTutorialExportPreset("bad JSON")).toThrow("not valid JSON");
  });
  it("never includes an original screenshot in a branded preset", () => {
    const options = TutorialExportOptionsSchema.parse({ branding: { logo: { ...logo, sourceDataUrl: logo.dataUrl, sourceWidth: 1, sourceHeight: 1 } } });
    expect(serializeTutorialExportPreset(makeTutorialExportPreset("Safe", options))).not.toContain("sourceDataUrl");
  });
});

