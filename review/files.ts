import JSZip from "jszip";

import { REVIEW_HTML_DATA_IDS, extractReviewBundleFromHtml, reviewFeedbackHtml } from "./html";
import {
  isReviewBundleLike,
  orderedReviewItems,
  parseReviewBundle,
  personLabel,
  reviewItemNumbers,
  reviewSubjectTitle,
  type ReviewFeedbackBundle,
  type ReviewItem,
  type ReviewSnapshot,
} from "./model";

/**
 * Review feedback as files. The ZIP and the HTML both carry the whole bundle
 * and open again anywhere; the PDF is for reading and printing only.
 */

export const REVIEW_BUNDLE_FILE = "feedback.json";
export const REVIEW_ANNOTATIONS_FILE = "annotations.jsonld";

export function reviewFileBaseName(bundle: ReviewFeedbackBundle): string {
  const slug = (bundle.form.name || "form").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "form";
  return `${slug}.review-round-${bundle.rounds[bundle.rounds.length - 1].number}`;
}

/**
 * The review as a W3C Web Annotation collection (JSON-LD): each item and
 * reply an Annotation whose target names the field by a FragmentSelector, so
 * other annotation tools can read it. One-way; the bundle is what imports.
 */
export function reviewWebAnnotations(bundle: ReviewFeedbackBundle): Record<string, unknown> {
  const source = `urn:tourkit:form:${encodeURIComponent(bundle.form.name)}#${bundle.form.target}`;
  const creator = (person?: { name?: string; role?: string }) => (person?.name || person?.role ? { type: "Person", name: personLabel(person) } : undefined);
  const annotations = orderedReviewItems(bundle).flatMap((item) => {
    const id = `urn:tourkit:review:${item.id}`;
    const selector = item.anchor.fieldId
      ? { type: "FragmentSelector", value: `field=${item.anchor.fieldId}`, refinedBy: { type: "FragmentSelector", conformsTo: "http://www.w3.org/TR/media-frags/", value: `xywh=${Math.round(item.anchor.dx)},${Math.round(item.anchor.dy)},1,1` } }
      : { type: "FragmentSelector", conformsTo: "http://www.w3.org/TR/media-frags/", value: `xywh=${Math.round(item.anchor.dx)},${Math.round(item.anchor.dy)},1,1` };
    const main = {
      id,
      type: "Annotation",
      motivation: item.kind === "drawing" ? "highlighting" : "commenting",
      created: item.createdAt,
      modified: item.updatedAt,
      ...(creator(item.author) ? { creator: creator(item.author) } : {}),
      ...(item.text ? { body: { type: "TextualBody", value: item.text, format: "text/plain", purpose: "commenting" } } : {}),
      target: { source, selector, ...(item.anchor.fieldLabel ? { scope: item.anchor.fieldLabel } : {}) },
      "tourkit:round": item.round,
      "tourkit:page": item.page,
      "tourkit:status": item.status,
    };
    const replies = item.replies.map((reply) => ({
      id: `urn:tourkit:review:${reply.id}`,
      type: "Annotation",
      motivation: "replying",
      created: reply.createdAt,
      ...(creator(reply.author) ? { creator: creator(reply.author) } : {}),
      body: { type: "TextualBody", value: reply.text, format: "text/plain" },
      target: id,
    }));
    return [main, ...replies];
  });
  return {
    "@context": ["http://www.w3.org/ns/anno.jsonld", { tourkit: "urn:tourkit:review#" }],
    id: `urn:tourkit:review-collection:${encodeURIComponent(bundle.form.name)}`,
    type: "AnnotationCollection",
    label: `Review feedback: ${bundle.form.name}`,
    total: annotations.length,
    first: { type: "AnnotationPage", items: annotations },
  };
}

function dataUrlBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

const snapshotFileName = (snapshot: ReviewSnapshot, index: number) =>
  `snapshots/round-${snapshot.round}-${String(index + 1).padStart(2, "0")}-${snapshot.page.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "page"}.jpg`;

export async function reviewFeedbackZip(bundle: ReviewFeedbackBundle): Promise<Blob> {
  const zip = new JSZip();
  zip.file(REVIEW_BUNDLE_FILE, JSON.stringify(bundle, null, 2));
  zip.file(REVIEW_ANNOTATIONS_FILE, JSON.stringify(reviewWebAnnotations(bundle), null, 2));
  zip.file("feedback.html", reviewFeedbackHtml(bundle));
  bundle.snapshots.forEach((snapshot, index) => zip.file(snapshotFileName(snapshot, index), dataUrlBytes(snapshot.image)));
  for (const item of orderedReviewItems(bundle)) {
    item.attachments.forEach((attachment, index) => zip.file(`pictures/${item.id}-${index + 1}.jpg`, dataUrlBytes(attachment.image)));
  }
  zip.file("README.md", [
    `# Review feedback: ${bundle.form.name}`,
    "",
    "- `feedback.json` is the review. Open this ZIP (or that file) in the review tools to see the comments or continue reviewing.",
    "- `feedback.html` is the same review as a page you can open in any browser.",
    "- `annotations.jsonld` is the review as W3C Web Annotations, for other tools.",
    "- `snapshots/` are the pages as they looked when the feedback was given; `pictures/` are pictures reviewers added (each confirmed suitable for sharing).",
    "",
  ].join("\n"));
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}

