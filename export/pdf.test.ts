import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from "@cantoo/pdf-lib";
import type { Node } from "pdfmake/interfaces";
import { deflateSync } from "node:zlib";
import type { TutorialDocument } from "./document";
import { tutorialPdf, tutorialPdfDefinition } from "./pdf";
import { TutorialExportOptionsSchema } from "./options";

// A real, compressible 800 x 600 PNG exercises image placement without a large fixture.
function screenshot() {
  const chunk = (type: string, bytes: Buffer) => {
    const payload = Buffer.concat([Buffer.from(type), bytes]);
    let crc = 0xffffffff;
    for (const byte of payload) {
      crc ^= byte;
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    const header = Buffer.alloc(4); header.writeUInt32BE(bytes.length);
    const footer = Buffer.alloc(4); footer.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([header, payload, footer]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(800, 0); header.writeUInt32BE(600, 4); header[8] = 8; header[9] = 2;
  const rows = Buffer.alloc(600 * (800 * 3 + 1), 255);
  for (let row = 0; row < 600; row++) rows[row * (800 * 3 + 1)] = 0;
  const png = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
  return { dataUrl: `data:image/png;base64,${png.toString("base64")}`, width: 800, height: 600, alt: "Synthetic screenshot" };
}

function guide(): TutorialDocument {
  return { title: "PDF layout test", description: "Synthetic tutorial", estimatedMinutes: 4,
    chapters: [{ title: "First section", description: "Section introduction", steps: [
      { number: 1, title: "First step", instruction: "Read the interface.", screenshot: screenshot() },
      { number: 2, title: "Second step", instruction: "Select the next control.", screenshot: screenshot() },
    ] }, { title: "Second section", steps: [
      { number: 3, title: "Text step", instruction: "A deliberate instruction without an image." },
    ] }] };
}
const node = (id: string, top: number, pageNumbers: number[]): Node => ({
  id, startPosition: { top, left: 48, pageNumber: pageNumbers[0], pageOrientation: "portrait", verticalRatio: 0, horizontalRatio: 0, pageInnerHeight: 746, pageInnerWidth: 499 },
  pageNumbers, pages: Math.max(...pageNumbers), stack: true,
});
const queries = { getFollowingNodesOnPage: () => [], getNodesOnNextPage: () => [], getPreviousNodesOnPage: () => [] };

describe("tutorial PDF layout", () => {
  it("moves a split short step as one block and allows a long step to continue from the page top", () => {
    const definition = tutorialPdfDefinition(guide());
    expect(definition.pageBreakBefore!(node("tutorial-step-0-1", 650, [1, 2]), queries)).toBe(true);
    expect(definition.pageBreakBefore!(node("tutorial-step-0-1", 60, [2, 3]), queries)).toBe(false);
    expect(definition.pageBreakBefore!(node("tutorial-step-0-1", 100, [1]), queries)).toBe(false);
  });

  it("applies chapter and screenshot breaks without breaking twice at the top of the page", () => {
    const doc = guide(); doc.newPagePerChapter = true; doc.newPagePerScreenshot = true;
    const definition = tutorialPdfDefinition(doc);
    expect(definition.pageBreakBefore!(node("tutorial-step-0-0", 200, [1]), queries)).toBe(true);
    expect(definition.pageBreakBefore!(node("tutorial-step-0-0", 66, [2]), queries)).toBe(false);
    expect(definition.pageBreakBefore!(node("tutorial-step-0-1", 250, [2]), queries)).toBe(true);
    expect(definition.pageBreakBefore!(node("tutorial-step-1-0", 250, [3]), queries)).toBe(true);
    doc.newPagePerChapter = false;
    expect(tutorialPdfDefinition(doc).pageBreakBefore!(node("tutorial-step-1-0", 250, [3]), queries)).toBe(false);
  });

  it("keeps the title with the first section unless a cover or explicit step break is requested", async () => {
    const doc: TutorialDocument = { title: "Setup guide", description: "Synthetic navigation lesson", estimatedMinutes: 2,
      newPagePerChapter: true, chapters: [
        { title: "Lesson setup", steps: [{ number: 0, title: "Before you begin", contentKind: "prerequisite", instruction: "Use the synthetic training stage." }] },
        { title: "Navigation", steps: [{ number: 1, title: "Open Measures", instruction: "Open the training list." }] },
      ] };
    const definition = tutorialPdfDefinition(doc);
    expect(definition.pageBreakBefore!(node("tutorial-step-0-0", 200, [1]), queries)).toBe(false);
    expect(definition.pageBreakBefore!(node("tutorial-step-1-0", 250, [1]), queries)).toBe(true);
    expect((await PDFDocument.load(await (await tutorialPdf(doc)).arrayBuffer())).getPageCount()).toBe(2);
    doc.includeCover = true;
    expect((await PDFDocument.load(await (await tutorialPdf(doc)).arrayBuffer())).getPageCount()).toBe(3);
    doc.includeCover = false; doc.chapters[0].steps[0].pageBreakBefore = true;
    expect(tutorialPdfDefinition(doc).pageBreakBefore!(node("tutorial-step-0-0", 200, [1]), queries)).toBe(true);
    expect((await PDFDocument.load(await (await tutorialPdf(doc)).arrayBuffer())).getPageCount()).toBe(3);
  });

  it("produces distinct compact and landscape templates and upgrades saved options", () => {
    expect(TutorialExportOptionsSchema.parse({ paperSize: "LETTER" })).toMatchObject({ pdfTemplate: "guide", newPagePerChapter: false, newPagePerScreenshot: false });
    expect(TutorialExportOptionsSchema.safeParse({ pdfTemplate: "unknown" }).success).toBe(false);
    const doc = guide(); doc.pdfTemplate = "compact";
    expect(tutorialPdfDefinition(doc).defaultStyle?.fontSize).toBe(10);
    doc.pdfTemplate = "presentation";
    expect(tutorialPdfDefinition(doc).pageOrientation).toBe("landscape");
  });

  it("avoids repeating a step number already present in its title without editing source text", () => {
    const doc = guide(); doc.chapters[0].steps[0].title = "1 · Main Menu";
    const definition = tutorialPdfDefinition(doc);
    expect(JSON.stringify(definition.content)).toContain('"text":"1. Main Menu"');
    expect(doc.chapters[0].steps[0].title).toBe("1 · Main Menu");
    doc.chapters[0].steps[0].title = "2 · Other number";
    expect(JSON.stringify(tutorialPdfDefinition(doc).content)).toContain('"text":"1. 2 · Other number"');
  });

  it("generates actual PDFs without image-only overflow or duplicate empty pages", async () => {
    const doc = guide();
    const pdf = await PDFDocument.load(await (await tutorialPdf(doc)).arrayBuffer());
    expect(pdf.getPageCount()).toBe(2);
    doc.newPagePerChapter = true; doc.newPagePerScreenshot = true;
    const paged = await PDFDocument.load(await (await tutorialPdf(doc)).arrayBuffer());
    expect(paged.getPageCount()).toBe(4); // intro, two illustrated steps, final section
    doc.pdfTemplate = "presentation";
    const presentation = await PDFDocument.load(await (await tutorialPdf(doc)).arrayBuffer());
    expect(presentation.getPageCount()).toBe(4);
    expect(presentation.getPage(0).getWidth()).toBeGreaterThan(presentation.getPage(0).getHeight());
  });

  it("preserves a step longer than a page rather than making its stack unbreakable", async () => {
    const doc = guide();
    doc.chapters = [{ title: "Long section", steps: [{ number: 1, title: "Long step", instruction: "Long text continues on subsequent pages. ".repeat(250) }] }];
    const pdf = await PDFDocument.load(await (await tutorialPdf(doc)).arrayBuffer());
    expect(pdf.getPageCount()).toBeGreaterThan(2);
  });

  it("fits landscape screenshots below the measured chapter and instruction text", async () => {
    const doc = guide(); doc.pdfTemplate = "presentation";
    doc.chapters = [{ title: "Where the work happens", description: "The content area, the buttons above it, and the bar that says what is open.", steps: [{
      number: 1, title: "Content Area", screenshot: screenshot(),
      instruction: "This is where you read and enter information. The manual splits it in two: the Records List, a chronological list of what is already on file, and the Record Details beneath it for whichever row you select. Open Measures to see both halves.",
      outcome: "the Measures window is open.",
    }] }];
    const pdf = await PDFDocument.load(await (await tutorialPdf(doc)).arrayBuffer());
    expect(pdf.getPageCount()).toBe(2); // introduction and one complete illustrated slide
  });

  it("keeps long-step landscape images readable when they need a continuation page", async () => {
    const doc = guide(); doc.pdfTemplate = "presentation";
    doc.chapters = [{ title: "Long explanation", steps: [{ number: 1, title: "Read before continuing", instruction: "Read this long explanation.\n".repeat(20), screenshot: screenshot() }] }];
    const pdf = await PDFDocument.load(await (await tutorialPdf(doc)).arrayBuffer());
    const imageHeights: number[] = [];
    for (const page of pdf.getPages()) {
      const contents = page.node.Contents();
      const streams = contents instanceof PDFArray ? contents.asArray().map((entry) => pdf.context.lookup(entry)) : [contents];
      for (const stream of streams) {
        if (!(stream instanceof PDFRawStream)) continue;
        const commands = new TextDecoder().decode(decodePDFRawStream(stream).decode());
        for (const match of commands.matchAll(/[\d.]+ 0 0 -([\d.]+) [\d.]+ [\d.]+ cm\s*\/I\d+ Do/g)) imageHeights.push(Number(match[1]));
      }
    }
    expect(imageHeights).toHaveLength(1);
    expect(imageHeights[0]).toBeGreaterThanOrEqual(160);
  });

  it("generates linked contents, a cover, a caption and a separately paged editorial block with branding", async () => {
    const doc = guide(); doc.includeCover = true; doc.includeTableOfContents = true;
    doc.branding = TutorialExportOptionsSchema.parse({ branding: { accent: "#1c6679", author: "Tutorial team", organization: "Example training", footer: "Synthetic training guide" } }).branding;
    doc.chapters = [{ title: "Orientation", steps: [
      { number: 1, actionNumber: 1, title: "Read the menu", instruction: "Review the menu.", screenshot: { ...screenshot(), caption: "The menu in the synthetic interface." } },
      { number: 2, title: "Training environment", contentKind: "warning", pageBreakBefore: true, instruction: "Use synthetic records for this training." },
    ] }];
    const definition = tutorialPdfDefinition(doc);
    expect(JSON.stringify(definition.content)).toContain('"text":"Warning: Training environment"');
    expect(JSON.stringify(definition.content)).toContain('"tocItem":true');
    expect(JSON.stringify(definition.content)).toContain("The menu in the synthetic interface.");
    expect(definition.styles?.chapter.color).toBe("#1c6679");
    const pdf = await PDFDocument.load(await (await tutorialPdf(doc)).arrayBuffer());
    expect(pdf.getAuthor()).toBe("Tutorial team");
    expect(pdf.getPageCount()).toBe(4);
    expect(pdf.getPage(1).node.Annots()?.size()).toBeGreaterThan(0);
  });

  it("fits landscape images with multi-line captions above a branded footer", async () => {
    const doc = guide(); doc.pdfTemplate = "presentation";
    doc.branding = TutorialExportOptionsSchema.parse({ branding: { footer: "Synthetic training guide" } }).branding;
    doc.chapters = [{ title: "Read the interface", description: "Review the window before choosing the next action.", steps: [{
      number: 1, title: "Look at the menu", instruction: "Review the synthetic interface. ".repeat(5),
      screenshot: { ...screenshot(), caption: "This caption explains the interface and the highlighted control in enough detail to wrap across several lines. ".repeat(3) },
    }] }];
    const pdf = await PDFDocument.load(await (await tutorialPdf(doc)).arrayBuffer());
    expect(pdf.getPageCount()).toBe(2); // introduction and one complete illustrated slide
  });

  it("reports missing optional assets without silently changing the requested font", async () => {
    const doc = guide(); doc.pdfFont = "LiberationSans";
    await expect(tutorialPdf(doc)).rejects.toThrow("Liberation Sans is not configured");
  });

  it("embeds the alternate font through explicit font assets below a deployment base path", async () => {
    const fontDirectory = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
    const fetcher = vi.fn(async (path: string) => {
      const bytes = await readFile(join(fontDirectory, "standard_fonts", path.split("/").at(-1)!));
      return { ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
    });
    vi.stubGlobal("fetch", fetcher);
    try {
      const doc = guide(); doc.pdfFont = "LiberationSans"; doc.chapters[0].steps[0].instruction = "Embedded local font.";
      const pdf = await PDFDocument.load(await (await tutorialPdf(doc, { pdfFonts: { LiberationSans: { normal: "/training-assets/vendor/pdfjs/standard_fonts/LiberationSans-Regular.ttf", bold: "/training-assets/vendor/pdfjs/standard_fonts/LiberationSans-Bold.ttf", italics: "/training-assets/vendor/pdfjs/standard_fonts/LiberationSans-Italic.ttf", bolditalics: "/training-assets/vendor/pdfjs/standard_fonts/LiberationSans-BoldItalic.ttf" } } })).arrayBuffer());
      expect(pdf.getPageCount()).toBeGreaterThan(0);
      expect(fetcher).toHaveBeenCalledTimes(4);
      expect(fetcher).toHaveBeenCalledWith("/training-assets/vendor/pdfjs/standard_fonts/LiberationSans-Bold.ttf");
    } finally { vi.unstubAllGlobals(); }
  });
});


