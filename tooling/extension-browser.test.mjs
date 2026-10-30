import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { createJiti } from "jiti";
import { buildTutorialExample } from "./build-example.mjs";

const kit = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHANNEL = "tourkit-recorder-v1";
const privateImage = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

test("MV3 recorder captures, recovers and opens an editable portable website in Studio", { timeout: 150_000 }, async (t) => {
  const output = path.join(kit, ".tmp-tourkit-extension-test");
  await buildTutorialExample("simulated-backend", path.join(output, "source"));
  const extension = path.join(output, "extension");
  await rm(extension, { recursive: true, force: true });
  await cp(path.join(kit, "dist-extension"), extension, { recursive: true });
  const manifestPath = path.join(extension, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.deepEqual(manifest.permissions.sort(), ["activeTab", "downloads", "scripting", "storage"]);
  assert.equal(manifest.manifest_version, 3);
  // Chrome's native screenshot API requires activeTab activation or all_urls.
  // Playwright cannot activate the toolbar grant, so this disposable profile's
  // test-only manifest uses all_urls and visits only the local fixture. Assert
  // above that this grant is never present in the distributed manifest.
  assert.equal(manifest.host_permissions, undefined);
  manifest.host_permissions = ["<all_urls>"];
  await writeFile(manifestPath, JSON.stringify(manifest));
  const sourceRoot = path.join(output, "source");
  const requests = [];
  const server = createServer(async (request, response) => {
    requests.push(request.url);
    const name = decodeURIComponent(new URL(request.url, "http://localhost").pathname).replace(/^\/+/, "") || "index.html";
    const file = path.resolve(sourceRoot, name);
    if (!file.startsWith(`${sourceRoot}${path.sep}`)) { response.writeHead(403).end(); return; }
    try {
      const bytes = await readFile(file);
      response.writeHead(200, { "Content-Type": file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html" }).end(bytes);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const profile = await mkdtemp(path.join(tmpdir(), "tourkit-recorder-test-"));
  let context;
  t.after(async () => { await context?.close(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await rm(profile, { recursive: true, force: true }); });
  const executablePath = process.env.TOURKIT_TEST_EXTENSION_CHROMIUM ?? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  context = await chromium.launchPersistentContext(profile, {
    headless: true, channel: "chromium", ...(executablePath ? { executablePath } : {}),
    viewport: { width: 1280, height: 900 }, acceptDownloads: true,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: ["--no-sandbox", "--disable-dev-shm-usage", `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const extensionOrigin = new URL(worker.url()).origin === "null" ? worker.url().split("/").slice(0, 3).join("/") : new URL(worker.url()).origin;
  const dashboard = await context.newPage();
  await dashboard.goto(`${extensionOrigin}/dashboard.html`);
  await dashboard.getByRole("heading", { name: "Your recordings" }).waitFor();
  const command = (message) => dashboard.evaluate(async ({ channel, message }) => {
    const result = await chrome.runtime.sendMessage({ channel, ...message });
    if (!result?.ok) throw new Error(result?.error || "Recorder command failed");
    return result;
  }, { channel: CHANNEL, message });
  const status = async () => (await command({ type: "status" })).active;
  const source = await context.newPage();
  await source.goto(`${origin}/?token=never-export-this-token#private-fragment`);
  await source.getByRole("button", { name: "New project", exact: true }).waitFor();
  const sourceAppearance = await source.locator(".simulation-demo").evaluate((element) => ({
    background: getComputedStyle(element).backgroundColor,
    font: getComputedStyle(element).fontFamily,
  }));
  await source.evaluate((privateImage) => {
    const privateBlock = document.createElement("div");
    privateBlock.dataset.tourkitPrivate = "";
    privateBlock.textContent = "never-export-private-region";
    Object.assign(privateBlock.style, { position: "fixed", left: "12px", top: "90px", width: "220px", height: "35px", background: "red", zIndex: "50" });
    const secret = document.createElement("input"); secret.type = "password"; secret.value = "never-export-password";
    Object.assign(secret.style, { position: "fixed", left: "12px", top: "130px", width: "220px", height: "35px", zIndex: "50" });
    const image = document.createElement("img"); image.src = privateImage; image.alt = "never-export-private-image";
    privateBlock.append(image);
    document.body.append(privateBlock, secret);
  }, privateImage);
  const tabId = await dashboard.evaluate(async (origin) => (await chrome.tabs.query({ url: `${origin}/*` }))[0].id, origin);
  const started = await command({ type: "start", tabId, title: "Recorded project workflow", screenshots: true, privateSelector: "" });
  assert.ok(started.sessionId);
  await expect.poll(async () => (await status()).eventCount).toBeGreaterThan(0);
  try { await expect.poll(async () => (await status()).screenshotBytes, { timeout: 15_000 }).toBeGreaterThan(0); }
  catch (error) {
    console.error("Screenshot capture notes:", (await status()).warnings);
    console.error("Native screenshot API:", await dashboard.evaluate(async () => { try { await chrome.tabs.captureVisibleTab(); return "available"; } catch (error) { return String(error); } }));
    throw error;
  }
  const initial = await status();
  const firstScreenshot = initial.steps.find((step) => step.screenshot)?.screenshot;
  assert.ok(firstScreenshot, "The real extension should capture a redacted native screenshot.");
  const pixel = await source.evaluate(async (dataUrl) => {
    const image = new Image(); image.src = dataUrl; await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
    const drawing = canvas.getContext("2d"); drawing.drawImage(image, 0, 0);
    return [...drawing.getImageData(50, 105, 1, 1).data];
  }, firstScreenshot.dataUrl);
  assert.deepEqual(pixel, [23, 39, 56, 255], "Private screenshot pixels must be painted over before they are saved.");

  await source.getByRole("button", { name: "New project", exact: true }).click();
  await source.getByLabel("Project name", { exact: true }).pressSequentially("Autumn launch", { delay: 15 });
  await source.getByRole("button", { name: "Create project", exact: true }).click();
  await source.getByRole("button", { name: /Autumn launch.*Open project/ }).click();
  assert.equal(await source.getByLabel("Project name", { exact: true }).inputValue(), "Autumn launch");
  await source.getByLabel("Project name", { exact: true }).fill("Autumn launch revised");
  await source.getByRole("button", { name: "Save changes", exact: true }).click();
  await source.getByText("Saved Autumn launch revised.", { exact: true }).waitFor();
  assert.equal(requests.filter((url) => url.startsWith("/api/")).length, 0, "The simulated backend should never reach the HTTP server.");
  await command({ type: "pause", sessionId: started.sessionId });
  assert.equal((await status()).status, "paused");
  await command({ type: "resume", sessionId: started.sessionId, tabId });
  await source.reload();
  await source.locator("#tourkit-recorder-indicator").waitFor();
  await expect.poll(async () => (await status()).pages.length).toBe(2);
  await command({ type: "stop", sessionId: started.sessionId });
  const recorded = await status();
  assert.equal(recorded.status, "stopped");
  assert.ok(recorded.steps.some((step) => step.action === "input"));
  assert.ok(recorded.steps.some((step) => step.action === "click" && /New project/.test(step.title)));
  assert.ok(recorded.assetBytes > 0, "Stylesheets should be bundled as local assets.");

  // Terminating the worker proves the session is in IndexedDB, not a worker global.
  const cdp = await context.newCDPSession(dashboard);
  const { targetInfos } = await cdp.send("Target.getTargets");
  const serviceWorker = targetInfos.find((target) => target.type === "service_worker" && target.url === worker.url());
  if (serviceWorker) await cdp.send("Target.closeTarget", { targetId: serviceWorker.targetId });
  await dashboard.reload();
  await dashboard.getByRole("heading", { name: "Recorded project workflow", exact: true }).waitFor();
  assert.equal((await status()).eventCount, recorded.eventCount);
  const studioOpened = context.waitForEvent("page");
  await dashboard.getByRole("button", { name: "Open in Studio", exact: true }).click();
  const studio = await studioOpened;
  await studio.getByLabel("Tutorial title", { exact: true }).waitFor();
  assert.equal(await studio.getByLabel("Tutorial title", { exact: true }).inputValue(), "Recorded project workflow");
  const replayFrame = studio.frameLocator('iframe[title$=" — captured interface"]').frameLocator(".replayer-wrapper > iframe");
  await replayFrame.getByRole("button", { name: "New project", exact: true }).waitFor();
  assert.deepEqual(await replayFrame.locator(".simulation-demo").evaluate((element) => ({
    background: getComputedStyle(element).backgroundColor,
    font: getComputedStyle(element).fontFamily,
  })), sourceAppearance, "The captured interface must preserve its real stylesheet, not just its HTML text.");
  await studio.getByLabel("Tutorial title", { exact: true }).fill("Edited extension recording");
  const download = studio.waitForEvent("download");
  await studio.getByRole("button", { name: "Save package", exact: true }).click();
  const saved = await download;
  const evidence = process.env.TOURKIT_EXTENSION_ARTIFACT_DIR ?? path.join(output, "evidence");
  await mkdir(evidence, { recursive: true });
  const capturePath = path.join(evidence, "recorded-and-edited.tourkit");
  await saved.saveAs(capturePath);
  const { importBrowserCapture } = await createJiti(import.meta.url).import(path.join(kit, "browser-capture/index.ts"));
  const capture = await importBrowserCapture(new Uint8Array(await readFile(capturePath)));
  const serialized = JSON.stringify(capture);
  assert.equal(capture.title, "Edited extension recording");
  assert.equal(capture.pages.length, 2);
  for (const secret of ["never-export-private-region", "never-export-password", "never-export-this-token", "private-fragment"]) assert.ok(!serialized.includes(secret), `Capture must omit ${secret}`);
  assert.ok(!serialized.includes(privateImage), "An excluded private image must not remain hidden inside the asset bundle.");
  assert.ok(capture.steps.some((step) => step.screenshot));
  assert.ok(capture.steps.some((step) => step.afterMs >= step.atMs));
  assert.equal(capture.privacy.mode, "masked");
  assert.ok(!serialized.includes('"syntheticDataOnly":true'));
  await studio.screenshot({ path: path.join(evidence, "extension-studio.png"), fullPage: true });
  await dashboard.screenshot({ path: path.join(evidence, "recording-dashboard.png"), fullPage: true });
});
