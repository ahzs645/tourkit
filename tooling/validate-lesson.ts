import { z } from "zod";
import { TutorialManifestSchema, TutorialValueSchema, type TutorialManifest } from "../core/schema";
import { evaluateTutorialCheck } from "../core/checks";
import { TutorialAliasStore } from "../core/references";
import { screenshotIsStale, tutorialScreenshotFingerprint } from "../core/screenshot";
import { isTutorialGuideBlock } from "../recording/content-blocks";
import { tutorialManifestToRecordingDraft, tutorialRecordingDraftToManifest } from "../recording/draft";
import { deserializeTutorialRecordingDraft, serializeTutorialRecordingDraft } from "../recording/serialization";
import { tutorialStepScreenshotFingerprint } from "../recording/screenshot-freshness";
import type { TutorialRecordingDraft } from "../recording/types";

export const TutorialLessonHostMetadataSchema = z.strictObject({
  actionIds: z.array(z.string().min(1)),
  fixtureIds: z.array(z.string().min(1)),
  repeatedAnchorIds: z.array(z.string().min(1)).optional(),
  initialSnapshot: z.unknown().optional(),
  /** Exact pre-step snapshots, when available; the validator never guesses action effects. */
  stepSnapshots: z.record(z.string(), z.unknown()).optional(),
  aliases: z.record(z.string(), TutorialValueSchema).optional(),
  evidence: z.strictObject({
    checkedAt: z.string().datetime({ offset: true }),
    /** The fingerprint from a previous report or tutorialLessonFingerprint(manifest). */
    fingerprint: z.string().min(1),
  }).optional(),
});
export type TutorialLessonHostMetadata = z.infer<typeof TutorialLessonHostMetadataSchema>;

export interface TutorialLessonFinding {
  severity: "error" | "warning";
  code: string;
  message: string;
  stepId?: string;
  path?: string;
}

export interface TutorialLessonValidationReport {
  schemaVersion: 1;
  generatedAt: string;
  kind: "manifest" | "draft" | "unknown";
  lessonId?: string;
  title?: string;
  /** A canonical player-manifest change detector; not a security hash. */
  fingerprint?: string;
  playable: boolean;
  status: "passed" | "warnings" | "failed";
  summary: { steps: number; errors: number; warnings: number; outcomesEvaluated: number; screenshotsChecked: number };
  evidence: { status: "not-supplied" | "current" | "stale" | "unverifiable"; checkedAt?: string; maxAgeDays?: number };
  findings: TutorialLessonFinding[];
  scope: string;
}

export interface TutorialLessonValidationOptions {
  now?: Date;
  /** No arbitrary expiry is imposed when omitted; fingerprint/date validity still apply. */
  maxEvidenceAgeDays?: number;
}

const SCOPE = "Static schema and declared host contracts. Supplied snapshots are read without executing actions. This report does not prove live anchors, action argument/effect correctness, Practice/Watch completion, source fidelity, or document appearance.";

/** Includes the complete canonical manifest; property order and absent optional keys are ignored. */
export function tutorialLessonFingerprint(manifest: TutorialManifest): string {
  return tutorialScreenshotFingerprint(TutorialManifestSchema.parse(manifest));
}

function reportErrors(error: unknown, code: string, findings: TutorialLessonFinding[]) {
  if (error instanceof z.ZodError) {
    for (const issue of error.issues) findings.push({ severity: "error", code, message: issue.message, path: issue.path.map(String).join(".") || undefined });
  } else findings.push({ severity: "error", code, message: error instanceof Error ? error.message : String(error) });
}

