import { documentStepTitle, stepParagraphs, wrapText, type TutorialDocument } from "./document";
import { fitScreenshot, type TutorialScreenshot } from "../core/screenshot";

/** Animated reading cards, not a recording of the application or pointer geometry. */
export async function tutorialGif(doc: TutorialDocument, onProgress?: (text: string) => void): Promise<Blob> {
  const { GIFEncoder, quantize, applyPalette } = await import("gifenc");
  const canvas = document.createElement("canvas");
  canvas.width = 960; canvas.height = 720;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("This browser cannot render animated GIF cards.");
  const gif = GIFEncoder();
  const cards: { title: string; body: string; label: string; screenshot?: TutorialScreenshot }[] = [{ title: doc.title, body: doc.description, label: "Tutorial" },
    ...doc.chapters.flatMap((chapter) => [
      { title: chapter.title, body: chapter.description ?? "", label: "Chapter" },
      ...chapter.steps.map((step) => ({ title: documentStepTitle(step), body: stepParagraphs(step).join("\n\n"), label: chapter.title, screenshot: step.screenshot })),
    ])];
  let frame = 0;
  const writeFrame = async (delay: number) => {
    onProgress?.(`Rendering GIF frame ${++frame}…`);
    const rgba = ctx.getImageData(0, 0, 960, 720).data;
    const palette = quantize(rgba, 64);
    gif.writeFrame(applyPalette(rgba, palette), 960, 720, { palette, delay, repeat: 0 });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  };
  for (const card of cards) {
    ctx.font = "26px sans-serif";
    // Include headings in the paginated content so unusually long headings never clip.
    const lines = wrapText(`${card.title}\n\n${card.body}`, (line) => ctx.measureText(line).width <= 848);
    for (let start = 0; start < lines.length; start += 13) {
      ctx.fillStyle = "#f3f6fa"; ctx.fillRect(0, 0, 960, 720);
      ctx.fillStyle = "#2563eb"; ctx.fillRect(48, 36, 864, 5);
      ctx.font = "18px sans-serif";
      ctx.fillText(card.label, 56, 82, 848);
      ctx.font = "26px sans-serif"; ctx.fillStyle = "#172238";
      lines.slice(start, start + 13).forEach((line, i) => ctx.fillText(line, 56, 144 + i * 38));
      ctx.font = "16px sans-serif"; ctx.fillStyle = "#516077";
      ctx.fillText(`Tutorial · ${frame + 1}${start + 13 < lines.length ? " · continues" : ""}`, 56, 684);
      const words = lines.slice(start, start + 13).join(" ").split(/\s+/).length;
      await writeFrame(Math.max(4000, words * 350));
    }
    if (card.screenshot) {
      const image = new Image(); image.src = card.screenshot.dataUrl;
      await image.decode();
      ctx.fillStyle = "#f3f6fa"; ctx.fillRect(0, 0, 960, 720);
      ctx.fillStyle = "#172238"; ctx.font = "24px sans-serif";
      ctx.fillText(card.title, 56, 62, 848);
      const size = fitScreenshot(card.screenshot, 848, 540);
      ctx.drawImage(image, (960 - size.width) / 2, 104 + (540 - size.height) / 2, size.width, size.height);
      await writeFrame(6000);
    }
  }
  gif.finish();
  return new Blob([new Uint8Array(gif.bytes())], { type: "image/gif" });
}

