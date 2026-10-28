import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { createTutorialRecordingDraft, insertDraftStep, tutorialManifestToRecordingDraft, tutorialRecordingDraftToManifest } from "../recording/draft";
import { deserializeTutorialRecordingDraft, serializeTutorialRecordingDraft } from "../recording/serialization";
import { TutorialScreenshotSchema, type TutorialScreenshot } from "../core/screenshot";
import { exportTutorial } from "./index";
import { tutorialDocument } from "./document";
import { TutorialExportOptionsSchema } from "./options";

const screenshot: TutorialScreenshot = {
  dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=",
  width: 1, height: 1, alt: 'Interface <view> & "caption"',
};
function source() {
  const draft = insertDraftStep(createTutorialRecordingDraft({ title: "Illustrated guide" }), null);
  draft.steps[0].action = { id: "builder.addField", args: { type: "text" }, match: "subset" };
  draft.steps[0].screenshot = screenshot;
  draft.steps[0].check = { description: "New field exists", all: [{ path: "builder.fields", count: { min: 1 }, mode: "delta" }] };
  draft.steps[0].narration = { startMs: 0, endMs: 1000, transcript: "Spoken instruction" };
  return { draft };
}

describe("embedded interface screenshots", () => {
  it("requires a screenshot for every step unless a text-only guide is explicitly selected", async () => {
    const input = source();
    input.draft = insertDraftStep(input.draft, input.draft.steps[0].id);
    for (const format of ["html", "markdown", "scorm", "docx", "pptx", "pdf", "gif"] as const) {
      await expect(exportTutorial(input, format)).rejects.toThrow("1 steps have no screenshot");
    }
    await expect(exportTutorial(input, "html", undefined, { includeScreenshots: false })).resolves.toHaveProperty("blob");
  });

  it("allows only PNG pixels with matching dimensions, not remote URLs or active SVG", () => {
    expect(TutorialScreenshotSchema.parse(screenshot)).toEqual(screenshot);
    for (const dataUrl of ["https://example.org/image.png", "data:image/svg+xml;base64,PHN2Zz4=", "data:image/png;base64,bm90IGFuIGltYWdl"]) {
      expect(TutorialScreenshotSchema.safeParse({ ...screenshot, dataUrl }).success).toBe(false);
    }
    expect(TutorialScreenshotSchema.safeParse({ ...screenshot, width: 200 }).success).toBe(false);
  });

  it("survives editable draft export/import and canonical manifest round trips", async () => {
    const input = source();
    const imported = await deserializeTutorialRecordingDraft(await serializeTutorialRecordingDraft(input.draft));
    expect(imported.steps[0].screenshot).toEqual(screenshot);
    const manifest = tutorialRecordingDraftToManifest(imported);
    expect(manifest.chapters[0].steps[0].screenshot).toEqual(screenshot);
    expect(tutorialManifestToRecordingDraft(manifest).steps[0].screenshot).toEqual(screenshot);
    const json = await exportTutorial(input, "json");
    expect(JSON.parse(await json.blob.text()).chapters[0].steps[0].screenshot).toEqual(screenshot);
  });

  it("embeds images into HTML, Markdown, SCORM and Office archives", async () => {
    const input = source();
    for (const format of ["html", "markdown", "scorm", "docx", "pptx"] as const) {
      const result = await exportTutorial(input, format);
      if (format === "html" || format === "markdown") {
        expect(await result.blob.text()).toContain(screenshot.dataUrl);
      } else {
        const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
        if (format === "scorm") expect(await zip.file("index.html")!.async("text")).toContain(screenshot.dataUrl);
        else {
          const images = zip.file(/(?:word|ppt)\/media\/.*\.png$/);
          expect(images.length).toBe(1);
          expect(await images[0].async("base64")).toBe(screenshot.dataUrl.split(",")[1]);
        }
      }
    }
    const pdf = await exportTutorial(input, "pdf");
    expect(new TextDecoder().decode(await pdf.blob.arrayBuffer())).toContain("/Subtype /Image");
  });

  it("honors content and paper settings without changing the source tutorial", async () => {
    const input = source();
    const options = { includeScreenshots: false, includeOutcomes: false, includeTranscripts: false, paperSize: "LETTER" as const };
    const doc = tutorialDocument(input, options);
    expect(doc.paperSize).toBe("LETTER");
    expect(doc.chapters[0].steps[0]).toMatchObject({ screenshot: undefined, outcome: undefined, transcript: undefined });
    expect(input.draft.steps[0].screenshot).toEqual(screenshot);
    expect(await (await exportTutorial(input, "html", undefined, options)).blob.text()).not.toContain("<img");
    const word = await exportTutorial(input, "docx", undefined, options);
    const zip = await JSZip.loadAsync(await word.blob.arrayBuffer());
    expect(zip.file(/word\/media\/.*\.png$/)).toHaveLength(0);
    expect(await zip.file("word/document.xml")!.async("text")).toContain('w:w="12240"');
    expect(TutorialExportOptionsSchema.safeParse({ includeScreenshots: "false" }).success).toBe(false);
  });
});