/** Accepts a canonical manifest, a portable draft JSON/object, or an in-memory recording draft. */
export async function validateTutorialLesson(input: unknown, hostInput: unknown, options: TutorialLessonValidationOptions = {}): Promise<TutorialLessonValidationReport> {
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("Validation requires a valid current date.");
  if (options.maxEvidenceAgeDays !== undefined && (!Number.isFinite(options.maxEvidenceAgeDays) || options.maxEvidenceAgeDays < 0)) throw new Error("maxEvidenceAgeDays must be a nonnegative finite number.");
  const findings: TutorialLessonFinding[] = [];
  let kind: TutorialLessonValidationReport["kind"] = "unknown";
  let draft: TutorialRecordingDraft | undefined;
  let manifest: TutorialManifest | undefined;
  let host: TutorialLessonHostMetadata | undefined;
  let outcomesEvaluated = 0;
  let screenshotsChecked = 0;
  try { host = TutorialLessonHostMetadataSchema.parse(hostInput); }
  catch (error) { reportErrors(error, "host-metadata-invalid", findings); }

  try {
    const parsed: unknown = typeof input === "string" ? JSON.parse(input) : input;
    const record = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
    if (record && (Array.isArray(record.steps) || "createdAt" in record)) {
      kind = "draft";
      const audio = record.audio as { blob?: unknown } | undefined;
      const serialized = audio?.blob instanceof Blob
        ? await serializeTutorialRecordingDraft(parsed as TutorialRecordingDraft)
        : JSON.stringify(parsed);
      draft = await deserializeTutorialRecordingDraft(serialized);
      if (draft.steps.length > 0 && draft.steps.every(isTutorialGuideBlock)) {
        findings.push({ severity: "warning", code: "reading-guide-only", message: "This valid draft contains only reading-guide blocks. It can be exported as a document but has no playable Practice/Watch steps." });
      } else manifest = tutorialRecordingDraftToManifest(draft);
    } else {
      kind = "manifest";
      manifest = TutorialManifestSchema.parse(parsed);
      draft = tutorialManifestToRecordingDraft(manifest, now);
    }
  } catch (error) { reportErrors(error, "lesson-schema-invalid", findings); }

  const fingerprint = manifest ? tutorialLessonFingerprint(manifest) : undefined;
  let evidence: TutorialLessonValidationReport["evidence"] = { status: "not-supplied" };
  if (draft && host) {
    const actions = new Set(host.actionIds);
    const fixtures = new Set(host.fixtureIds);
    const repeated = new Set(host.repeatedAnchorIds ?? []);
    if (!fixtures.has(draft.launch.fixture)) findings.push({ severity: "error", code: "fixture-undeclared", path: "launch.fixture", message: `Fixture ${JSON.stringify(draft.launch.fixture)} is not declared by this host.` });
    let aliases: TutorialAliasStore | undefined;
    try { aliases = new TutorialAliasStore(host.aliases); }
    catch (error) { reportErrors(error, "host-alias-invalid", findings); }

    for (const step of draft.steps) {
      if (step.action && !actions.has(step.action.id)) findings.push({ severity: "error", code: "action-undeclared", stepId: step.id, message: `Action ${JSON.stringify(step.action.id)} is not declared by this host.` });
      for (const prepared of step.prepare ?? []) {
        if (!actions.has(prepared.id)) findings.push({ severity: "error", code: "action-undeclared", stepId: step.id, message: `Prepare action ${JSON.stringify(prepared.id)} is not declared by this host.` });
      }
      const ambiguous = [...new Set([step.anchor, step.target].filter((id): id is string => Boolean(id) && repeated.has(id!)))];
      if (ambiguous.length && !step.context) findings.push({ severity: "warning", code: "anchor-needs-context", stepId: step.id, message: `The host marks ${ambiguous.map((id) => JSON.stringify(id)).join(", ")} as repeated controls. Supply a pre-action view context or verify an unambiguous host anchor policy.` });

      const hasStepSnapshot = Boolean(host.stepSnapshots && Object.prototype.hasOwnProperty.call(host.stepSnapshots, step.id));
      const hasInitialSnapshot = Object.prototype.hasOwnProperty.call(host, "initialSnapshot");
      if (step.check && step.completion !== "continue" && aliases && (hasStepSnapshot || hasInitialSnapshot)) {
        const snapshot = hasStepSnapshot ? host.stepSnapshots![step.id] : host.initialSnapshot;
        // A step begins with its own baseline. Existing items cannot satisfy a
        // positive delta merely because the static validator lacks replay.
        const evaluation = evaluateTutorialCheck(step.check, snapshot, snapshot, aliases);
        outcomesEvaluated += 1;
        if (evaluation.satisfied) findings.push({ severity: "warning", code: "outcome-already-satisfied", stepId: step.id,
          message: hasStepSnapshot ? "This outcome already holds in the supplied pre-step snapshot. Review whether it requires meaningful learner work."
            : "This outcome already holds in the supplied initial fixture. Earlier actions may change it; verify the actual pre-step state before changing the criterion." });
      }

      if (step.screenshot && step.screenshotMode !== "none") {
        screenshotsChecked += 1;
        if (!step.screenshot.provenance?.stepFingerprint) findings.push({ severity: "warning", code: "screenshot-unverified", stepId: step.id, message: "The screenshot has no step fingerprint, so its freshness cannot be established." });
        else {
          const expected = tutorialStepScreenshotFingerprint(draft, step.id);
          // Manifest exports remove tutorialAuthor. Accept the existing capture
          // fingerprints for both historical launch forms, using the same
          // canonical algorithm rather than inventing another freshness rule.
          const publishedExpected = kind === "manifest" && manifest
            ? tutorialStepScreenshotFingerprint({ ...draft, launch: manifest.launch }, step.id) : expected;
          if (screenshotIsStale(step.screenshot, expected) && screenshotIsStale(step.screenshot, publishedExpected)) findings.push({ severity: "warning", code: "screenshot-stale", stepId: step.id, message: "The screenshot fingerprint differs from the current launch, preceding actions, step or instruction. Recapture or review it against this lesson." });
        }
      }
    }
    if (host.evidence) {
      evidence = { status: fingerprint ? "current" : "unverifiable", checkedAt: host.evidence.checkedAt, ...(options.maxEvidenceAgeDays !== undefined ? { maxAgeDays: options.maxEvidenceAgeDays } : {}) };
      if (!fingerprint) findings.push({ severity: "warning", code: "evidence-unverifiable", message: "This input has no valid player manifest to compare with the supplied runtime-evidence fingerprint." });
      else if (host.evidence.fingerprint !== fingerprint) {
        evidence.status = "stale";
        findings.push({ severity: "warning", code: "evidence-manifest-changed", message: "The lesson manifest differs from the supplied evidence fingerprint. Run the host verification again before relying on that evidence." });
      }
      const ageDays = (now.getTime() - Date.parse(host.evidence.checkedAt)) / 86_400_000;
      if (ageDays < 0) {
        evidence.status = "unverifiable";
        findings.push({ severity: "warning", code: "evidence-date-in-future", message: "The supplied evidence date is later than this report's clock; check the evidence timestamp." });
      } else if (options.maxEvidenceAgeDays !== undefined && ageDays > options.maxEvidenceAgeDays) {
        if (evidence.status !== "unverifiable") evidence.status = "stale";
        findings.push({ severity: "warning", code: "evidence-expired", message: `The supplied evidence is ${Math.floor(ageDays)} days old, exceeding the caller's ${options.maxEvidenceAgeDays}-day policy.` });
      }
    }
  }
  const errors = findings.filter((finding) => finding.severity === "error").length;
  const warnings = findings.filter((finding) => finding.severity === "warning").length;
  return {
    schemaVersion: 1, generatedAt: now.toISOString(), kind, lessonId: manifest?.id ?? draft?.id, title: manifest?.title ?? draft?.title,
    fingerprint, playable: Boolean(manifest), status: errors ? "failed" : warnings ? "warnings" : "passed",
    summary: { steps: draft?.steps.length ?? 0, errors, warnings, outcomesEvaluated, screenshotsChecked }, evidence, findings, scope: SCOPE,
  };
}

