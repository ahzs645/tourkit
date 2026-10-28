import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { PDFDocument } from "@cantoo/pdf-lib";
import { createTutorialRecordingDraft, insertDraftStep } from "../recording/draft";
import { tutorialDocument, tutorialFilename, tutorialMarkdown, wrapText } from "./document";
import { exportTutorial } from "./index";
import { tutorialHtml } from "./html";

function source() {
  const draft = insertDraftStep(createTutorialRecordingDraft({ title: "Guide <script>alert(1)</script> & Ω", description: "A synthetic guide" }), null);
  draft.chapters[0].description = "Chapter introduction";
  draft.steps[0].title = "Do <this>";
  draft.steps[0].instruction = 'First line\nSecond line & "quoted"';
  draft.steps[0].check = { description: "The new field exists", all: [{ path: "builder.fields", count: { min: 1 }, mode: "delta" }] };
  draft.steps[0].narration = { startMs: 0, endMs: 1000, transcript: "Spoken explanation" };
  return { draft };
}

describe("tutorial guide export", () => {
  it("preserves chapter order, step order, outcomes, and transcripts without executable data", () => {
    const input = source();
    input.draft.chapters.push({ id: "second", title: "Second chapter" });
    input.draft.steps.unshift({ ...input.draft.steps[0], id: "last", chapterId: "second" });
    const doc = tutorialDocument(input);
    expect(doc.chapters.map((c) => c.steps.map((s) => s.number))).toEqual([[1], [2]]);
    expect(doc.chapters[0].steps[0]).toMatchObject({ title: "Do <this>", outcome: "The new field exists", transcript: "Spoken explanation" });
    expect(JSON.stringify(doc)).not.toContain("builder.fields");
    const markdown = tutorialMarkdown(doc);
    expect(markdown).toContain("Done when: The new field exists");
    expect(markdown).toContain("Narration: Spoken explanation");
    expect(markdown).toContain("\\<script\\>");
  });

  it("escapes Markdown syntax without cluttering ordinary punctuation", () => {
    const value = source();
    value.draft.steps[0].instruction = "Select Save (top right). Then press OK - done!\n# Not a heading\n1. Not a list";
    const markdown = tutorialMarkdown(tutorialDocument(value));
    expect(markdown).toContain("Select Save (top right). Then press OK - done!");
    expect(markdown).toContain("\\# Not a heading");
    expect(markdown).toContain("1\\. Not a list");
  });

  it("makes offline HTML inert and self-contained even with markup in authored text", () => {
    const html = tutorialHtml(tutorialDocument(source()));
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toMatch(/<script|<link|<iframe|src=/);
    expect(html).toContain('<style>');
    expect(html).toContain('href="#chapter-1"');
    expect(html).toContain("First line\nSecond line &amp; &quot;quoted&quot;");
  });

  it("allows static-only steps but rejects empty guides and invalid interactive JSON", async () => {
    const input = source();
    delete input.draft.steps[0].check;
    await expect(exportTutorial(input, "html", undefined, { includeScreenshots: false })).resolves.toMatchObject({ filename: expect.stringMatching(/\.html$/) });
    await expect(exportTutorial(input, "json")).rejects.toThrow();
    expect(() => tutorialDocument({ draft: createTutorialRecordingDraft() })).toThrow("at least one step");
  });

  it("writes real DOCX and PPTX packages containing complete instructions", async () => {
    const input = source();
    input.draft.steps[0].instruction = "Lengthy instructions. ".repeat(250) + "FINAL SENTENCE";
    for (const format of ["docx", "pptx"] as const) {
      const result = await exportTutorial(input, format, undefined, { includeScreenshots: false });
      const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
      expect(zip.file("[Content_Types].xml")).not.toBeNull();
      const files = format === "docx" ? [zip.file("word/document.xml")!] : zip.file(/^ppt\/slides\/slide\d+\.xml$/);
      const text = (await Promise.all(files.map((file) => file.async("text")))).join(" ");
      expect(text).toContain("FINAL SENTENCE");
      expect(text).toContain("Spoken explanation");
      expect(text).toContain("Do &lt;this&gt;");
      if (format === "pptx") expect(files.length).toBeGreaterThan(3);
    }
  });

  it("writes a readable, paginated PDF with embedded fonts", async () => {
    const input = source();
    input.draft.steps[0].instruction = "Instruction text with Unicode → • Ω. ".repeat(350);
    const result = await exportTutorial(input, "pdf", undefined, { includeScreenshots: false });
    const bytes = await result.blob.arrayBuffer();
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(1);
    expect(pdf.getTitle()).toBe(input.draft.title);
  }, 20_000);

  it("packages the SCORM entry point at the ZIP root with escaped metadata", async () => {
    const result = await exportTutorial(source(), "scorm", undefined, { includeScreenshots: false });
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    expect(Object.keys(zip.files).sort()).toEqual(["imsmanifest.xml", "index.html"]);
    const manifest = await zip.file("imsmanifest.xml")!.async("text");
    expect(manifest).toContain('adlcp:scormtype="sco" href="index.html"');
    expect(manifest).toContain("<schemaversion>1.2</schemaversion>");
    expect(manifest).toContain("&lt;script&gt;");
  });

  it("wraps long words without dropping characters and sanitizes filenames", () => {
    const word = "Ω".repeat(250);
    const lines = wrapText(word, (line) => line.length <= 60);
    expect(lines.join("")).toBe(word);
    expect(lines.every((line) => line.length <= 60)).toBe(true);
    expect(tutorialFilename("../../Guide / café")).toBe("Guide-café");
    expect(tutorialFilename("...")).toBe("tutorial");
  });
});

