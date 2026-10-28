import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseTutorialManifest } from "../core/schema";
import { stampTutorialScreenshot, type TutorialScreenshot } from "../core/screenshot";
import { createTutorialRecordingDraft, insertDraftStep, tutorialManifestToRecordingDraft, tutorialRecordingDraftToManifest } from "../recording/draft";
import { serializeTutorialRecordingDraft } from "../recording/serialization";
import { tutorialStepScreenshotFingerprint } from "../recording/screenshot-freshness";
import { renderTutorialLessonValidationMarkdown, tutorialLessonFingerprint, validateTutorialLesson } from "./validate-lesson.js";

const now = new Date("2026-10-26T20:00:00Z");
const host = { actionIds: ["orders.create", "orders.approve"], fixtureIds: ["empty-orders"] };
const image: TutorialScreenshot = { dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=", width: 1, height: 1, alt: "Order screen" };

function manifest() {
  return parseTutorialManifest({
    schemaVersion: 1, id: "orders-workflow", title: "Order workflow", launch: { fixture: "empty-orders", path: "/training" },
    chapters: [{ id: "orders", title: "Orders", steps: [
      { id: "create", anchor: { id: "order.create" }, action: { id: "orders.create" }, check: { all: [{ path: "orders", count: { min: 1 }, mode: "delta" }] }, overlay: { title: "Create an order", body: "Press Create." } },
      { id: "approve", anchor: { id: "order.approve" }, action: { id: "orders.approve" }, check: { all: [{ path: "order.approved", equals: true }] }, overlay: { title: "Approve the order", body: "Press Approve." } },
    ] }],
  });
}

describe("portable lesson validator", () => {
  it("accepts a valid independent manifest and reports its limited static scope", async () => {
    const report = await validateTutorialLesson(manifest(), host, { now });
    expect(report).toMatchObject({ kind: "manifest", lessonId: "orders-workflow", playable: true, status: "passed", evidence: { status: "not-supplied" }, summary: { steps: 2, errors: 0, warnings: 0 } });
    expect(report.fingerprint).toBe(tutorialLessonFingerprint(manifest()));
    expect(report.scope).toContain("does not prove live anchors");
  });

  it("reports malformed JSON and schema paths instead of throwing or pretending to inspect a lesson", async () => {
    const malformed = await validateTutorialLesson("{", host, { now });
    expect(malformed.status).toBe("failed");
    expect(malformed.findings[0].code).toBe("lesson-schema-invalid");
    const invalid = await validateTutorialLesson({ ...manifest(), launch: { fixture: "", path: "https://example.com" } }, { ...host, guessedActions: true }, { now });
    expect(invalid.findings.some((finding) => finding.code === "host-metadata-invalid")).toBe(true);
    expect(invalid.findings.some((finding) => finding.path === "launch.fixture")).toBe(true);
    expect(invalid.findings.some((finding) => finding.path === "launch.path")).toBe(true);
  });

  it("treats undeclared fixture/action IDs as errors without claiming to check action effects", async () => {
    const report = await validateTutorialLesson(manifest(), { actionIds: ["orders.create"], fixtureIds: [] }, { now });
    expect(report.summary.errors).toBe(2);
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "fixture-undeclared", severity: "error" }),
      expect.objectContaining({ code: "action-undeclared", severity: "error", stepId: "approve" }),
    ]));
  });

  it("reuses outcome semantics, respects delta baselines and identifies the snapshot used", async () => {
    const snapshot = { orders: [{ id: "existing" }], order: { approved: true } };
    const report = await validateTutorialLesson(manifest(), { ...host, initialSnapshot: snapshot }, { now });
    expect(report.summary.outcomesEvaluated).toBe(2);
    expect(report.findings.filter((finding) => finding.code === "outcome-already-satisfied").map((finding) => finding.stepId)).toEqual(["approve"]);
    expect(report.findings[0].message).toContain("initial fixture");
    const exact = await validateTutorialLesson(manifest(), { ...host, initialSnapshot: snapshot, stepSnapshots: { approve: { order: { approved: false } } } }, { now });
    expect(exact.findings.some((finding) => finding.code === "outcome-already-satisfied")).toBe(false);
    const preStep = await validateTutorialLesson(manifest(), { ...host, stepSnapshots: { approve: snapshot } }, { now });
    expect(preStep.findings[0].message).toContain("pre-step snapshot");
  });

  it("warns only for host-declared repeated controls lacking a view context", async () => {
    const lesson = manifest();
    lesson.chapters[0].steps[0].target = { id: "shared.save" };
    lesson.chapters[0].steps[1].context = { label: "Orders", all: [{ path: "host.view", equals: "orders" }] };
    const report = await validateTutorialLesson(lesson, { ...host, repeatedAnchorIds: ["shared.save", "order.approve"] }, { now });
    expect(report.findings.filter((finding) => finding.code === "anchor-needs-context").map((finding) => finding.stepId)).toEqual(["create"]);
    expect(report.summary.errors).toBe(0);
  });

  it("detects screenshots made stale by earlier actions and distinguishes missing provenance", async () => {
    const draft = tutorialManifestToRecordingDraft(manifest(), now);
    draft.steps[1].screenshot = stampTutorialScreenshot(image, { engine: "native", capturedAt: now.toISOString(), stepFingerprint: tutorialStepScreenshotFingerprint(draft, "approve") });
    expect((await validateTutorialLesson(draft, host, { now })).findings).toEqual([]);
    draft.steps[0].action!.args = { vendor: "changed" };
    expect((await validateTutorialLesson(draft, host, { now })).findings).toEqual([expect.objectContaining({ code: "screenshot-stale", stepId: "approve", severity: "warning" })]);
    draft.steps[1].screenshot = image;
    expect((await validateTutorialLesson(draft, host, { now })).findings[0].code).toBe("screenshot-unverified");
    draft.steps[1].screenshotMode = "none";
    expect((await validateTutorialLesson(draft, host, { now })).summary.screenshotsChecked).toBe(0);
  });

  it("preserves both historical authoring-flag forms when checking published screenshots", async () => {
    for (const authoringFlag of [true, false]) {
      const draft = tutorialManifestToRecordingDraft(manifest(), now);
      if (!authoringFlag) delete draft.launch.hash.tutorialAuthor;
      draft.steps[1].screenshot = stampTutorialScreenshot(image, { engine: "dom", capturedAt: now.toISOString(), stepFingerprint: tutorialStepScreenshotFingerprint(draft, "approve") });
      const report = await validateTutorialLesson(tutorialRecordingDraftToManifest(draft), host, { now });
      expect(report.findings.filter((finding) => finding.code === "screenshot-stale")).toEqual([]);
    }
  });

  it("normalizes legacy portable drafts and accepts in-memory audio without losing schema validation", async () => {
    const draft = tutorialManifestToRecordingDraft(manifest(), now);
    draft.audio = { blob: new Blob(["sample audio"], { type: "audio/webm" }), mimeType: "audio/webm", durationMs: 1 };
    expect((await validateTutorialLesson(draft, host, { now })).status).toBe("passed");
    const portable = JSON.parse(await serializeTutorialRecordingDraft(draft));
    delete portable.chapters; portable.chapterId = "orders"; portable.chapterTitle = "Orders";
    expect((await validateTutorialLesson(JSON.stringify(portable), host, { now })).kind).toBe("draft");
    portable.steps[0].atMs = -1;
    expect((await validateTutorialLesson(portable, host, { now })).findings.some((finding) => finding.path === "steps.0.atMs")).toBe(true);
  });

  it("reports guide-only drafts as non-playable warnings, and malformed interactive drafts as errors", async () => {
    const draft = insertDraftStep(createTutorialRecordingDraft({ id: "reading-guide", fixture: "empty-orders", now }), null, now);
    draft.steps[0].contentKind = "note";
    expect(await validateTutorialLesson(draft, host, { now })).toMatchObject({ playable: false, status: "warnings", summary: { errors: 0, warnings: 1 } });
    draft.steps[0].contentKind = "action";
    expect((await validateTutorialLesson(draft, host, { now })).status).toBe("failed");
  });

  it("checks evidence fingerprints and optional age policy without inventing a verification result", async () => {
    const lesson = manifest();
    const evidence = { checkedAt: "2026-10-01T00:00:00Z", fingerprint: tutorialLessonFingerprint(lesson) };
    const current = await validateTutorialLesson(lesson, { ...host, evidence }, { now });
    expect(current.evidence.status).toBe("current");
    const expired = await validateTutorialLesson(lesson, { ...host, evidence }, { now, maxEvidenceAgeDays: 7 });
    expect(expired.findings[0].code).toBe("evidence-expired");
    const changed = await validateTutorialLesson({ ...lesson, title: "Changed lesson" }, { ...host, evidence }, { now });
    expect(changed.evidence.status).toBe("stale");
    expect(changed.findings[0].code).toBe("evidence-manifest-changed");
    const future = await validateTutorialLesson(lesson, { ...host, evidence: { ...evidence, checkedAt: "2027-01-01T00:00:00Z" } }, { now });
    expect(future.evidence.status).toBe("unverifiable");
  });

  it("escapes report markup and keeps warnings separate from errors", async () => {
    const lesson = { ...manifest(), title: "Order | <script>workflow</script>" };
    const report = await validateTutorialLesson(lesson, { ...host, repeatedAnchorIds: ["order.create"] }, { now });
    const markdown = renderTutorialLessonValidationMarkdown(report);
    expect(markdown).toContain("Order \\| &lt;script&gt;workflow&lt;/script&gt;");
    expect(markdown).toContain("0 errors · 1 warnings");
    expect(markdown).toContain("| warning | anchor-needs-context | create |");
  });
});

