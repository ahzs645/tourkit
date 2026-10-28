import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { extractReviewBundleFromHtml, reviewFeedbackHtml, reviewHandoffUrl } from "./html";
import { isReviewFeedbackFile, readReviewFeedbackFile, reviewChecklistMarkdown, reviewFeedbackZip, reviewWebAnnotations, REVIEW_ANNOTATIONS_FILE } from "./files";
import {
  addReviewItem,
  addReviewReply,
  createReviewBundle,
  deleteReviewItem,
  isReviewBundleLike,
  liveItems,
  mergeReviewBundles,
  parseReviewBundle,
  reviewItemNumbers,
  reviewItemState,
  startNextRound,
  updateReviewItem,
  type ReviewAnchor,
} from "./model";

const fields = [
  { id: "pain", label: "Pain score", type: "number" },
  { id: "mood", label: "Mood", type: "choice", options: ["Good", "Low"] },
];
const anchor = (fieldId: string): ReviewAnchor => ({ attribute: "data-field-id", value: fieldId, fieldId, fieldLabel: fieldId, dx: 4, dy: 6 });

function sample() {
  let bundle = createReviewBundle({ formName: "Intake <check>", target: "mois", shareUrl: "https://example.test/storage/#s=abc&preview=mois", fields, reviewer: { name: "Jordan", role: "RN" } });
  const first = addReviewItem(bundle, { kind: "comment", anchor: anchor("pain"), page: "Vitals", text: "Range should be 0-10 </script>", color: "#dc2626", author: { name: "Jordan" } });
  bundle = first.bundle;
  bundle = addReviewItem(bundle, { kind: "drawing", anchor: anchor("mood"), page: "Mood", text: "", color: "#2563eb", points: [[0, 0], [10, 4], [20, 0]] }).bundle;
  return { bundle, firstId: first.item.id };
}

describe("review feedback model", () => {
  it("numbers items by round and keeps rounds when the next one starts", () => {
    const { bundle } = sample();
    const next = startNextRound(bundle, { name: "Sam" });
    const third = addReviewItem(next, { kind: "sticky", anchor: anchor("pain"), page: "Vitals", text: "Add units", color: "#ca8a04" }).bundle;
    expect(third.rounds.map((round) => [round.number, round.reviewer?.name, Boolean(round.closedAt)])).toEqual([[1, "Jordan", true], [2, "Sam", false]]);
    expect([...reviewItemNumbers(third).values()]).toEqual(["1.1", "1.2", "2.1"]);
  });

  it("flags feedback whose field changed or was removed", () => {
    const { bundle, firstId } = sample();
    const item = bundle.items.find((entry) => entry.id === firstId)!;
    expect(reviewItemState(item, new Map(fields.map((field) => [field.id, field])))).toBe("current");
    expect(reviewItemState(item, new Map([["pain", { ...fields[0], label: "Pain (0-10)" }]]))).toBe("changed");
    expect(reviewItemState(item, new Map())).toBe("removed");
  });

  it("merges a returned copy: newer edits win, replies combine, deletions stick", () => {
    const { bundle, firstId } = sample();
    const author = addReviewReply(bundle, firstId, "Fixed in v2", { name: "Author" });
    const reviewer = updateReviewItem(addReviewReply(bundle, firstId, "Thanks"), firstId, { status: "resolved" });
    const removed = deleteReviewItem(reviewer, bundle.items[1].id);
    const merged = mergeReviewBundles(author, removed);
    const item = merged.items.find((entry) => entry.id === firstId)!;
    expect(item.status).toBe("resolved");
    expect(item.replies.map((reply) => reply.text).sort()).toEqual(["Fixed in v2", "Thanks"]);
    expect(liveItems(merged)).toHaveLength(1);
  });
});

