#!/usr/bin/env node
/** Portable, read-only validation. No application catalogs or runtime actions are loaded. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createJiti } from "jiti";

const usage = `Usage: node tooling/validate-lesson.mjs --input lesson.json --host host.json [options]

  --format json|markdown          Report format (default: json)
  --output report.json            Save the report instead of writing stdout
  --max-evidence-age-days N       Optional evidence age policy
  --fail-on-warnings              Exit 1 for warnings as well as errors
  --help                         Show this help

The host JSON declares actionIds and fixtureIds, with optional
repeatedAnchorIds, initialSnapshot, stepSnapshots, aliases and evidence
{ checkedAt, fingerprint }. Inputs can be player manifests or portable drafts.
Exit codes: 0 = no errors (warnings allowed), 1 = failed validation,
2 = invalid CLI/configuration or unreadable input. No actions are executed.
`;

try {
  const { values } = parseArgs({ options: {
    input: { type: "string" }, host: { type: "string" }, output: { type: "string" }, format: { type: "string", default: "json" },
    "max-evidence-age-days": { type: "string" }, "fail-on-warnings": { type: "boolean", default: false }, help: { type: "boolean", default: false },
  } });
  if (values.help) process.stdout.write(usage);
  else {
    if (!values.input || !values.host) throw new Error("Both --input and --host are required. Use --help for the format.");
    if (values.format !== "json" && values.format !== "markdown") throw new Error("--format must be json or markdown.");
    const maxEvidenceAgeDays = values["max-evidence-age-days"] === undefined ? undefined : Number(values["max-evidence-age-days"]);
    if (maxEvidenceAgeDays !== undefined && (!Number.isFinite(maxEvidenceAgeDays) || maxEvidenceAgeDays < 0 || !values["max-evidence-age-days"].trim())) throw new Error("--max-evidence-age-days must be a nonnegative finite number.");
    const [lessonText, hostText] = await Promise.all([readFile(path.resolve(values.input), "utf8"), readFile(path.resolve(values.host), "utf8")]);
    const host = JSON.parse(hostText);
    // Load this exact local implementation with the kit's declared TS loader.
    // There are no host aliases, generated application sources or cache writes.
    const jiti = createJiti(import.meta.url, { fsCache: false });
    const { validateTutorialLesson, renderTutorialLessonValidationMarkdown } = await jiti.import(fileURLToPath(new URL("./validate-lesson.ts", import.meta.url)));
    const report = await validateTutorialLesson(lessonText, host, { maxEvidenceAgeDays });
    const output = values.format === "markdown" ? renderTutorialLessonValidationMarkdown(report) : `${JSON.stringify(report, null, 2)}\n`;
    if (values.output) {
      const destination = path.resolve(values.output);
      if ([path.resolve(values.input), path.resolve(values.host)].includes(destination)) throw new Error("--output must differ from the lesson and host input files.");
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, output);
    } else process.stdout.write(output);
    if (report.summary.errors > 0 || (values["fail-on-warnings"] && report.summary.warnings > 0)) process.exitCode = 1;
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}