function markdownCell(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/([`*_\[\](){}|#~])/g, "\\$1").replace(/[\r\n]+/g, " ");
}

export function renderTutorialLessonValidationMarkdown(report: TutorialLessonValidationReport): string {
  const heading = report.title ? markdownCell(report.title) : "Unrecognized lesson";
  const lines = [
    `# Tutorial validation: ${heading}`, "", `Status: **${report.status}** · ${report.summary.errors} errors · ${report.summary.warnings} warnings`, "",
    `Generated: ${report.generatedAt}`, "", `Input: ${report.kind} · ${report.summary.steps} steps · playable: ${report.playable ? "yes" : "no"}`, "",
    `Evidence: ${report.evidence.status}${report.evidence.checkedAt ? ` (checked ${report.evidence.checkedAt})` : ""}`,
    ...(report.fingerprint ? ["", `Manifest fingerprint: \`${report.fingerprint}\``] : []), "", "## Scope", "", report.scope, "", "## Findings", "",
  ];
  if (!report.findings.length) lines.push("No issues were found within the static checks supplied to this run.");
  else {
    lines.push("| Severity | Code | Step or path | Finding |", "| --- | --- | --- | --- |");
    for (const finding of report.findings) lines.push(`| ${finding.severity} | ${markdownCell(finding.code)} | ${markdownCell(finding.stepId ?? finding.path ?? "Lesson")} | ${markdownCell(finding.message)} |`);
  }
  return `${lines.join("\n")}\n`;
}