describe("review feedback files", () => {
  it("embeds the bundle in self-contained HTML that reads back exactly", () => {
    const { bundle } = sample();
    const html = reviewFeedbackHtml(bundle);
    // Text from the review cannot end the data block or inject markup.
    expect(html).not.toContain("0-10 </script>");
    expect(html).toContain("Intake &lt;check&gt;");
    expect(html).toContain("Content-Security-Policy");
    expect(extractReviewBundleFromHtml(html)).toEqual(bundle);
  });

  it("adds the handoff flag to the share link without losing its hash", () => {
    const url = new URL(reviewHandoffUrl("https://example.test/storage/#s=abc&preview=mois"));
    const hash = new URLSearchParams(url.hash.slice(1));
    expect([hash.get("s"), hash.get("preview"), hash.get("review")]).toEqual(["abc", "mois", "continue"]);
  });

  it("round-trips through the ZIP and carries W3C annotations beside it", async () => {
    const { bundle, firstId } = sample();
    const withReply = addReviewReply(bundle, firstId, "Agreed");
    const blob = await reviewFeedbackZip(withReply);
    const file = Object.assign(blob, { name: "intake.review-round-1.zip" });
    expect(await readReviewFeedbackFile(file)).toEqual(withReply);
    const zip = await JSZip.loadAsync(blob);
    const annotations = JSON.parse(await zip.file(REVIEW_ANNOTATIONS_FILE)!.async("text"));
    expect(annotations.type).toBe("AnnotationCollection");
    expect(annotations.first.items.map((entry: { motivation: string }) => entry.motivation)).toEqual(["commenting", "replying", "highlighting"]);
    expect(reviewWebAnnotations(withReply).total).toBe(3);
  });

  it("reads an HTML file and rejects files that are not reviews", async () => {
    const { bundle } = sample();
    const html = Object.assign(new Blob([reviewFeedbackHtml(bundle)], { type: "text/html" }), { name: "review.html" });
    expect((await readReviewFeedbackFile(html)).items).toHaveLength(2);
    expect(() => parseReviewBundle({ format: "something-else" })).toThrow(/not a review feedback/);
  });

  it("reads files written under the format's name before the Tourkit rename", async () => {
    const { bundle } = sample();
    const legacy = { ...bundle, format: "webforms-review-feedback" };
    expect(parseReviewBundle(legacy).format).toBe("tourkit-review-feedback");
    expect(isReviewBundleLike(legacy)).toBe(true);
    const html = reviewFeedbackHtml(bundle).replace('id="tourkit-review-feedback"', 'id="webforms-review-feedback"');
    const file = Object.assign(new Blob([html], { type: "text/html" }), { name: "old-review.html" });
    expect(await isReviewFeedbackFile(file)).toBe(true);
    expect((await readReviewFeedbackFile(file)).items).toHaveLength(2);
  });
});

describe("review subjects", () => {
  it("reads files written before kinds existed as form reviews", () => {
    const { bundle } = sample();
    const { kind: _kind, ...legacyForm } = bundle.form;
    expect(parseReviewBundle({ ...bundle, form: legacyForm }).form.kind).toBe("form");
  });

  it("keeps a tutorial review's subject and anchors to tutorial controls", () => {
    let bundle = createReviewBundle({ kind: "tutorial", subjectId: "interface-vocabulary", formName: "Interface vocabulary", target: "practice", shareUrl: null,
      fields: [{ id: "intro", label: "Welcome", type: "tutorial-step", options: ["Welcome", "Start here"] }] });
    bundle = addReviewItem(bundle, { kind: "comment", page: "Step 1 · Welcome", text: "Too long", color: "#dc2626",
      anchor: { attribute: "data-tutorial-step", value: "intro", fieldId: "intro", fieldLabel: "The step card", dx: 1, dy: 2 } }).bundle;
    const parsed = parseReviewBundle(JSON.parse(JSON.stringify(bundle)));
    expect(parsed.form).toMatchObject({ kind: "tutorial", id: "interface-vocabulary" });
    expect(reviewItemState(parsed.items[0], new Map([["intro", { id: "intro", label: "Welcome", type: "tutorial-step", options: ["Welcome", "Start here, then open the menu"] }]]))).toBe("changed");
  });

  it("accepts a picture only when it is confirmed free of patient details", () => {
    const { bundle, firstId } = sample();
    const picture = { id: "p1", name: "real.png", image: "data:image/jpeg;base64,AAAA", width: 2, height: 2 };
    const withPicture = updateReviewItem(bundle, firstId, { attachments: [{ ...picture, noPatientData: true }] });
    expect(parseReviewBundle(withPicture).items[0].attachments).toHaveLength(1);
    const unconfirmed = JSON.parse(JSON.stringify(withPicture));
    unconfirmed.items[0].attachments[0].noPatientData = false;
    expect(() => parseReviewBundle(unconfirmed)).toThrow();
  });

  it("writes a checklist: one box per item by page, resolved ones ticked", () => {
    const { bundle, firstId } = sample();
    const markdown = reviewChecklistMarkdown(updateReviewItem(bundle, firstId, { status: "resolved" }));
    expect(markdown).toContain("## Vitals");
    expect(markdown).toContain("- [x] **1.1 pain**: Range should be 0-10 </script> (Jordan, round 1)");
    expect(markdown).toContain("- [ ] **1.2 mood**: (a drawing)");
  });
});