/**
 * The review as a Markdown checklist to work through (or paste into an issue
 * tracker): one box per item, by page, resolved items ticked.
 */
export function reviewChecklistMarkdown(bundle: ReviewFeedbackBundle): string {
  const items = orderedReviewItems(bundle);
  const numbers = reviewItemNumbers(bundle);
  const open = items.filter((item) => item.status === "open").length;
  const lines = [
    `# Review checklist: ${bundle.form.name}`,
    "",
    `${reviewSubjectTitle(bundle.form.kind)} · ${open} open of ${items.length} · ${bundle.rounds.map((round) => `round ${round.number}: ${personLabel(round.reviewer)}`).join(" · ")}`,
  ];
  const pages = new Map<string, ReviewItem[]>();
  for (const item of items) pages.set(item.page, [...(pages.get(item.page) ?? []), item]);
  for (const [page, entries] of pages) {
    lines.push("", `## ${page}`, "");
    for (const item of entries) {
      const text = item.text.trim().replace(/\s*\n\s*/g, " ") || (item.kind === "drawing" ? "(a drawing)" : "(no text)");
      lines.push(`- [${item.status === "resolved" ? "x" : " "}] **${numbers.get(item.id)} ${item.anchor.fieldLabel || item.kind}**: ${text} (${personLabel(item.author)}, round ${item.round})`);
      for (const reply of item.replies) lines.push(`  - ${personLabel(reply.author)}: ${reply.text.trim().replace(/\s*\n\s*/g, " ")}`);
      if (item.attachments.length) lines.push(`  - ${item.attachments.length} picture${item.attachments.length === 1 ? "" : "s"} (in the review ZIP's pictures/)`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export function reviewFeedbackHtmlBlob(bundle: ReviewFeedbackBundle): Blob {
  return new Blob([reviewFeedbackHtml(bundle)], { type: "text/html;charset=utf-8" });
}

/** Read a returned review from a dropped or picked file (.html, .zip or .json). */
export async function readReviewFeedbackFile(file: Blob & { name?: string }): Promise<ReviewFeedbackBundle> {
  const name = (file.name ?? "").toLowerCase();
  if (name.endsWith(".zip")) {
    const zip = await JSZip.loadAsync(file);
    const entry = zip.file(REVIEW_BUNDLE_FILE) ?? zip.file(/(^|\/)feedback\.json$/)[0];
    if (!entry) throw new Error("This ZIP has no feedback.json.");
    return parseReviewBundle(JSON.parse(await entry.async("text")));
  }
  const text = await file.text();
  if (name.endsWith(".html") || name.endsWith(".htm") || /^\s*<!doctype html/i.test(text)) {
    const bundle = extractReviewBundleFromHtml(text);
    if (!bundle) throw new Error("This page is not a review feedback file.");
    return bundle;
  }
  return parseReviewBundle(JSON.parse(text));
}

/** Whether a file looks like review feedback, cheaply, for drop routers. */
export async function isReviewFeedbackFile(file: Blob & { name?: string }): Promise<boolean> {
  const name = (file.name ?? "").toLowerCase();
  try {
    if (name.endsWith(".zip")) {
      const zip = await JSZip.loadAsync(file);
      return Boolean(zip.file(REVIEW_BUNDLE_FILE)) && !zip.file("workspace.json");
    }
    if (name.endsWith(".html") || name.endsWith(".htm")) {
      const text = await file.text();
      return REVIEW_HTML_DATA_IDS.some((id) => text.includes(`id="${id}"`));
    }
    if (name.endsWith(".json")) return isReviewBundleLike(JSON.parse(await file.text()));
  } catch {
    return false;
  }
  return false;
}

// ---------------------------------------------------------------------------
// PDF (browser only): each page with its marks drawn on, then every item.
// ---------------------------------------------------------------------------

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("A page snapshot could not be read."));
    image.src = src;
  });
}

function strokePath(context: CanvasRenderingContext2D, points: ReadonlyArray<readonly [number, number]>, x: number, y: number) {
  context.beginPath();
  context.moveTo(x + points[0][0], y + points[0][1]);
  for (let index = 1; index < points.length; index += 1) {
    const [px, py] = points[index - 1];
    const [qx, qy] = points[index];
    context.quadraticCurveTo(x + px, y + py, x + (px + qx) / 2, y + (py + qy) / 2);
  }
  context.stroke();
}

/** Word-wrapped lines that fit `width`, at most `max` (the last one ellipsised). */
function wrapLines(context: CanvasRenderingContext2D, text: string, width: number, max: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (context.measureText(next).width <= width || !line) { line = next; continue; }
    lines.push(line);
    line = word;
  }
  if (line) lines.push(line);
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  kept[max - 1] = `${kept[max - 1].replace(/\s*\S*$/, "")}…`;
  return kept;
}

