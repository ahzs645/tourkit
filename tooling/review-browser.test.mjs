import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { readFile, mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "@playwright/test";

// The builder writes relative to the invoking project, whether the kit is its
// own checkout or a submodule of a host. Do not infer an application parent folder.
const output = path.resolve(process.env.TUTORIAL_REVIEW_EXAMPLE_DIR ?? ".tmp-tourkit-review-example");
const screenshots = path.resolve(process.env.TUTORIAL_REVIEW_SCREENSHOTS ?? ".tmp-tourkit-review-proof");
const key = "tourkit-review-demo:review:proposal:community-project:preview";

async function serve() {
  await readFile(path.join(output, "index.html"));
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      const file = path.resolve(output, `.${pathname === "/" ? "/index.html" : pathname}`);
      if (!file.startsWith(`${path.resolve(output)}${path.sep}`)) { response.writeHead(403).end(); return; }
      response.setHeader("content-type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html");
      response.end(await readFile(file));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}/` };
}

async function readSaved(page) { return page.evaluate((storageKey) => JSON.parse(localStorage.getItem(storageKey) ?? "null"), key); }
async function waitForSaved(page, predicate) {
  await page.waitForFunction(({ storageKey, condition }) => {
    const bundle = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    if (!bundle) return false;
    if (condition === "comment") return bundle.items.some((item) => item.kind === "comment" && item.text === "Please define the success measure.");
    if (condition === "reply") return bundle.items.some((item) => item.replies.length === 1);
    return bundle.items.some((item) => item.kind === "drawing" && item.points.length > 2);
  }, { storageKey: key, condition: predicate });
}

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test(`optional review addon: pins, replies, drawing and file round-trip at ${viewport.width}px`, { timeout: 120_000 }, async () => {
    const { server, url } = await serve();
    const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}), args: ["--no-sandbox"] });
    const context = await browser.newContext({ viewport, acceptDownloads: true });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto(url);
      await page.getByRole("button", { name: "Give feedback", exact: true }).click();
      await page.getByRole("button", { name: "Stay anonymous", exact: true }).click();
      await page.getByRole("button", { name: "Comment", exact: true }).click();
      const target = await page.locator('[data-proposal-part="overview"]').boundingBox();
      assert.ok(target);
      await page.mouse.click(target.x + 30, target.y + 18);
      const card = page.getByTestId("review-item-card");
      await card.getByRole("textbox", { name: "Feedback text", exact: true }).fill("Please define the success measure.");
      await waitForSaved(page, "comment");
      await card.getByRole("textbox", { name: "Reply", exact: true }).fill("We will measure time saved.");
      await card.getByRole("button", { name: "Reply", exact: true }).click();
      await waitForSaved(page, "reply");
      await card.getByRole("button", { name: "Resolve", exact: true }).click();
      assert.equal((await readSaved(page)).items[0].status, "resolved");
      await card.getByRole("button", { name: "Reopen", exact: true }).click();
      assert.equal((await readSaved(page)).items[0].status, "open");
      await card.getByRole("button", { name: "Close", exact: true }).click();
      await page.getByRole("button", { name: "Draw", exact: true }).click();
      const drawTarget = await page.locator('[data-proposal-part="outcomes"]').boundingBox();
      assert.ok(drawTarget);
      await page.mouse.move(drawTarget.x + 20, drawTarget.y + 18);
      await page.mouse.down();
      await page.mouse.move(drawTarget.x + 120, drawTarget.y + 22, { steps: 10 });
      await page.mouse.up();
      await waitForSaved(page, "drawing");
      await page.getByRole("button", { name: "Use screen", exact: true }).click();
      const saved = await readSaved(page);
      assert.equal(saved.form.kind, "proposal");
      assert.equal(saved.items[0].anchor.fieldId, "overview");
      assert.equal(saved.items[0].replies[0].text, "We will measure time saved.");
      assert.equal(saved.items[1].kind, "drawing");
      await mkdir(screenshots, { recursive: true });
      await page.screenshot({ path: path.join(screenshots, `review-${viewport.width}.png`), fullPage: true });
      await page.getByRole("button", { name: /Feedback \(2\)/ }).click();
      const panel = page.getByTestId("review-panel");
      const downloadPromise = page.waitForEvent("download");
      await panel.getByRole("button", { name: "HTML", exact: true }).click();
      const download = await downloadPromise;
      const temp = await mkdtemp(path.join(tmpdir(), "tutorial-review-roundtrip-"));
      const exported = path.join(temp, "feedback.html");
      await download.saveAs(exported);
      const html = await readFile(exported, "utf8");
      const match = html.match(/<script id="tourkit-review-feedback" type="application\/json">([\s\S]*?)<\/script>/);
      assert.ok(match);
      const returned = JSON.parse(match[1]);
      assert.equal(returned.items.length, 2);
      assert.equal(returned.items[0].replies.length, 1);
      assert.ok(returned.snapshots.length, "Actual page capture is included in the exported file");

      const importedContext = await browser.newContext({ viewport });
      const importedPage = await importedContext.newPage();
      importedPage.on("pageerror", (error) => errors.push(error.message));
      await importedPage.goto(url);
      await importedPage.locator('[data-review-root] > input[type="file"]').setInputFiles(exported);
      await importedPage.getByRole("button", { name: "Add to round 1", exact: true }).click();
      await importedPage.getByRole("button", { name: "Close feedback list", exact: true }).click();
      await importedPage.getByRole("button", { name: "Revise proposal wording", exact: true }).click();
      await importedPage.getByRole("button", { name: "Open saved review in inbox", exact: true }).click();
      const inbox = importedPage.getByTestId("review-inbox");
      await inbox.getByText("Please define the success measure.", { exact: true }).waitFor();
      assert.match(await inbox.textContent(), /Paragraph edited/);
      await inbox.getByRole("button", { name: "Resolve", exact: true }).first().click();
      await inbox.getByRole("button", { name: "All", exact: true }).click();
      await inbox.getByRole("button", { name: "Reopen", exact: true }).click();
      await importedPage.screenshot({ path: path.join(screenshots, `review-inbox-${viewport.width}.png`), fullPage: true });
      assert.equal(await importedPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      assert.deepEqual(errors, []);
      await importedContext.close();
    } catch (error) {
      await mkdir(screenshots, { recursive: true });
      await page.screenshot({ path: path.join(screenshots, `review-failure-${viewport.width}.png`), fullPage: true }).catch(() => undefined);
      throw error;
    } finally {
      await context.close();
      await browser.close();
      await new Promise((resolve) => server.close(resolve));
    }
  });
}
