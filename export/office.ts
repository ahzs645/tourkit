import { documentStepTitle, stepParagraphs, wrapText, type TutorialDocument } from "./document";
import { fitScreenshot, screenshotBytes } from "../core/screenshot";
import type { TutorialExportMetadata } from "./runtime";

export async function tutorialWord(doc: TutorialDocument, metadata: TutorialExportMetadata = {}): Promise<Blob> {
  const { Document, Packer, Paragraph, HeadingLevel, TextRun, Footer, PageNumber, ImageRun } = await import("docx");
  const paragraphs = (text: string) => text.split("\n").map((line) => new Paragraph({ text: line, spacing: { after: 140 } }));
  const document = new Document({
    title: doc.title, description: doc.description, creator: metadata.creator ?? "Tutorial Studio",
    styles: { default: { document: { run: { font: "Calibri", size: 22 }, paragraph: { spacing: { line: 280 } } } } },
    sections: [{
      properties: { page: { size: doc.paperSize === "LETTER" ? { width: 12240, height: 15840 } : { width: 11906, height: 16838 } } },
      footers: { default: new Footer({ children: [new Paragraph({ children: [new TextRun({ children: [PageNumber.CURRENT] })], alignment: "right" })] }) },
      children: [new Paragraph({ text: doc.title, heading: HeadingLevel.TITLE }),
        ...paragraphs(doc.description), ...paragraphs(`${doc.estimatedMinutes} minute guide`),
        ...doc.chapters.flatMap((chapter) => [
          new Paragraph({ text: chapter.title, heading: HeadingLevel.HEADING_1, keepNext: true }),
          ...paragraphs(chapter.description ?? ""),
          ...chapter.steps.flatMap((step) => [
            new Paragraph({ text: documentStepTitle(step), heading: HeadingLevel.HEADING_2, keepNext: true,
              pageBreakBefore: step.pageBreakBefore,
              ...(step.contentKind && step.contentKind !== "action" ? { shading: { fill: step.contentKind === "warning" ? "FFFBEB" : "EFF6FF" } } : {}) }),
            ...stepParagraphs(step).flatMap(paragraphs),
            ...(step.screenshot ? [new Paragraph({ children: [new ImageRun({ type: "png", data: screenshotBytes(step.screenshot),
              transformation: fitScreenshot(step.screenshot, 570, 600), altText: { title: step.screenshot.alt, description: step.screenshot.alt, name: `Step ${step.number}` } })],
              spacing: { before: 100, after: 180 } }),
              ...(step.screenshot.caption ? [new Paragraph({ text: step.screenshot.caption, spacing: { after: 180 }, style: "Caption" })] : [])] : []),
          ]),
        ]),
      ],
    }],
  });
  return Packer.toBlob(document);
}

/** Explicit continuation slides keep long instructions editable and readable. */
export async function tutorialPowerPoint(doc: TutorialDocument, metadata: TutorialExportMetadata = {}): Promise<Blob> {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const deck = new PptxGenJS();
  deck.layout = "LAYOUT_WIDE";
  deck.title = doc.title;
  deck.subject = doc.description;
  deck.author = metadata.creator ?? "Tutorial Studio";
  deck.theme = { headFontFace: "Arial", bodyFontFace: "Arial" };
  const add = (heading: string, body: string, label: string) => {
    // Conservative character widths work with the fixed 22pt body font, including wide capitals.
    const lines = wrapText(body, (line) => [...line].length <= 62);
    for (let offset = 0; offset < lines.length; offset += 10) {
      const slide = deck.addSlide();
      slide.background = { color: "F3F6FA" };
      slide.addText(label, { x: 0.7, y: 0.35, w: 12, h: 0.4, color: "2563EB", fontSize: 13, margin: 0 });
      slide.addText(heading + (offset ? " (continued)" : ""), {
        x: 0.7, y: 0.95, w: 12, h: 1.3, fontSize: 28, bold: true, color: "172238", margin: 0, fit: "shrink",
      });
      slide.addText(lines.slice(offset, offset + 10).join("\n"), {
        x: 0.7, y: 2.5, w: 12, h: 4.35, fontSize: 22, color: "172238", margin: 0, valign: "top", breakLine: false, fit: "shrink",
      });
      slide.addNotes(`${heading}\n\n${body}`);
    }
  };
  add(doc.title, doc.description, `Tutorial · ${doc.estimatedMinutes} minutes`);
  for (const chapter of doc.chapters) {
    add(chapter.title, chapter.description ?? "", "Chapter");
    for (const step of chapter.steps) {
      add(documentStepTitle(step), stepParagraphs(step).join("\n\n"), chapter.title);
      if (step.screenshot) {
        const slide = deck.addSlide();
        slide.background = { color: "F3F6FA" };
        slide.addText(documentStepTitle(step), { x: 0.6, y: 0.25, w: 12.1, h: 0.7, fontSize: 24, bold: true, color: "172238", fit: "shrink" });
        const scale = Math.min(12.1 / step.screenshot.width, (step.screenshot.caption ? 5.2 : 5.8) / step.screenshot.height);
        const w = step.screenshot.width * scale, h = step.screenshot.height * scale;
        slide.addImage({ data: step.screenshot.dataUrl, x: (13.333 - w) / 2, y: 1.2, w, h, altText: step.screenshot.alt });
        if (step.screenshot.caption) slide.addText(step.screenshot.caption, { x: 0.6, y: 6.7, w: 12.1, h: 0.4, fontSize: 12, color: "516077", fit: "shrink" });
        slide.addNotes(stepParagraphs(step).join("\n\n"));
      }
    }
  }
  const data = await deck.write({ outputType: "arraybuffer", compression: true });
  return new Blob([data as ArrayBuffer], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
}

