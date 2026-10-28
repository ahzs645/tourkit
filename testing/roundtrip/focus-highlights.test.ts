import { describe, expect, it } from "vitest";
import { TutorialFocusHighlightsSchema, TutorialStepSchema } from "../../core/schema";
import { createTutorialRecordingDraft, insertDraftStep, tutorialManifestToRecordingDraft, tutorialRecordingDraftToManifest } from "../../recording/draft";
import { deserializeTutorialRecordingDraft, serializeTutorialRecordingDraft } from "../../recording/serialization";
import { tutorialStepScreenshotFingerprint } from "../../recording/screenshot-freshness";

const highlights = () => TutorialFocusHighlightsSchema.parse([
  { id: "last-contact", target: { kind: "element", anchor: "report.lastContact" } },
  { id: "connections", target: { kind: "area", anchor: "report.window", rect: { x: .23, y: .42, width: .2, height: .17 } }, style: "both", arrowFrom: "right", label: "Connection resources" },
]);
describe("multiple tutorial focus areas", () => {
  it("keeps existing single-anchor steps unchanged", () => {
    const step = TutorialStepSchema.parse({ id: "legacy", anchor: { id: "report.run" }, action: { id: "report.run" }, overlay: { title: "Run", body: "Run the report." } });
    expect(step.highlights).toBeUndefined(); expect(step.anchor?.id).toBe("report.run");
  });
  it("round trips mixed element/relative areas through manifest and portable studio files without changing the action or check", async () => {
    const draft = insertDraftStep(createTutorialRecordingDraft(), null);
    draft.steps[0] = { ...draft.steps[0], anchor: "report.run", target: "report.ok", completion: "continue", highlights: highlights(),
      action: { id: "report.run", match: "subset" }, check: { all: [{ path: "host.report", equals: "ready", mode: "absolute" }] } };
    const manifest = tutorialRecordingDraftToManifest(draft), step = manifest.chapters[0].steps[0];
    expect(step.highlights).toEqual(highlights()); expect(step.target?.id).toBe("report.ok");
    expect(step.action).toEqual(draft.steps[0].action); expect(step.check).toEqual(draft.steps[0].check);
    const portable = await deserializeTutorialRecordingDraft(await serializeTutorialRecordingDraft(tutorialManifestToRecordingDraft(manifest)));
    expect(tutorialRecordingDraftToManifest(portable)).toEqual(manifest);
  });
  it.each([
    [{ id: "bad", target: { kind: "area", anchor: "report", rect: { x: .9, y: 0, width: .2, height: .1 } } }],
    [{ id: "bad", target: { kind: "area", anchor: "report", rect: { x: 0, y: 0, width: 0, height: .1 } } }],
    [{ id: "bad", target: { kind: "element", anchor: "" } }],
    [{ id: "bad", target: { kind: "element", anchor: "report" }, style: "unknown" }],
  ])("rejects invalid focus geometry or references: %j", (item) => {
    expect(TutorialFocusHighlightsSchema.safeParse([item]).success).toBe(false);
  });
  it("rejects duplicate ids and unbounded annotation counts", () => {
    expect(TutorialFocusHighlightsSchema.safeParse([highlights()[0], highlights()[0]]).success).toBe(false);
    expect(TutorialFocusHighlightsSchema.safeParse(Array.from({ length: 33 }, (_, i) => ({ ...highlights()[0], id: `f-${i}` }))).success).toBe(false);
  });
  it("invalidates reviewed images when focus areas or arrow styles change, while an empty list preserves legacy fingerprints", () => {
    const draft = insertDraftStep(createTutorialRecordingDraft(), null), id = draft.steps[0].id;
    const legacy = tutorialStepScreenshotFingerprint(draft, id);
    draft.steps[0].highlights = []; expect(tutorialStepScreenshotFingerprint(draft, id)).toBe(legacy);
    draft.steps[0].highlights = highlights(); const focused = tutorialStepScreenshotFingerprint(draft, id); expect(focused).not.toBe(legacy);
    draft.steps[0].highlights[0].style = "arrow"; expect(tutorialStepScreenshotFingerprint(draft, id)).not.toBe(focused);
  });
});

