import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import { captureNativeTutorial, parseNativeCaptureArgs, runNativeCaptureCli } from "./capture-native.mjs";

const kit = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url);
test("native CLI exposes explicit application storage and routes", () => {
  const parsed = parseNativeCaptureArgs(["--manifest", "lesson.json", "--database", "team-a", "--store", "lessons", "--base-url", "http://localhost:3000/training/", "--launch-url", "/training/stage.html", "--region-selector", "[data-capture]"]);
  assert.equal(parsed.database, "team-a"); assert.equal(parsed.store, "lessons"); assert.equal(parsed["launch-url"], "/training/stage.html");
  assert.equal(parseNativeCaptureArgs([], { database: "legacy-app" }).database, "legacy-app");
  const defaults = { "base-url": "http://localhost:5000/learn/", margin: "24", viewport: true };
  assert.deepEqual(Object.fromEntries(Object.keys(defaults).map((key) => [key, parseNativeCaptureArgs([], defaults)[key]])), defaults);
  assert.equal(parseNativeCaptureArgs(["--margin", "8"], defaults).margin, "8");
});

test("guide-only blocks retaining auto screenshot mode export without an application stage", { timeout: 30_000 }, async () => {
  const { createTutorialRecordingDraft } = await jiti.import(path.join(kit, "recording/draft.ts"));
  const draft = createTutorialRecordingDraft({ title: "Static notes", fixture: "unused", path: "/unused/" });
  draft.steps = [{ id: "note", atMs: 0, chapterId: draft.chapters[0].id, title: "Read this first", instruction: "A static explanation with no runnable action.", contentKind: "note", screenshotMode: "auto" }];
  const output = await mkdtemp(path.join(tmpdir(), "tutorial-native-static-"));
  const result = await captureNativeTutorial(draft, { out: output });
  assert.equal(result.captures.length, 0);
  assert.match(await readFile(path.join(output, "guide.html"), "utf8"), /A static explanation/);
  assert.equal((await readFile(path.join(output, "guide.pdf"))).subarray(0, 4).toString(), "%PDF");
});

test("portable native capture produces real screenshots and editable documents from the neutral stage", { timeout: 120_000 }, async (t) => {
  const directory = path.resolve(process.env.TUTORIAL_STUDIO_BUILD_DIR ?? ".tmp-tourkit-studio-example");
  await stat(path.join(directory, "stage.html"));
  const prefix = "/nested/studio/";
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const target = path.resolve(directory, url.pathname.slice(prefix.length) || "index.html");
    if (!url.pathname.startsWith(prefix) || !target.startsWith(directory + path.sep)) { response.writeHead(404).end(); return; }
    try {
      const contentType = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" }[path.extname(target)] ?? "application/octet-stream";
      response.writeHead(200, { "Content-Type": contentType }).end(await readFile(target));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const output = process.env.TUTORIAL_NATIVE_ARTIFACT_DIR ? path.resolve(process.env.TUTORIAL_NATIVE_ARTIFACT_DIR) : await mkdtemp(path.join(tmpdir(), "tutorial-native-"));
  await mkdir(output, { recursive: true });
  const { createProjectIntegration, PROJECT_DRAFT_DATABASE } = await jiti.import(path.join(kit, "examples/studio/integration.ts"));
  const { tutorialManifestToRecordingDraft } = await jiti.import(path.join(kit, "recording/draft.ts"));
  const { deserializeTutorialRecordingDraft } = await jiti.import(path.join(kit, "recording/serialization.ts"));
  const { tutorialFilename } = await jiti.import(path.join(kit, "export/document.ts"));
  const draft = tutorialManifestToRecordingDraft(createProjectIntegration(`${origin}${prefix}index.html`).lesson);
  // Authors may omit schema-defaulted fields. The CLI must parse before converting.
  const authored = { ...createProjectIntegration(`${origin}${prefix}index.html`).lesson };
  delete authored.prerequisites;
  const manifestFile = path.join(output, "input.tutorial.json");
  await writeFile(manifestFile, JSON.stringify(authored));
  const result = await runNativeCaptureCli({ args: ["--manifest", manifestFile, "--out", output], defaults: { "base-url": `${origin}${prefix}`, "launch-url": `${prefix}stage.html`, database: PROJECT_DRAFT_DATABASE } });
  assert.equal(result.captures.length, 4);
  assert.ok(result.captures.every((capture) => capture.width === 1920 && capture.height === 1080 && capture.visuallyReviewed === false));
  const restored = await deserializeTutorialRecordingDraft(await readFile(path.join(output, `${tutorialFilename(draft.id)}.tutorial-draft.json`), "utf8"));
  assert.equal(restored.steps.filter((step) => step.screenshot?.provenance?.engine === "native").length, 4);
  for (const file of ["guide.pdf", "guide.docx", "guide.html", "capture-report.json", ...result.captures.map((capture) => capture.filename)]) assert.ok((await stat(path.join(output, file))).size > 100);
  assert.equal((await readFile(path.join(output, "guide.pdf"))).subarray(0, 4).toString(), "%PDF");
  assert.match(await readFile(path.join(output, "guide.html"), "utf8"), /data:image\/png;base64/);
  console.log(`Native capture evidence: ${output}`);
});
