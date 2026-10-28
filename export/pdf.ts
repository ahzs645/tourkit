import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";
import { fitScreenshot } from "../core/screenshot";
import { documentStepTitle, stepParagraphs, type TutorialDocument } from "./document";
import { TutorialBrandingSchema } from "./options";
import type { TutorialExportRuntime, TutorialExportMetadata, TutorialPdfFontUrls } from "./runtime";

const PDF_TEMPLATES = {
  guide: { margin: 48, fontSize: 11, lineHeight: 1.3, imageHeight: 440, titleSize: 26, chapterSize: 18, stepSize: 13, paragraphGap: 10 },
  compact: { margin: 36, fontSize: 10, lineHeight: 1.15, imageHeight: 340, titleSize: 23, chapterSize: 16, stepSize: 12, paragraphGap: 7 },
  presentation: { margin: 40, fontSize: 12, lineHeight: 1.2, imageHeight: 340, titleSize: 28, chapterSize: 18, stepSize: 15, paragraphGap: 8 },
} as const;

/** Keep each short step's words and image together using the actual measured layout. */
export function tutorialPdfDefinition(doc: TutorialDocument, imageHeights?: ReadonlyMap<number, number>, metadata: TutorialExportMetadata = {}): TDocumentDefinitions {
  const brand = TutorialBrandingSchema.parse({ author: metadata.defaultAuthor, ...doc.branding });
  const templateName = doc.pdfTemplate ?? "guide";
  const template = PDF_TEMPLATES[templateName];
  const landscape = templateName === "presentation";
  const paperSize = doc.paperSize ?? "A4";
  const pageWidth = landscape ? (paperSize === "LETTER" ? 792 : 841.89) : (paperSize === "LETTER" ? 612 : 595.28);
  const contentWidth = pageWidth - template.margin * 2;
  const stepBreaks = new Map<string, { requested: boolean; topMargin: number }>();
  const content: Content[] = [];
  if (brand.logo) {
    const logoSize = fitScreenshot(brand.logo, 180, 72);
    content.push({ image: brand.logo.dataUrl, width: logoSize.width, height: logoSize.height, margin: [0, 0, 0, 22] });
  }
  content.push(
    { text: doc.title, style: "title" },
    { text: doc.description, margin: [0, 0, 0, 12] },
    { text: `${doc.estimatedMinutes} minute guide`, color: "#516077", margin: [0, 0, 0, 20] },
  );
  if (brand.organization || (brand.author && brand.author !== metadata.defaultAuthor)) content.push({ text: [brand.author, brand.organization].filter(Boolean).join(" · "), color: "#516077", margin: [0, 0, 0, 20] });
  if (doc.includeCover) content.push({ text: " ", fontSize: 1, pageBreak: "after" });
  if (doc.includeTableOfContents) content.push({ toc: { title: { text: "Contents", style: "chapter" } }, pageBreak: "after" });
  for (const [chapterIndex, chapter] of doc.chapters.entries()) {
    for (const [stepIndex, step] of chapter.steps.entries()) {
      const id = `tutorial-step-${chapterIndex}-${stepIndex}`;
      const stack: Content[] = [];
      // A chapter heading travels with its first step, including when both page options are enabled.
      if (stepIndex === 0) {
        stack.push({ text: chapter.title, style: "chapter", ...(doc.includeTableOfContents ? { tocItem: true } : {}) });
        if (chapter.description) stack.push({ text: chapter.description, margin: [0, 0, 0, 12] });
      }
      const kind = step.contentKind ?? "action";
      const isBlock = kind !== "action";
      const colors = kind === "warning" ? { background: "#fff3e8", ink: "#8a3b0c" }
        : kind === "tip" ? { background: "#eaf7ef", ink: "#1b6140" }
        : { background: "#eef3fa", ink: brand.accent };
      const instructions: Content[] = [{ text: documentStepTitle(step), style: "step", ...(isBlock ? { color: colors.ink } : {}) }];
      for (const text of stepParagraphs(step)) instructions.push({ text, margin: [0, 0, 0, template.paragraphGap] });
      if (isBlock) stack.push({ table: { widths: ["*"], body: [[{ stack: instructions, fillColor: colors.background, margin: [10, 0, 10, 0] }]] }, layout: "noBorders", margin: [0, 8, 0, 12] });
      else stack.push(...instructions);
      if (step.screenshot) {
        const size = fitScreenshot(step.screenshot, contentWidth, imageHeights?.get(step.number) ?? template.imageHeight);
        stack.push({ image: step.screenshot.dataUrl, width: size.width, height: size.height, margin: [0, 4, 0, step.screenshot.caption ? 6 : 16] });
        if (step.screenshot.caption) stack.push({ text: step.screenshot.caption, fontSize: Math.max(9, template.fontSize - 1), italics: true, color: "#516077", margin: [0, 0, 0, 16] });
      }
      // pdfmake accepts IDs on stacks and passes them to pageBreakBefore; its types only declare IDs on text.
      const block: Content & { id: string } = { id, stack };
      content.push(block);
      stepBreaks.set(id, {
        requested: !!step.pageBreakBefore || landscape || (!!doc.newPagePerChapter && chapterIndex > 0 && stepIndex === 0) || (!!doc.newPagePerScreenshot && !!step.screenshot),
        topMargin: stepIndex === 0 ? 18 : 12,
      });
    }
  }
  return {
    info: { title: doc.title, author: brand.author, creator: brand.organization || metadata.creator || "Tutorial Studio" }, pageSize: paperSize,
    pageOrientation: landscape ? "landscape" : "portrait",
    pageMargins: [template.margin, template.margin, template.margin, brand.footer ? Math.max(70, template.margin) : template.margin], content,
    defaultStyle: { font: doc.pdfFont ?? "Roboto", fontSize: template.fontSize, lineHeight: template.lineHeight, color: "#172238" },
    styles: {
      title: { fontSize: template.titleSize, bold: true, margin: [0, 0, 0, 16] },
      chapter: { fontSize: template.chapterSize, bold: true, color: brand.accent, margin: [0, 18, 0, 10] },
      step: { fontSize: template.stepSize, bold: true, margin: [0, 12, 0, 8] },
    },
    pageBreakBefore: (node) => {
      const step = node.id ? stepBreaks.get(node.id) : undefined;
      if (!step) return false;
      // Never break a stack already at the top, even if a long step spans several pages.
      // Unlike an unbreakable stack, long instructions can continue without clipping.
      const belowPageTop = node.startPosition.top > template.margin + step.topMargin + 1;
      return belowPageTop && (step.requested || node.pageNumbers.length > 1);
    },
    footer: (page, pages) => ({ columns: [
      { text: brand.footer, width: "*" }, { text: `${page} / ${pages}`, width: 55, alignment: "right" },
    ], columnGap: 12, margin: [template.margin, 12, template.margin, 0], fontSize: 9, color: "#516077" }),
  };
}

