/** Browser acceptance for catalog-independent learning and scoped, live progress. */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, expect } from "@playwright/test";

const buildDir = path.resolve(process.env.TUTORIAL_LIBRARY_BUILD_DIR ?? ".tmp-tourkit-library-example");
const prefix = "/nested/library/";

test("two unrelated collections browse, launch, resume and update independently", { timeout: 120_000 }, async (t) => {
  await stat(path.join(buildDir, "index.html"));
  const artifacts = process.env.TUTORIAL_LIBRARY_ARTIFACT_DIR ? path.resolve(process.env.TUTORIAL_LIBRARY_ARTIFACT_DIR) : await mkdtemp(path.join(tmpdir(), "tutorial-library-browser-"));
  await mkdir(artifacts, { recursive: true });
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith(prefix)) { response.writeHead(404).end(); return; }
    const file = path.resolve(buildDir, decodeURIComponent(url.pathname.slice(prefix.length)) || "index.html");
    if (!file.startsWith(buildDir + path.sep)) { response.writeHead(403).end(); return; }
    try {
      const type = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" }[path.extname(file)] ?? "application/octet-stream";
      response.writeHead(200, { "Content-Type": type }); response.end(await readFile(file));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}${prefix}index.html`;
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  const cards = () => page.locator("[data-tutorial-card]");
  const starter = () => page.locator('[data-tutorial-card="starter"]');
  await expect(cards()).toHaveCount(2);
  await page.getByRole("searchbox", { name: "Search tutorials", exact: true }).fill("shelve");
  await expect(cards()).toHaveCount(1);
  await expect(page.locator('nav[aria-label="Sections"] a[aria-disabled="true"]').first()).not.toHaveAttribute("href");
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(cards()).toHaveCount(2);
  await page.getByLabel("Filter tutorials by lesson type", { exact: true }).click();
  await page.getByRole("option", { name: "Orientation", exact: true }).click();
  await expect(cards()).toHaveCount(0);
  await page.getByLabel("Filter tutorials by lesson type", { exact: true }).click();
  await page.getByRole("option", { name: "Task practice", exact: true }).click();
  await expect(cards()).toHaveCount(2);
  await page.getByRole("button", { name: "Cards", exact: true }).click();
  await expect(page.locator("article[data-tutorial-card]")).toHaveCount(2);
  await page.screenshot({ path: path.join(artifacts, "library-desktop.png"), fullPage: true });

  await starter().getByRole("button", { name: "Watch", exact: true }).click();
  await expect(page.getByText("Completed: Create and approve an order", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("progressbar", { name: "Warehouse progress", exact: true })).toHaveAttribute("aria-valuenow", "1");
  await expect(starter().getByRole("button", { name: "Try again", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Observatory", exact: true }).click();
  await expect(page.getByRole("progressbar", { name: "Observatory progress", exact: true })).toHaveAttribute("aria-valuenow", "0");
  await starter().getByRole("button", { name: "Try it", exact: true }).click();
  await page.getByRole("button", { name: "Plan session", exact: true }).click();
  await expect(page.locator('[data-tutorial-step="step-2"]')).toBeVisible();
  // Reload leaves an interrupted run. Re-selecting this independent catalog
  // must read its saved IDs and rebuild prior fixture operations before resume.
  await page.reload();
  await page.getByRole("button", { name: "Observatory", exact: true }).click();
  await expect(starter()).toContainText("Step 2 of 2");
  await starter().getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("dialog", { name: "Resume Plan and prepare an observing session?", exact: true }).getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator('[data-tutorial-step="step-2"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Plan session ✓", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Prepare equipment", exact: true }).click();
  await page.getByRole("button", { name: "Finish tutorial", exact: true }).click();
  await expect(page.getByText("Completed: Plan and prepare an observing session", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("progressbar", { name: "Observatory progress", exact: true })).toHaveAttribute("aria-valuenow", "1");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.getByRole("button", { name: "Rows", exact: true }).click();
  await expect(page.locator("li[data-tutorial-card]")).toHaveCount(2);
  await page.getByRole("group", { name: "Filter tutorials by status", exact: true }).getByRole("button", { name: /^Completed/ }).click();
  await expect(cards()).toHaveCount(1);
  await page.getByRole("group", { name: "Filter tutorials by status", exact: true }).getByRole("button", { name: /^All / }).click();
  await expect(cards()).toHaveCount(2);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, "narrow library must not overflow horizontally");
  await page.screenshot({ path: path.join(artifacts, "library-mobile-dark.png"), fullPage: true });

  await page.getByRole("button", { name: "Warehouse", exact: true }).click();
  await expect(page.getByRole("progressbar", { name: "Warehouse progress", exact: true })).toHaveAttribute("aria-valuenow", "1");
  const otherTab = await context.newPage(); otherTab.on("pageerror", (error) => errors.push(error.message));
  await otherTab.goto(url);
  await otherTab.getByRole("button", { name: "Reset this collection", exact: true }).click();
  await expect(page.getByRole("progressbar", { name: "Warehouse progress", exact: true })).toHaveAttribute("aria-valuenow", "0");
  await page.getByRole("button", { name: "Observatory", exact: true }).click();
  await expect(page.getByRole("progressbar", { name: "Observatory progress", exact: true })).toHaveAttribute("aria-valuenow", "1");
  assert.deepEqual(errors, []);
  t.diagnostic(JSON.stringify({ artifacts, collections: 2, sharedLessonIds: true, watch: "complete", practice: "resumed and complete", crossTabUpdates: true, pageErrors: errors.length }));
});
