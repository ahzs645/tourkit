import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { buildCaptureStudio } from "./build-capture-studio.mjs";
import { buildTutorialExample } from "./build-example.mjs";

const kit = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Capture Studio edits, persists, exports and reimports a real DOM recording", { timeout: 90_000 }, async (t) => {
  const output = path.join(kit, ".tmp-tourkit-capture-ui-test");
  const applicationStudio = path.join(kit, ".tmp-tourkit-capture-host-test");
  await Promise.all([buildCaptureStudio(output), buildTutorialExample("studio", applicationStudio)]);
  const server = createServer(async (request, response) => {
    const relative = decodeURIComponent(new URL(request.url, "http://localhost").pathname).replace(/^\/+/, "") || "index.html";
    const base = relative.startsWith("host/") ? applicationStudio : output;
    const file = path.resolve(base, relative.startsWith("host/") ? relative.slice(5) || "index.html" : relative);
    if (!file.startsWith(`${base}${path.sep}`)) { response.writeHead(403).end(); return; }
    try {
      const bytes = await readFile(file);
      response.writeHead(200, { "Content-Type": file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : file.endsWith(".json") ? "application/json" : "text/html" }).end(bytes);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  t.after(async () => { await browser?.close(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  const executablePath = process.env.TOURKIT_TEST_CHROMIUM ?? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath, args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-zygote"] } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true });
  const errors = [];
  const sourceRequests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => { if (request.url().startsWith("https://example.invalid")) sourceRequests.push(request.url()); });
  const url = `http://127.0.0.1:${server.address().port}/`;
  await page.goto(url);
  await page.getByRole("button", { name: "Try a sample", exact: true }).click();
  await page.getByLabel("Tutorial title", { exact: true }).fill("Edited capture workflow");
  const captured = () => page.frameLocator('iframe[title$=" — captured interface"]').frameLocator(".replayer-wrapper > iframe");
  await captured().getByRole("button", { name: "New project", exact: true }).waitFor();
  await page.locator(".tk-capture-step-tile").filter({ hasText: "Make it yours" }).click();
  await captured().getByLabel("Project name", { exact: true }).waitFor();
  await page.getByLabel("What should the learner do?", { exact: true }).fill("Type any project name, then press Enter.");
  await page.getByRole("button", { name: "Change target", exact: true }).click();
  await captured().getByLabel("Project name", { exact: true }).click();
  await page.getByRole("button", { name: "Change target", exact: true }).waitFor();
  await page.getByRole("button", { name: "Move step later", exact: true }).click();
  assert.deepEqual(await page.locator(".tk-capture-step-tile-copy strong").allTextContents(), ["Start a new project", "Create the project", "Make it yours", "You are ready to go"]);
  await page.locator(".tk-capture-step-tile").filter({ hasText: "You are ready to go" }).click();
  await page.getByRole("button", { name: "Delete step", exact: true }).click();
  await page.locator(".tk-capture-step-tile").filter({ hasText: "Start a new project" }).click();
  await page.getByText("Edit captured text", { exact: true }).click();
  await page.getByLabel("Replacement text", { exact: true }).fill("Make a plan");
  await page.getByRole("button", { name: "Apply to captured interface", exact: true }).click();
  await captured().getByRole("button", { name: "Make a plan", exact: true }).waitFor();
  await page.getByLabel("Replace screenshot", { exact: true }).setInputFiles({ name: "captured-step.png", mimeType: "image/png", buffer: await page.screenshot() });
  await page.getByRole("button", { name: "Reviewed", exact: true }).click();
  await page.getByText("Saved in this browser", { exact: true }).waitFor();

  await mkdir(path.join(output, "evidence"), { recursive: true });
  await page.locator(".tk-capture-inspector").evaluate((element) => { element.scrollTop = 0; });
  await page.screenshot({ path: path.join(output, "evidence/studio-desktop.png"), fullPage: true });
  const exported = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save package", exact: true }).click();
  const packageDownload = await exported;
  const packagePath = path.join(output, "evidence/edited.tourkit");
  await packageDownload.saveAs(packagePath);
  assert.ok((await readFile(packagePath)).length > 500);
  await page.reload();
  await page.getByRole("button", { name: "Resume saved edits", exact: true }).click();
  assert.equal(await page.getByLabel("Tutorial title", { exact: true }).inputValue(), "Edited capture workflow");
  assert.equal(await page.locator(".tk-capture-step-tile").count(), 3);
  await captured().getByRole("button", { name: "Make a plan", exact: true }).waitFor();
  await page.getByLabel("Import capture package", { exact: true }).setInputFiles(packagePath);
  await page.locator(".tk-capture-status").filter({ hasText: "Opened 3 captured steps." }).waitFor();
  assert.equal(await page.locator(".tk-capture-step-tile").count(), 3);

  await page.getByRole("button", { name: "More export options", exact: true }).click();
  const htmlExport = page.waitForEvent("download");
  await page.getByRole("button", { name: "Interactive HTML", exact: true }).click();
  const htmlDownload = await htmlExport;
  const htmlPath = path.join(output, "evidence/interactive.html");
  await htmlDownload.saveAs(htmlPath);
  assert.ok((await readFile(htmlPath, "utf8")).includes("Edited capture workflow"));
  const viewer = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const external = [];
  viewer.on("request", (request) => { if (/^https?:/.test(request.url())) external.push(request.url()); });
  await viewer.goto(new URL(`file://${htmlPath}`).href);
  await viewer.getByRole("heading", { name: "Edited capture workflow", exact: true }).waitFor();
  const offlineInterface = viewer.frameLocator('iframe[title$=" — captured interface"]').frameLocator(".replayer-wrapper > iframe");
  await offlineInterface.getByRole("button", { name: "Make a plan", exact: true }).click();
  await viewer.getByRole("heading", { name: "Create the project", exact: true }).waitFor();
  await offlineInterface.getByLabel("Project name", { exact: true }).fill("Offline learner");
  await offlineInterface.getByRole("button", { name: "Create project", exact: true }).click();
  await viewer.getByRole("heading", { name: "Make it yours", exact: true }).waitFor();
  assert.equal(await offlineInterface.getByLabel("Project name", { exact: true }).inputValue(), "Offline learner", "Learner input survives the recorded checkpoint change.");
  await offlineInterface.getByLabel("Project name", { exact: true }).press("Enter");
  await viewer.getByRole("heading", { name: "You have reached the end.", exact: true }).waitFor();
  assert.equal(await offlineInterface.getByLabel("Project name", { exact: true }).inputValue(), "Offline learner", "Completion must not remount and clear the replay session.");
  await viewer.getByRole("button", { name: "Practice again", exact: true }).click();
  await viewer.getByRole("heading", { name: "Start a new project", exact: true }).waitFor();
  assert.deepEqual(external, [], "Standalone HTML must not fetch remote resources.");
  await viewer.close();

  // The established application Studio exposes this capability directly,
  // and its nested-path runtime URL enables the same standalone export.
  const host = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  host.on("pageerror", (error) => errors.push(error.message));
  await host.goto(`${url}host/`);
  await host.getByRole("heading", { name: "Project Tutorial Studio", exact: true }).waitFor();
  await host.getByRole("button", { name: "Import captured website", exact: true }).click();
  await host.getByLabel("Import capture package", { exact: true }).setInputFiles(packagePath);
  assert.equal(await host.getByLabel("Tutorial title", { exact: true }).inputValue(), "Edited capture workflow");
  await host.frameLocator('iframe[title$=" — captured interface"]').frameLocator(".replayer-wrapper > iframe").getByRole("button", { name: "Make a plan", exact: true }).waitFor();
  await host.getByRole("button", { name: "More export options", exact: true }).click();
  assert.equal(await host.getByRole("button", { name: "Interactive HTML", exact: true }).isEnabled(), true);
  const hostExport = host.waitForEvent("download");
  await host.getByRole("button", { name: "Interactive HTML", exact: true }).click();
  const hostedDownload = await hostExport;
  assert.equal(hostedDownload.suggestedFilename(), "edited-capture-workflow.html");
  await host.screenshot({ path: path.join(output, "evidence/existing-studio-import.png"), fullPage: true });
  await host.getByRole("button", { name: "Back to application tutorials", exact: true }).click();
  await host.getByRole("heading", { name: "Project Tutorial Studio", exact: true }).waitFor();
  await host.close();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(output, "evidence/studio-mobile.png"), fullPage: true });
  assert.ok(await page.locator(".tk-capture-studio").evaluate((element) => element.scrollWidth <= window.innerWidth + 1), "The editor should not create horizontal page overflow on a phone.");
  assert.deepEqual(sourceRequests, [], "Editing must not contact the original application.");
  assert.deepEqual(errors, []);
});