export async function tutorialPdf(doc: TutorialDocument, runtime: Pick<TutorialExportRuntime, "pdfFonts" | "metadata"> = {}): Promise<Blob> {
  if (doc.pdfFont === "LiberationSans" && !runtime.pdfFonts?.LiberationSans) {
    throw new Error("Liberation Sans is not configured for this application. Choose Roboto or provide all four font assets.");
  }
  const [{ default: pdfMake }, { default: fonts }] = await Promise.all([
    import("pdfmake/build/pdfmake"), import("pdfmake/build/vfs_fonts"),
  ]);
  if (doc.pdfFont === "LiberationSans") {
    const vfs = await liberationSansVfs(runtime.pdfFonts!.LiberationSans!);
    pdfMake.addVirtualFileSystem(vfs);
    pdfMake.addFonts({ LiberationSans: { normal: "tutorial-sans-regular.ttf", bold: "tutorial-sans-bold.ttf", italics: "tutorial-sans-italic.ttf", bolditalics: "tutorial-sans-bolditalic.ttf" } });
  }
  // pdfmake 0.3's vfs_fonts module exports the VFS map itself.
  pdfMake.addVirtualFileSystem(fonts);
  const generate = async () => {
    let imageHeights: Map<number, number> | undefined;
    if (doc.pdfTemplate === "presentation") {
      // Landscape pages have little vertical space. Measure the actual chapter and
      // instruction layout first, then give each image the remaining space.
      imageHeights = new Map();
      const measured = tutorialPdfDefinition(doc, undefined, runtime.metadata);
      const content = measured.content as Array<Content & { id?: string; stack?: Array<Content & { image?: string }> }>;
      const imagePositions = new Map<number, { top: number; page: number }>();
      const imageTails = new Map<number, number>();
      for (const block of content) {
        if (!block.stack) continue;
        const imageIndex = block.stack.findIndex((entry) => typeof entry === "object" && !!entry.image);
        if (imageIndex < 0) continue;
        const indices = block.id!.match(/^tutorial-step-(\d+)-(\d+)$/)!;
        const stepNumber = doc.chapters[Number(indices[1])].steps[Number(indices[2])].number;
        const screenshot = doc.chapters[Number(indices[1])].steps[Number(indices[2])].screenshot!;
        block.stack[imageIndex] = { id: `tutorial-image-space-${stepNumber}`, text: " ", fontSize: 1, lineHeight: 1, margin: [0, 4, 0, screenshot.caption ? 6 : 16] };
        block.stack.push({ id: `tutorial-image-end-${stepNumber}`, text: " ", fontSize: 1, lineHeight: 1 });
      }
      const breakBefore = measured.pageBreakBefore!;
      const pageHeight = doc.paperSize === "LETTER" ? 612 : 595.28;
      const bottomMargin = doc.branding?.footer ? Math.max(70, PDF_TEMPLATES.presentation.margin) : PDF_TEMPLATES.presentation.margin;
      const innerHeight = pageHeight - PDF_TEMPLATES.presentation.margin - bottomMargin;
      measured.pageBreakBefore = (node, queries) => {
        if (node.id?.startsWith("tutorial-image-space-")) {
          const number = Number(node.id.slice("tutorial-image-space-".length));
          imagePositions.set(number, { top: node.startPosition.top, page: node.startPosition.pageNumber });
        } else if (node.id?.startsWith("tutorial-image-end-")) {
          const number = Number(node.id.slice("tutorial-image-end-".length));
          const start = imagePositions.get(number);
          if (start) imageTails.set(number, node.startPosition.top - start.top + (node.startPosition.pageNumber - start.page) * innerHeight);
        }
        return breakBefore(node, queries);
      };
      await pdfMake.createPdf(measured).getBuffer();
      for (const [number, start] of imagePositions) {
        // Captions and the reserved footer area consume real page space too.
        // A long explanation may need a continuation page. Keep its image useful
        // rather than shrinking it into the last few points of the text page.
        imageHeights.set(number, Math.max(160, Math.min(PDF_TEMPLATES.presentation.imageHeight, pageHeight - bottomMargin - start.top - (imageTails.get(number) ?? 20))));
      }
    }
    return pdfMake.createPdf(tutorialPdfDefinition(doc, imageHeights, runtime.metadata)).getBuffer();
  };
  // pdfmake 0.3: getBuffer() returns a Promise.
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const buffer = await Promise.race([
    generate(),
    new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error("PDF generation timed out. Please try again.")), 60_000);
    }),
  ]).finally(() => clearTimeout(timeout));
  return new Blob([new Uint8Array(buffer)], { type: "application/pdf" });
}

const sansFonts = new Map<string, Promise<Record<string, string>>>();
/** Cache by resolved URL set, so two host adapters cannot reuse each other's font downloads. */
function liberationSansVfs(urls: TutorialPdfFontUrls): Promise<Record<string, string>> {
  const files = [
    ["tutorial-sans-regular.ttf", urls.normal], ["tutorial-sans-bold.ttf", urls.bold],
    ["tutorial-sans-italic.ttf", urls.italics], ["tutorial-sans-bolditalic.ttf", urls.bolditalics],
  ];
  if (files.some(([, url]) => typeof url !== "string" || !url.trim())) return Promise.reject(new Error("Provide all four Liberation Sans font assets, or choose Roboto."));
  const cacheKey = JSON.stringify(files);
  let pending = sansFonts.get(cacheKey);
  if (pending) return pending;
  pending = Promise.all(files.map(async ([key, url]) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error("The PDF font could not be loaded. Try again or choose Roboto.");
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return [key, btoa(binary)] as const;
  })).then(Object.fromEntries).catch((error) => { sansFonts.delete(cacheKey); throw error; });
  sansFonts.set(cacheKey, pending);
  return pending;
}


