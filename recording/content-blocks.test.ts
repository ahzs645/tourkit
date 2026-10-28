import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { createTutorialRecordingDraft, insertDraftStep, tutorialRecordingDraftToManifest } from "./draft";
import { deserializeTutorialRecordingDraft, serializeTutorialRecordingDraft } from "./serialization";
import { isTutorialGuideBlock, parseTutorialContentTemplates, serializeTutorialContentTemplates } from "./content-blocks";
import { documentStepTitle, tutorialDocument, tutorialMarkdown } from "../export/document";
import { tutorialHtml } from "../export/html";
import { tutorialWord } from "../export/office";
import type { TutorialScreenshot } from "../core/screenshot";

const image: TutorialScreenshot = {
  dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=",
  width: 1, height: 1, alt: "Final image", caption: "Check this result",
};
function mixedDraft() {
  let draft = insertDraftStep(createTutorialRecordingDraft({ id: "mixed-blocks" }), null);
  draft.steps[0] = { ...draft.steps[0], title: "Open", action: { id: "builder.addField", args: { type: "text" }, match: "subset" } };
  draft = insertDraftStep(draft, draft.steps[0].id);
  draft.steps[1] = { ...draft.steps[1], contentKind: "warning", title: "Review <result>", instruction: "Check A & B.", screenshotMode: "none", pageBreakBefore: true,
    narration: { startMs: 0, endMs: 1000, transcript: "Check the result carefully." } };
  draft = insertDraftStep(draft, draft.steps[1].id);
  draft.steps[2] = { ...draft.steps[2], title: "3 · Continue", action: { id: "workspace.selectTab", args: { tab: "preview" }, match: "subset" }, screenshot: image };
  return draft;
}

describe("optional explanatory blocks", () => {
  it("keeps explanations in the editable guide but intentionally omits them from playback", async () => {
    const draft = mixedDraft();
    const imported = await deserializeTutorialRecordingDraft(await serializeTutorialRecordingDraft(draft));
    expect(imported.steps[1]).toMatchObject({ contentKind: "warning", pageBreakBefore: true, narration: { transcript: "Check the result carefully." } });
    const manifest = tutorialRecordingDraftToManifest(imported);
    expect(manifest.chapters[0].steps.map((step) => step.id)).toEqual([draft.steps[0].id, draft.steps[2].id]);
    expect(draft.steps).toHaveLength(3);
    expect(isTutorialGuideBlock({ contentKind: "tip", action: { id: "x" } })).toBe(false);
    expect(isTutorialGuideBlock({})).toBe(false);
  });

  it("includes Continue explanations in playback without changing their guide styling", () => {
    const draft = mixedDraft();
    draft.steps[1].completion = "continue";
    expect(isTutorialGuideBlock(draft.steps[1])).toBe(false);
    expect(tutorialRecordingDraftToManifest(draft).chapters[0].steps.map((step) => step.id)).toEqual(draft.steps.map((step) => step.id));
    expect(documentStepTitle(tutorialDocument({ draft }).chapters[0].steps[1])).toBe("Warning: Review <result>");
    draft.steps[1].completion = "outcome";
    expect(isTutorialGuideBlock(draft.steps[1])).toBe(true);
  });

  it("still rejects unfinished action steps instead of silently losing authored work", () => {
    const draft = mixedDraft();
    draft.steps[1].contentKind = undefined;
    expect(() => tutorialRecordingDraftToManifest(draft)).toThrow("must define a semantic action");
  });

  it("explains how to export a guide when every block is editorial", () => {
    const draft = insertDraftStep(createTutorialRecordingDraft(), null);
    draft.steps[0].contentKind = "introduction";
    draft.steps[0].screenshotMode = "none";
    expect(() => tutorialRecordingDraftToManifest(draft)).toThrow("Explanations can be exported as a reading guide");
  });

  it("rejects portable narration ranges that run backwards", async () => {
    const draft = mixedDraft();
    draft.steps[1].narration = { startMs: 500, endMs: 300 };
    await expect(deserializeTutorialRecordingDraft(await serializeTutorialRecordingDraft(draft))).rejects.toThrow("Narration end must be after its start");
  });

  it("numbers actions without gaps and styles explanatory content across guide exports", async () => {
    const doc = tutorialDocument({ draft: mixedDraft() });
    const steps = doc.chapters[0].steps;
    expect(steps.map(documentStepTitle)).toEqual(["1. Open", "Warning: Review <result>", "2. Continue"]);
    const html = tutorialHtml(doc);
    expect(html).toContain('class="explanation" data-kind="warning" style="break-before:page"');
    expect(html).toContain("Warning: Review &lt;result&gt;");
    expect(html).toContain("<figcaption>Check this result</figcaption>");
    expect(html).toContain('id="step-3"');
    expect(tutorialMarkdown(doc)).toContain("### 2\\. Continue");
    const archive = await JSZip.loadAsync(await (await tutorialWord(doc)).arrayBuffer());
    const xml = await archive.file("word/document.xml")!.async("text");
    expect(xml).toContain("Warning: Review &lt;result&gt;");
    expect(xml).toContain("w:pageBreakBefore");
    expect(xml).toContain("Check this result");
  });

  it("publishes edited pixels while retaining reversible originals only in editable drafts", async () => {
    const draft = mixedDraft();
    draft.steps[2].screenshot = { ...image, sourceDataUrl: image.dataUrl, sourceWidth: 1, sourceHeight: 1,
      provenance: { engine: "import", capturedAt: "2026-10-02T00:00:00.000Z" } };
    expect(JSON.parse(await serializeTutorialRecordingDraft(draft)).steps[2].screenshot.sourceDataUrl).toBe(image.dataUrl);
    expect(tutorialRecordingDraftToManifest(draft).chapters[0].steps[1].screenshot).toEqual(draft.steps[2].screenshot && {
      ...image, provenance: draft.steps[2].screenshot.provenance });
    expect(tutorialDocument({ draft }).chapters[0].steps[2].screenshot).not.toHaveProperty("sourceDataUrl");
  });
});

describe("portable reusable editorial blocks", () => {
  it("round trips content and pagination without actions or other fixture-specific state", () => {
    const blocks = [{ id: "warning", name: "Review results", contentKind: "warning" as const, title: "Review", instruction: "Check the result.", pageBreakBefore: true }];
    expect(parseTutorialContentTemplates(serializeTutorialContentTemplates(blocks))).toEqual(blocks);
    expect(() => parseTutorialContentTemplates(JSON.stringify([{ ...blocks[0], action: { id: "builder.addField" } }]))).toThrow();
    expect(() => parseTutorialContentTemplates(JSON.stringify([{ ...blocks[0], name: " " }]))).toThrow();
  });
});

