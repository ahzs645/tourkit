/** Native tutorial screenshots. Uses the application's semantic replay and Chromium's actual pixels.
 * node tooling/capture-native.mjs --manifest lesson.tutorial.json --base-url http://localhost:3000 --channel chrome
 * node tooling/capture-native.mjs --draft /path/to/lesson.tutorial-draft.json --out output/my-lesson
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";
import { createJiti } from "jiti";
import { buildNativeCaptureAnchorScript, buildNativeCaptureBoundsScript } from "./native-capture-helper.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url);
const { tutorialManifestToRecordingDraft, tutorialRecordingDraftToManifest } = await jiti.import(path.join(root, "recording/draft.ts"));
const { deserializeTutorialRecordingDraft, serializeTutorialRecordingDraft } = await jiti.import(path.join(root, "recording/serialization.ts"));
const { TutorialScreenshotSchema } = await jiti.import(path.join(root, "core/screenshot.ts"));
const { tutorialScreenshotReplaySteps } = await jiti.import(path.join(root, "recording/screenshot-replay.ts"));
const { isTutorialGuideBlock } = await jiti.import(path.join(root, "recording/content-blocks.ts"));
const { tutorialStepScreenshotFingerprint } = await jiti.import(path.join(root, "recording/screenshot-freshness.ts"));
const { buildTutorialLaunchUrl, TutorialManifestSchema } = await jiti.import(path.join(root, "core/schema.ts"));
const { tutorialDocument, tutorialFilename } = await jiti.import(path.join(root, "export/document.ts"));
const { tutorialHtml } = await jiti.import(path.join(root, "export/html.ts"));
const { tutorialWord } = await jiti.import(path.join(root, "export/office.ts"));
export function parseNativeCaptureArgs(args = process.argv.slice(2), defaults = {}) {
  const { values } = parseArgs({ args, options: {
    tutorial: { type: "string" }, draft: { type: "string" }, manifest: { type: "string" },
    "base-url": { type: "string" }, "launch-url": { type: "string" },
    out: { type: "string" }, channel: { type: "string" }, margin: { type: "string" },
    database: { type: "string" }, store: { type: "string" },
    "region-selector": { type: "string" }, viewport: { type: "boolean" }, help: { type: "boolean" },
  } });
  return { "base-url": "http://localhost:3000", margin: "16", database: "tourkit-studio", store: "drafts", viewport: false, help: false, ...defaults, ...values };
}

/**
 * Native screenshot runner for any same-origin instrumented stage. The host may
 * supply its own persistent-store bootstrap and a bundled crop adapter. Neither
 * interface loads an application catalog or serializes imported closures.
 */