/** A snapshot with its items' pins, notes and drawings painted on. */
export async function markedReviewSnapshot(snapshot: ReviewSnapshot, items: readonly ReviewItem[], numbers: ReadonlyMap<string, string>): Promise<string> {
  const image = await loadImage(snapshot.image);
  const canvas = document.createElement("canvas");
  canvas.width = snapshot.width;
  canvas.height = snapshot.height;
  const context = canvas.getContext("2d")!;
  context.drawImage(image, 0, 0, snapshot.width, snapshot.height);
  for (const item of items) {
    const origin = snapshot.placements[item.id];
    if (!origin) continue;
    const x = origin[0] + item.anchor.dx;
    const y = origin[1] + item.anchor.dy;
    const label = numbers.get(item.id) ?? "";
    if (item.kind === "drawing" && item.points?.length) {
      context.strokeStyle = item.color;
      context.lineWidth = 3;
      context.lineCap = "round";
      context.lineJoin = "round";
      strokePath(context, item.points, x, y);
    }
    if (item.kind === "sticky") {
      context.fillStyle = "#fde68a";
      context.strokeStyle = "#ca8a04";
      context.fillRect(x, y, 160, 72);
      context.strokeRect(x, y, 160, 72);
      context.fillStyle = "#422006";
      context.font = "11px sans-serif";
      wrapLines(context, `${label} ${item.text}`, 148, 4).forEach((line, index) => context.fillText(line, x + 6, y + 15 + index * 14));
      continue;
    }
    context.fillStyle = item.color;
    context.beginPath();
    context.arc(x, y, 11, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = "#fff";
    context.lineWidth = 2;
    context.stroke();
    context.fillStyle = "#fff";
    context.font = "bold 10px sans-serif";
    context.textAlign = "center";
    context.fillText(label, x, y + 4);
    context.textAlign = "start";
  }
  return canvas.toDataURL("image/jpeg", 0.88);
}

export async function reviewFeedbackPdf(bundle: ReviewFeedbackBundle): Promise<Blob> {
  const [{ default: pdfMake }, { default: fonts }] = await Promise.all([
    import("pdfmake/build/pdfmake"),
    import("pdfmake/build/vfs_fonts"),
  ]);
  pdfMake.addVirtualFileSystem(fonts);
  const items = orderedReviewItems(bundle);
  const numbers = reviewItemNumbers(bundle);
  const contentWidth = 595.28 - 72;
  const pages = [];
  for (const snapshot of bundle.snapshots.slice().sort((a, b) => a.round - b.round)) {
    const marked = await markedReviewSnapshot(snapshot, items, numbers);
    const scale = Math.min(contentWidth / snapshot.width, 620 / snapshot.height, 1);
    pages.push(
      { text: `${snapshot.page} · round ${snapshot.round}`, style: "page", margin: [0, 12, 0, 6] },
      { image: marked, width: snapshot.width * scale, height: snapshot.height * scale },
    );
  }
  const list = items.map((item) => ({
    stack: [
      { text: [{ text: `${numbers.get(item.id)}  `, bold: true, color: item.color }, { text: item.anchor.fieldLabel || item.page, bold: true }, { text: `   ${item.kind} · ${item.status}`, color: "#64748b" }] },
      { text: `${item.page} · ${personLabel(item.author)} · ${new Date(item.createdAt).toLocaleString()}`, color: "#64748b", fontSize: 9 },
      ...(item.text ? [{ text: item.text, margin: [0, 3, 0, 0] }] : []),
      ...item.attachments.map((attachment) => ({ image: attachment.image, fit: [contentWidth, 260], margin: [0, 4, 0, 0] })),
      ...item.replies.map((reply) => ({ text: [{ text: `${personLabel(reply.author)} (round ${reply.round}): `, bold: true }, reply.text], margin: [12, 3, 0, 0], fontSize: 10 })),
    ],
    margin: [0, 0, 0, 10],
    unbreakable: true,
  }));
  const definition = {
    pageMargins: [36, 36, 36, 36],
    content: [
      { text: `Review feedback: ${bundle.form.name}`, style: "title" },
      { text: bundle.rounds.map((round) => `Round ${round.number}: ${personLabel(round.reviewer)}`).join(" · "), color: "#64748b", margin: [0, 2, 0, 8] },
      ...pages,
      { text: "All feedback", style: "page", margin: [0, 16, 0, 8], ...(pages.length ? { pageBreak: "before" } : {}) },
      ...(list.length ? list : [{ text: "No feedback yet.", color: "#64748b" }]),
    ],
    styles: { title: { fontSize: 18, bold: true }, page: { fontSize: 13, bold: true } },
    defaultStyle: { fontSize: 11 },
  };
  // pdfmake's content types are wider than this literal's inferred shape.
  const buffer = await pdfMake.createPdf(definition as never).getBuffer();
  return new Blob([new Uint8Array(buffer)], { type: "application/pdf" });
}

export function downloadReviewBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  // A running tutorial blocks clicks outside its own surfaces; this one is ours.
  anchor.setAttribute("data-tutorial-surface", "");
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

