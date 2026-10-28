// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { createReviewInboxStore } from "./inbox-store";
import { createReviewStorage, type ReviewKeyValueStorage } from "./review-storage";
import { addReviewItem, createReviewBundle, parseReviewBundle, updateReviewItem } from "./model";
import { extractReviewBundleFromHtml, reviewFeedbackHtml, reviewHandoffUrl, reviewStartUrl } from "./html";
import { tutorialReviewSurface } from "./surfaces";
import { createTutorialReviewStepStore } from "./tutorial-step-store";
import { reviewChecklistMarkdown } from "./files";

function memoryStorage(): ReviewKeyValueStorage {
  const entries = new Map<string, string>();
  return { getItem: (key) => entries.get(key) ?? null, setItem: (key, value) => { entries.set(key, value); }, removeItem: (key) => { entries.delete(key); } };
}
const subject = { kind: "document", subjectId: "proposal-7", name: "Project proposal", target: "preview" };
const sample = () => createReviewBundle({ kind: subject.kind, subjectId: subject.subjectId, formName: subject.name, target: subject.target, shareUrl: null, fields: [{ id: "summary", type: "paragraph", label: "Summary" }] });

function commented() {
  return addReviewItem(sample(), { kind: "comment", page: "Overview", text: "Define the expected outcome.", color: "#2563eb", anchor: { attribute: "data-block-id", value: "summary", fieldId: "summary", fieldLabel: "Summary", dx: 2, dy: 3 } });
}

describe("review storage adapters", () => {
  it("isolates identities and in-progress reviews by namespace and subject", () => {
    const storage = memoryStorage();
    const a = createReviewStorage({ namespace: "app:a/user-1", storage });
    const b = createReviewStorage({ namespace: "app:b/user-1", storage });
    a.storePerson({ name: "Reviewer A" });
    a.storeReview(a.reviewKey(subject), sample());
    expect(a.readStoredReview(a.reviewKey(subject))?.form.id).toBe("proposal-7");
    expect(b.readStoredPerson().name).toBeUndefined();
    expect(b.readStoredReview(b.reviewKey(subject))).toBeNull();
    expect(a.reviewKey({ ...subject, subjectId: "proposal:7" })).not.toBe(a.reviewKey(subject));
    expect(a.reviewKey({ ...subject, subjectId: "x:y", target: "z" })).not.toBe(a.reviewKey({ ...subject, subjectId: "x", target: "y:z" }));
  });

  it("keeps a host's existing keys readable through explicit adapters", () => {
    const storage = memoryStorage();
    storage.setItem("app-review-me", JSON.stringify({ name: "Existing reviewer", role: "RN" }));
    const saved = sample();
    storage.setItem("app-review:document:proposal-7:preview", JSON.stringify(saved));
    const legacy = createReviewStorage({ storage, personKey: "app-review-me", reviewKey: (value) => `app-review:${value.kind}:${value.subjectId ?? value.name}:${value.target}` });
    expect(legacy.readStoredPerson()).toEqual({ name: "Existing reviewer", role: "RN" });
    expect(legacy.readStoredReview(legacy.reviewKey(subject))).toEqual(saved);
  });

  it("preserves comments if snapshot persistence exceeds quota", () => {
    const storage = memoryStorage();
    const write = storage.setItem;
    storage.setItem = (key, value) => { if (JSON.parse(value).snapshots?.length) throw new Error("quota"); write(key, value); };
    const adapter = createReviewStorage({ storage });
    const { bundle } = commented();
    const withPicture = { ...bundle, snapshots: [{ page: "Overview", round: 1, image: "data:image/jpeg;base64,AA==", width: 1, height: 1, capturedAt: "2026-01-01", placements: {} }] };
    adapter.storeReview(adapter.reviewKey(subject), withPicture);
    expect(adapter.readStoredReview(adapter.reviewKey(subject))).toMatchObject({ items: bundle.items, snapshots: [] });
  });

  it("tolerates blocked storage and malformed saved identities", () => {
    const blocked = createReviewStorage({ storage: () => { throw new Error("blocked"); } });
    expect(blocked.readStoredPerson()).toEqual({});
    expect(() => blocked.storeReview("review", sample())).not.toThrow();
    const storage = memoryStorage();
    storage.setItem("person", "null");
    expect(createReviewStorage({ storage, personKey: "person" }).readStoredPerson()).toEqual({ name: undefined, role: undefined });
  });
});

