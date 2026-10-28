/** Real-browser acceptance for the neutral Studio, served below a non-root path. */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, expect } from "@playwright/test";

const buildDir = path.resolve(process.env.TUTORIAL_STUDIO_BUILD_DIR ?? ".tmp-tourkit-studio-example");
const prefix = "/nested/studio/";
const database = "tourkit-project-studio-example";

async function readDraft(page, id) {
  return page.evaluate(({ database, id }) => new Promise((resolve, reject) => {
    const opening = indexedDB.open(database, 1);
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result;
      const transaction = db.transaction("drafts", "readonly");
      const request = transaction.objectStore("drafts").get(id);
      request.onsuccess = () => resolve(request.result ? JSON.parse(JSON.stringify(request.result)) : null);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => db.close();
    };
  }), { database, id });
}

test("neutral Studio records, saves, replays, captures, exports and shares a real modal workflow", { timeout: 180_000 }, async (t) => {
  await stat(path.join(buildDir, "index.html"));
  const artifacts = process.env.TUTORIAL_STUDIO_ARTIFACT_DIR ? path.resolve(process.env.TUTORIAL_STUDIO_ARTIFACT_DIR) : await mkdtemp(path.join(tmpdir(), "tutorial-studio-browser-"));
  await mkdir(artifacts, { recursive: true });
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith(prefix)) { response.writeHead(404).end(); return; }
    const file = path.resolve(buildDir, decodeURIComponent(url.pathname.slice(prefix.length)) || "index.html");
    if (!file.startsWith(buildDir + path.sep)) { response.writeHead(403).end(); return; }
    try {
      const type = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".png": "image/png", ".ttf": "font/ttf" }[path.extname(file)] ?? "application/octet-stream";
      response.writeHead(200, { "Content-Type": type }); response.end(await readFile(file));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  let page;
  t.after(async () => {
    if (page && !page.isClosed()) {
      await page.screenshot({ path: path.join(artifacts, "studio-last-state.png"), fullPage: true }).catch(() => {});
      await writeFile(path.join(artifacts, "studio-last-state.txt"), await page.locator("body").innerText().catch(() => "Page unavailable"));
      for (const [index, child] of page.frames().entries()) if (child !== page.mainFrame()) {
        await writeFile(path.join(artifacts, `studio-frame-${index}.txt`), await child.locator("body").innerText().catch(() => "Frame unavailable"));
      }
    }
    await browser?.close(); server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
  page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));
  await page.goto(`${origin}${prefix}index.html`);
  await page.getByRole("button", { name: "New tutorial", exact: true }).click();
  await expect(page).toHaveURL(/\?open=/);
  const id = new URL(page.url()).searchParams.get("open");
  const frame = () => page.frameLocator('iframe[title="Tutorial recording fixture"]');
  await expect(frame().getByTestId("project-stage")).toBeVisible();
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  await page.getByLabel("Stage fixture", { exact: true }).click();
  await page.getByRole("option", { name: "One sample project", exact: true }).click();
  await expect(frame().locator("[data-project]")).toHaveCount(1);
  await page.getByLabel("Stage fixture", { exact: true }).click();
  await page.getByRole("option", { name: "Empty project list", exact: true }).click();
  await expect(frame().locator("[data-project]")).toHaveCount(0);
  await page.getByRole("tab", { name: "Steps0", exact: true }).click();
  await page.getByRole("button", { name: "Recording options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Record actions only (no microphone)", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop recording", exact: true })).toBeVisible();
  await frame().getByRole("button", { name: "New project", exact: true }).click();
  await frame().getByLabel("Project name", { exact: true }).fill("Launch plan");
  await frame().getByLabel("Project priority", { exact: true }).click();
  await frame().getByRole("option", { name: "High", exact: true }).click();
  await frame().getByRole("button", { name: "Save project", exact: true }).click();
  await expect(frame().locator("[data-project]")).toHaveCount(1);
  await page.getByRole("button", { name: "Stop recording", exact: true }).click();
  await expect(page.locator("[data-rail-step]")).toHaveCount(4);
  await page.locator("[data-rail-step]").first().click();
  await page.getByLabel("Step 1 title", { exact: true }).fill("Open the project editor");
  await page.getByLabel("Step 1 completion description", { exact: true }).fill("the project editor is visible");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByTestId("save-state")).toContainText("Saved");
  const saved = await readDraft(page, id);
  assert.deepEqual(saved.steps.map((step) => step.action.id), ["projects.open-create", "projects.set-name", "projects.set-priority", "projects.save"]);
  assert.deepEqual(saved.steps.map((step) => step.anchor), ["projects.add", "projects.name", "projects.priority", "projects.save"]);
  assert.ok(saved.steps.every((step) => step.check?.all.length));
  assert.equal(saved.steps[0].check.description, "the project editor is visible");
  assert.equal(saved.launch.path, `${prefix}stage.html`);
  console.log("Studio acceptance: recorded, edited and saved four semantic steps.");
  await page.reload();
  await expect(page.locator("[data-rail-step]")).toHaveCount(4);
  await expect(page.getByLabel("Step 1 title", { exact: true })).toHaveValue("Open the project editor");

  // Seeking must reconstruct all earlier effects, while leaving the selected Save action undone.
  await page.locator("[data-rail-step]").nth(3).click();
  await expect(frame().getByLabel("Project name", { exact: true })).toHaveValue("Launch plan");
  await expect(frame().getByLabel("Project priority", { exact: true })).toContainText("High");
  await expect(frame().locator("[data-project]")).toHaveCount(0);
  await expect(page.locator("[data-rail-step]").nth(3).getByLabel("Control not on screen right now")).toHaveCount(0);
  await page.screenshot({ path: path.join(artifacts, "studio-authoring.png"), fullPage: true });
  console.log("Studio acceptance: reload and seek passed.");
  await page.getByLabel("Preview mode", { exact: true }).click();
  await page.getByRole("option", { name: "Watch", exact: true }).click();
  await page.getByRole("button", { name: "Preview all", exact: true }).click();
  await expect(frame().getByRole("status")).toContainText("Tutorial complete", { timeout: 30_000 });
  await expect(frame().locator("[data-project]")).toHaveCount(1);
  console.log("Studio acceptance: Watch completed.");
  await page.getByRole("button", { name: "Restart", exact: true }).click();
  await expect(frame().getByRole("status")).toContainText("Tutorial complete", { timeout: 30_000 });
  await expect(frame().locator("[data-project]")).toHaveCount(1);
  await page.getByRole("button", { name: "Back to authoring", exact: true }).click();
  await page.getByLabel("Preview mode", { exact: true }).click();
  await page.getByRole("option", { name: "Try it", exact: true }).click();
  await page.getByRole("button", { name: "Preview all", exact: true }).click();
  await frame().getByRole("button", { name: "New project", exact: true }).click();
  await frame().getByLabel("Project name", { exact: true }).fill("Launch plan");
  await frame().getByLabel("Project priority", { exact: true }).click();
  await frame().getByRole("option", { name: "High", exact: true }).click();
  await frame().getByRole("button", { name: "Save project", exact: true }).click();
  await frame().getByRole("button", { name: "Finish tutorial", exact: true }).click();
  await expect(frame().getByRole("status")).toContainText("Tutorial complete", { timeout: 30_000 });
  console.log("Studio acceptance: Practice completed.");
  await page.getByRole("button", { name: "Back to authoring", exact: true }).click();

  await page.getByRole("button", { name: "Review screenshots", exact: true }).click();
  const review = page.getByRole("dialog", { name: "Review screenshots", exact: true });
  await review.getByRole("button", { name: "Capture missing (4)", exact: true }).click();
  await expect(review.locator("article img")).toHaveCount(4, { timeout: 45_000 });
  await expect(review.getByText("Matches the current step.", { exact: false })).toHaveCount(4);
  await review.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect.poll(async () => (await readDraft(page, id)).steps.filter((step) => step.screenshot?.dataUrl?.startsWith("data:image/")).length).toBe(4);
  const captured = await readDraft(page, id);
  assert.ok(captured.steps.every((step) => step.screenshot.provenance?.stepFingerprint));
  console.log("Studio acceptance: four screenshots captured with provenance.");
  await page.getByRole("button", { name: "Export…", exact: true }).click();
  const exportDialog = page.getByRole("dialog", { name: "Export tutorial", exact: true });
  await exportDialog.getByRole("button", { name: "HTML .html", exact: true }).click();
  const htmlDownload = page.waitForEvent("download");
  await exportDialog.getByRole("button", { name: "Download HTML", exact: true }).click();
  const htmlFile = path.join(artifacts, "project-guide.html"); await (await htmlDownload).saveAs(htmlFile);
  const html = await readFile(htmlFile, "utf8");
  assert.match(html, /Open the project editor/); assert.match(html, /data:image\//); assert.match(html, /Launch plan/);
  await exportDialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "More actions", exact: true }).click();
  const draftDownload = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Export draft", exact: true }).click();
  const draftFile = path.join(artifacts, "project.tutorial-draft.json"); await (await draftDownload).saveAs(draftFile);
  assert.equal(JSON.parse(await readFile(draftFile, "utf8")).steps.length, 4);

  await page.getByRole("button", { name: "Share link…", exact: true }).click();
  await expect(page.getByLabel("Watch link", { exact: true })).toHaveValue(/tutorial=link/);
  const watchLink = await page.getByLabel("Watch link", { exact: true }).inputValue();
  const editLink = await page.getByLabel("Edit a copy link", { exact: true }).inputValue();
  assert.equal(new URL(watchLink).pathname, `${prefix}stage.html`);
  await page.getByRole("dialog", { name: "Share as a link", exact: true }).getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "My tutorials", exact: true }).click();
  await page.getByTestId("my-tutorials").locator('input[type="file"]').setInputFiles(draftFile);
  await page.getByRole("button", { name: "Keep both", exact: true }).click();
  await expect(page.locator("[data-my-tutorial]")).toHaveCount(2);

  // A fresh browser context has no draft database: playback must decode the shared lesson itself.
  const recipient = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark" });
  const shared = await recipient.newPage(); shared.on("pageerror", (error) => failures.push(error.message));
  await shared.addInitScript(() => document.addEventListener("DOMContentLoaded", () => document.documentElement.classList.add("dark")));
  await shared.goto(watchLink);
  await expect(shared.getByRole("dialog", { name: "Create a project: tutorial step 1", exact: true })).toBeVisible();
  await expect(shared.getByTestId("tutorial-overlay")).toHaveAttribute("data-suspended", "false");
  await shared.screenshot({ path: path.join(artifacts, "studio-mobile-overlay.png"), fullPage: true });
  await expect(shared.getByRole("status")).toContainText("Tutorial complete", { timeout: 30_000 });
  await expect(shared.locator("[data-project]")).toHaveCount(1);
  await shared.screenshot({ path: path.join(artifacts, "studio-mobile-shared.png"), fullPage: true });
  await shared.goto(editLink);
  await expect(shared.locator("[data-my-tutorial]")).toHaveCount(1);
  await shared.getByRole("link", { name: "Create a project", exact: true }).click();
  await expect(shared.locator("[data-rail-step]")).toHaveCount(4);
  assert.deepEqual(failures, []);
  t.diagnostic(JSON.stringify({ artifacts, recordedSteps: 4, capturedScreenshots: 4, exports: [htmlFile, draftFile], nonRootPath: prefix, pageErrors: failures.length }));
});