describe("portable validator CLI", () => {
  it("writes JSON/Markdown reports and uses distinct validation/configuration exit codes", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "tutorial-validator-"));
    const inputPath = path.join(directory, "lesson.json");
    const hostPath = path.join(directory, "host.json");
    const outputPath = path.join(directory, "reports", "lesson.md");
    const cli = fileURLToPath(new URL("./validate-lesson.mjs", import.meta.url));
    const run = (...args: string[]) => {
      const result = spawnSync(process.execPath, [cli, "--input", inputPath, "--host", hostPath, ...args], { encoding: "utf8", timeout: 20_000, maxBuffer: 1_000_000 });
      if (result.error) throw result.error;
      return result;
    };
    try {
      await writeFile(inputPath, JSON.stringify(manifest()));
      await writeFile(hostPath, JSON.stringify({ ...host, actionIds: [] }));
      const failed = run();
      expect(failed.status, failed.stderr).toBe(1);
      expect(failed.stdout, failed.stderr).not.toBe("");
      expect(JSON.parse(failed.stdout).summary.errors).toBe(2);
      await writeFile(hostPath, JSON.stringify({ ...host, repeatedAnchorIds: ["order.create"] }));
      expect(run("--format", "markdown", "--output", outputPath).status).toBe(0);
      expect(await readFile(outputPath, "utf8")).toContain("anchor-needs-context");
      expect(run("--fail-on-warnings").status).toBe(1);
      expect(run("--format", "html").status).toBe(2);
      expect(run("--output", inputPath).status).toBe(2);
      expect(JSON.parse(await readFile(inputPath, "utf8"))).toEqual(manifest());
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