describe("scoped review inboxes", () => {
  it("publishes local edits and restores persisted reviews without sharing another inbox", () => {
    const storage = memoryStorage();
    const a = createReviewInboxStore({ namespace: "alpha", kinds: ["document"], storage });
    const b = createReviewInboxStore({ namespace: "beta", kinds: ["document"], storage });
    const listener = vi.fn();
    const unsubscribe = a.subscribe(listener);
    a.import(sample(), { open: ["document"] });
    expect(listener).toHaveBeenCalled();
    expect(a.getSnapshot().open).toEqual(["document"]);
    expect(b.getSnapshot().bundles.document).toBeUndefined();
    const restored = createReviewInboxStore({ namespace: "alpha", kinds: ["document"], storage });
    expect(restored.getSnapshot().bundles.document?.form.id).toBe("proposal-7");
    a.set("document", null);
    expect(createReviewInboxStore({ namespace: "alpha", kinds: ["document"], storage }).getSnapshot().bundles.document).toBeUndefined();
    unsubscribe();
  });

  it("merges copies of one subject and replaces another without losing replies", () => {
    const store = createReviewInboxStore({ storage: null });
    const { bundle, item } = commented();
    store.import(bundle);
    store.import(updateReviewItem(bundle, item.id, { status: "resolved" }));
    expect(store.getSnapshot().bundles.document?.items).toHaveLength(1);
    expect(store.getSnapshot().bundles.document?.items[0].status).toBe("resolved");
    store.import({ ...sample(), form: { ...sample().form, id: "proposal-8" } });
    expect(store.getSnapshot().bundles.document?.items).toEqual([]);
    expect(() => store.set("tutorial", sample())).toThrow(/different subject kind/);
  });

  it("loads named legacy inbox keys, rejecting mismatched stored subjects", () => {
    const storage = memoryStorage();
    const bundle = { ...sample(), form: { ...sample().form, kind: "form" } };
    storage.setItem("wf-builder-review", JSON.stringify(bundle));
    const store = createReviewInboxStore({ kinds: ["form"], storage, storageKey: (kind) => kind === "form" ? "wf-builder-review" : `wf-review-inbox:${kind}` });
    expect(store.getSnapshot().bundles.form).toEqual(bundle);
    storage.setItem("bad:tutorial", JSON.stringify(sample()));
    expect(createReviewInboxStore({ kinds: ["tutorial"], storage, storageKey: (kind) => `bad:${kind}` }).getSnapshot().bundles.tutorial).toBeUndefined();
  });

  it("refreshes matching external storage changes and removes its listener on unsubscribe", () => {
    const storage = memoryStorage();
    const store = createReviewInboxStore({ namespace: "browser", kinds: ["document"], storage });
    const changed = vi.fn();
    const stop = store.subscribe(changed);
    storage.setItem("browser:inbox:document", JSON.stringify(sample()));
    window.dispatchEvent(new StorageEvent("storage", { key: "other:inbox:document" }));
    expect(store.getSnapshot().bundles.document).toBeUndefined();
    window.dispatchEvent(new StorageEvent("storage", { key: "browser:inbox:document" }));
    expect(store.getSnapshot().bundles.document?.form.id).toBe("proposal-7");
    expect(changed).toHaveBeenCalledTimes(1);
    stop();
    storage.removeItem("browser:inbox:document");
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(changed).toHaveBeenCalledTimes(1);
  });
});

describe("review surface and file contracts", () => {
  it("round-trips a nonmedical subject, preserving the v1 identifiers", () => {
    const { bundle } = commented();
    expect(parseReviewBundle(bundle)).toEqual(bundle);
    const html = reviewFeedbackHtml(bundle);
    expect(extractReviewBundleFromHtml(html)).toEqual(bundle);
    expect(html).toContain('id="tourkit-review-feedback"');
    expect(reviewChecklistMarkdown(bundle)).toContain("Document · 1 open");
    expect(html).not.toContain("Webforms builder");
  });

  it("does not export executable review URLs and pins handoff messages to the destination origin", () => {
    expect(() => reviewStartUrl("javascript:alert(1)")).toThrow(/HTTP/);
    expect(() => reviewHandoffUrl("data:text/html,hi")).toThrow(/HTTP/);
    expect(reviewFeedbackHtml({ ...sample(), form: { ...sample().form, shareUrl: "javascript:alert(1)" } })).not.toContain('id="continue"');
    const html = reviewFeedbackHtml({ ...sample(), form: { ...sample().form, shareUrl: "https://example.test/review" } });
    expect(html).toContain("e.origin===origin");
    expect(html).toContain("bundle:b},origin)");
  });

  it("keeps feedback on its lesson step and permits host label policies", () => {
    const surface = tutorialReviewSurface({ tutorialId: "onboard", title: "Onboarding", mode: "practice", stepIndex: 1, shareUrl: null,
      steps: [{ id: "first", title: "Open", body: "Open it" }, { id: "second", title: "Save", body: "Save it" }], labelAnchor: () => "Host save command" });
    const element = document.createElement("button");
    expect(surface.place({ attribute: "data-tutorial-id", value: "save", element })).toEqual({ partId: "second", label: "Host save command", page: "Step 2 · Save" });
    const { item } = commented();
    expect(surface.showsItem?.({ ...item, anchor: { ...item.anchor, fieldId: "first" } })).toBe(false);
    expect(surface.showsItem?.({ ...item, anchor: { ...item.anchor, fieldId: "second" } })).toBe(true);
  });

  it("isolates player step channels and allows deterministic resets", () => {
    const a = createTutorialReviewStepStore();
    const b = createTutorialReviewStepStore();
    const changed = vi.fn();
    a.subscribe(changed);
    a.reportStep(null, 3);
    expect([a.getSnapshot(), b.getSnapshot()]).toEqual([3, 0]);
    a.reportStep(null, 3);
    a.reportStep(null, -1);
    expect(changed).toHaveBeenCalledTimes(1);
    a.reset();
    expect(a.getSnapshot()).toBe(0);
    expect(changed).toHaveBeenCalledTimes(2);
  });
});