export async function captureNativeTutorial(draft, options = {}) {
  const values = { "base-url": "http://localhost:3000", margin: "16", ...options };
  const margin = Number(values.margin);
  if (!Number.isInteger(margin) || margin < 0 || margin > 128) throw new Error("Margin must be an integer from 0 to 128.");
  const token = randomUUID();
  const replay = { ...draft, id: `native-${token}`, audio: undefined,
    steps: tutorialScreenshotReplaySteps(draft.steps).filter((step) => !isTutorialGuideBlock(step))
      .map(({ screenshot: _image, narration: _narration, ...step }) => step) };
  // An entirely static guide needs no interactive fixture or replay validation.
  const manifest = replay.steps.length ? tutorialRecordingDraftToManifest(replay) : undefined;
  const steps = manifest?.chapters.flatMap((chapter) => chapter.steps) ?? [];
  const output = path.resolve(values.out ?? path.join(root, "output/tutorials", tutorialFilename(draft.id)));
  await mkdir(output, { recursive: true });
  const base = new URL(values["base-url"].replace(/\/?$/, "/"));
  const wrapperUrl = new URL("__tutorial-native-capture__/", base).href;
  const launch = manifest ? buildTutorialLaunchUrl({ ...manifest.launch, hash: {
    ...manifest.launch.hash, tutorial: `draft:${replay.id}`, tutorialCapture: token, tutorialRun: token,
  } }) : "";
  const builtLaunch = new URL(launch, base);
  const stageUrl = new URL(values["launch-url"] ?? (values.resolveLaunchUrl ? values.resolveLaunchUrl(launch, base) : builtLaunch.href), base);
  if (values["launch-url"]) {
    const hash = new URLSearchParams(stageUrl.hash.replace(/^#/, ""));
    for (const [key, value] of new URLSearchParams(builtLaunch.hash.replace(/^#/, ""))) hash.set(key, value);
    stageUrl.hash = hash.toString();
  }
  const launchUrl = stageUrl.href;
  if (steps.length && new URL(launchUrl).origin !== base.origin) throw new Error("Native capture requires a same-origin stage and wrapper.");
  const browser = await chromium.launch(values.channel ? { channel: values.channel } : process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {});
  const report = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.route(wrapperUrl, (route) => route.fulfill({ contentType: "text/html", body:
      '<!doctype html><html><head><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}iframe{display:block;width:100vw;height:100vh;border:0}</style></head><body></body></html>' }));
    await page.addInitScript({ content: values.boundsScript ?? await buildNativeCaptureBoundsScript({ regionSelector: values["region-selector"] }) });
    await page.addInitScript({ content: await buildNativeCaptureAnchorScript({ domPolicy: values.domPolicy }) });
    let timer;
    let index = 0;
    let busy = false;
    let stopped = false;
    let finish;
    let fail;
    const completed = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
    // Attach immediately: a launch failure can precede the awaited completion below.
    completed.catch(() => {});
    const resetTimeout = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { stopped = true; fail(new Error(`Timed out at step ${index + 1}: ${steps[index]?.overlay.title ?? "loading"}`)); }, 60_000);
    };
    await page.exposeBinding("__wfNativeCapture", async (_, message) => {
      if (stopped || message.token !== token) return;
      if (message.type === "error") {
        stopped = true; clearTimeout(timer); fail(new Error(`Replay failed at ${message.stepId}: ${message.error}`)); return;
      }
      if (message.type === "complete") {
        stopped = true; clearTimeout(timer);
        if (index !== steps.length) fail(new Error("Replay completed without visiting every replay step.")); else finish();
        return;
      }
      if (message.type !== "step" || busy || steps[index]?.id !== message.stepId) return;
      busy = true; resetTimeout();
      const step = steps[index];
      try {
        if (step.screenshotMode !== "none") {
          const frame = page.frames().find((entry) => entry !== page.mainFrame());
          if (!frame) throw new Error("Replay frame disappeared.");
          await frame.waitForLoadState("load");
          await frame.evaluate(async (step) => {
            await document.fonts.ready;
            await Promise.all([...document.images].filter((image) => image.getBoundingClientRect().width > 0).map((image) => image.decode().catch(() => {})));
            document.getElementById('native-tutorial-highlight')?.remove();
            const target = window.__wfNativeRingElement(document, step);
            if (target) {
              const r = target.getBoundingClientRect();
              if (r.width > 0 && r.height > 0) {
                const ring = document.createElement('div'); ring.id = 'native-tutorial-highlight';
                ring.style.cssText = `position:fixed;pointer-events:none;z-index:2147483000;left:${r.left-4}px;top:${r.top-4}px;width:${r.width+8}px;height:${r.height+8}px;border:3px solid #f59e0b;border-radius:5px;box-sizing:border-box;box-shadow:0 0 0 3px #f59e0b40`;
                document.body.append(ring);
              }
            }
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          }, step);
          const bounds = values.viewport ? { x: 0, y: 0, width: 1920, height: 1080 }
            : await frame.evaluate((padding) => window.__wfNativeBounds(document, padding), margin);
          const filename = `${String(index + 1).padStart(2, "0")}-${tutorialFilename(step.id)}.png`;
          const bytes = await page.screenshot({ clip: bounds, animations: "disabled", caret: "hide", scale: "css", style:
            'nextjs-portal{display:none!important}[data-tutorial-private],[data-private],input[type="password"]{visibility:hidden!important}' });
          const screenshot = TutorialScreenshotSchema.parse({ dataUrl: `data:image/png;base64,${bytes.toString("base64")}`,
            width: bounds.width, height: bounds.height, alt: `Interface for ${step.overlay.title}`.slice(0, 500),
            provenance: { engine: "native", capturedAt: new Date().toISOString(), stepFingerprint: tutorialStepScreenshotFingerprint(draft, step.id) } });
          await writeFile(path.join(output, filename), bytes);
          const targetStep = draft.steps.find((entry) => entry.id === step.id);
          targetStep.screenshot = screenshot;
          report.push({ stepId: step.id, title: step.overlay.title, filename, ...bounds, engine: "chromium-native", margin, visuallyReviewed: false });
          console.log(`${index + 1}/${steps.length} ${step.overlay.title} — ${bounds.width} × ${bounds.height}`);
        } else {
          console.log(`${index + 1}/${steps.length} ${step.overlay.title} — text-only step`);
        }
        index += 1; busy = false; resetTimeout();
        // The runtime accepts acknowledgements only from its parent, so dispatch through the wrapper.
        await page.evaluate(({ token, stepId }) => document.querySelector('iframe').contentWindow.postMessage({ protocol: 'tourkit-capture-v1', token, type: 'captured', stepId }, location.origin), { token, stepId: step.id });
      } catch (error) { stopped = true; clearTimeout(timer); fail(error); }
    });
    if (steps.length) try {
      await page.goto(wrapperUrl);
      if (values.bootstrapDraft) await values.bootstrapDraft(page, replay);
      await page.evaluate(async ({ replay, launchUrl, token, databaseName, storeName, needsBootstrap }) => {
        if (needsBootstrap) await new Promise((resolve, reject) => {
          const request = indexedDB.open(databaseName, 1);
          request.onupgradeneeded = () => request.result.createObjectStore(storeName, { keyPath: 'id' });
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result; const tx = db.transaction(storeName, 'readwrite'); tx.objectStore(storeName).put(replay);
            tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => { db.close(); reject(tx.error); };
          };
        });
        const iframe = document.createElement('iframe'); iframe.title = 'Native tutorial capture';
        window.addEventListener('message', (event) => {
          if (event.source !== iframe.contentWindow || event.origin !== location.origin || event.data?.protocol !== 'tourkit-capture-v1' || event.data.token !== token) return;
          void window.__wfNativeCapture(event.data);
        });
        iframe.src = launchUrl; document.body.append(iframe);
      }, { replay, launchUrl, token, databaseName: values.database ?? "tourkit-studio", storeName: values.store ?? "drafts", needsBootstrap: !values.bootstrapDraft });
      resetTimeout();
      await completed;
    } finally { stopped = true; clearTimeout(timer); }
    const printPage = await context.newPage();
    await printPage.setContent(tutorialHtml(tutorialDocument({ draft })));
    await printPage.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((image) => image.decode()));
    });
    await printPage.pdf({ path: path.join(output, "guide.pdf"), format: "A4", printBackground: true,
      margin: { top: "16mm", bottom: "16mm", left: "16mm", right: "16mm" } });
  } finally { await browser.close(); }
  draft.updatedAt = new Date().toISOString();
  await writeFile(path.join(output, "capture-report.json"), JSON.stringify({ tutorialId: draft.id, source: base.href, viewport: { width: 1920, height: 1080 }, captures: report }, null, 2));
  await writeFile(path.join(output, `${tutorialFilename(draft.id)}.tutorial-draft.json`), await serializeTutorialRecordingDraft(draft));
  const doc = tutorialDocument({ draft });
  await writeFile(path.join(output, "guide.html"), tutorialHtml(doc));
  await writeFile(path.join(output, "guide.docx"), Buffer.from(await (await tutorialWord(doc)).arrayBuffer()));
  console.log(`Saved ${report.length} native screenshots, editable draft, HTML, Word and PDF to ${output}. Review every image before distribution.`);
  return { output, draft, captures: report };
}
export async function runNativeCaptureCli({ args, resolveTutorial, defaults = {} } = {}) {
  const parsed = parseNativeCaptureArgs(args, defaults);
  const values = { ...defaults, ...Object.fromEntries(Object.entries(parsed).filter(([, value]) => value !== undefined)) };
  if (values.help) {
    console.log("Capture --draft <file> or --manifest <file>. Options: --base-url <app URL>, --launch-url <stage URL>, --database <draft DB>, --store <store>, --region-selector <CSS>, --out <directory>, --channel chrome, --margin 16, --viewport. The stage must implement the capture protocol and read the same draft store. Produces PNGs, capture report, editable draft, HTML, Word and PDF. Application wrappers may also provide --tutorial <id>.");
    return;
  }
  if ([values.draft, values.manifest, values.tutorial].filter(Boolean).length !== 1) throw new Error("Choose exactly one of --draft, --manifest or an application-provided --tutorial.");
  let draft;
  if (values.tutorial) {
    if (!resolveTutorial) throw new Error("This standalone runner has no application catalog. Supply --draft or --manifest.");
    const manifest = await resolveTutorial(values.tutorial);
    if (!manifest) throw new Error(`Unknown tutorial: ${values.tutorial}`);
    draft = tutorialManifestToRecordingDraft(TutorialManifestSchema.parse(manifest));
  } else if (values.manifest) draft = tutorialManifestToRecordingDraft(TutorialManifestSchema.parse(JSON.parse(await readFile(values.manifest, "utf8"))));
  else draft = await deserializeTutorialRecordingDraft(await readFile(values.draft, "utf8"));
  return captureNativeTutorial(draft, values);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runNativeCaptureCli().catch((error) => { console.error(error); process.exitCode = 1; });
}


