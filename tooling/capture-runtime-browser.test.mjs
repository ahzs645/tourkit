/** Real Chromium checks for the untrusted-DOM replay boundary and learner state. */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const text = (id, textContent) => ({ type: 3, id, textContent });
const element = (id, tagName, attributes = {}, childNodes = []) => ({ type: 2, id, tagName, attributes, childNodes });

function fixture() {
  const node = (result = false) => ({ type: 0, id: 1, childNodes: [element(2, "html", {}, [
    element(3, "head", {}, [element(8, "style", {}, [text(9, `@import "https://capture-source.invalid/import";body{font:16px sans-serif;padding:24px}input,button{margin:8px;padding:8px}.leak{background-image:u\\72l(https://capture-source.invalid/escaped)}`)]), element(20, "link", { _cssText: 'button{background-color:rgb(12,34,56);color:white}' })]),
    element(4, "body", { onload: "parent.parent.__sourceExecuted=true" }, [
      element(5, "input", { id: "name", type: "text", value: result ? "Recorded result" : "Recorded", "aria-label": "Project name" }),
      element(6, "button", { id: "save", onclick: 'fetch("https://capture-source.invalid/click")' }, [text(7, "Save")]),
      element(10, "p", { id: "result", class: "leak" }, [text(11, result ? "Saved result" : "Start state")]),
      element(12, "script", {}, [text(13, 'parent.parent.__sourceExecuted=true;fetch("https://capture-source.invalid/script")')]),
      element(14, "img", { src: "https://capture-source.invalid/image", onerror: "parent.parent.__sourceExecuted=true" }),
      element(15, "iframe", { src: "https://capture-source.invalid/frame", srcdoc: '<script>parent.parent.parent.__sourceExecuted=true</script>' }),
    ]),
  ])] });
  return {
    format: "tourkit-browser-capture", version: 1, id: "browser-fixture", title: "Browser fixture",
    createdAt: "2026-10-30T00:00:00.000Z", updatedAt: "2026-10-30T00:00:00.000Z",
    engine: { name: "rrweb", version: "2.2.0" }, viewport: { width: 1000, height: 650 }, privacy: { mode: "unreviewed" },
    pages: [{ id: "page-one", origin: "https://capture-source.invalid", path: "/form" }, { id: "page-two", origin: "https://capture-source.invalid", path: "/other" }],
    events: [
      { type: 4, timestamp: 1000, data: { href: "https://capture-source.invalid/form", width: 1000, height: 650 } },
      { type: 5, timestamp: 1000, data: { tag: "tourkit-document", payload: { documentId: "page-one" } } },
      { type: 2, timestamp: 1001, data: { node: node(), initialOffset: { left: 0, top: 0 } } },
      { type: 3, timestamp: 1300, data: { source: 0, adds: [], removes: [], texts: [{ id: 9, value: 'body{background-image:url("https://capture-source.invalid/mutated-css")}' }], attributes: [{ id: 14, attributes: { src: "https://capture-source.invalid/mutated-image", onerror: "parent.parent.__sourceExecuted=true" } }] } },
      { type: 2, timestamp: 1800, data: { node: node(true), initialOffset: { left: 0, top: 0 } } },
      { type: 5, timestamp: 2000, data: { tag: "end", payload: null } },
    ],
    steps: [
      { id: "enter", title: "Enter a practice name", instruction: "Type a name, then press Enter.", atMs: 10, action: "input", sourceDocumentId: "page-one", target: { nodeId: 5, documentId: "page-one" } },
      { id: "save", title: "Save the practice form", instruction: "Click Save.", atMs: 500, afterMs: 900, action: "click", sourceDocumentId: "page-one", target: { nodeId: 6, documentId: "page-one" } },
    ], warnings: [],
  };
}

test("captured DOM stays isolated while picking, input practice, seek and reset work", { timeout: 60_000 }, async (t) => {
  const bundled = await build({ stdin: { contents: `
    import { Replayer } from '@rrweb/replay';
    import { createBrowserCaptureReplay } from './browser-capture/replay';
    window.mountCapture=(capture,autoAdvance=true)=>{
      window.controller?.destroy(); window.actions=[]; window.completions=0; window.warnings=[]; window.picked=null;
      window.controller=createBrowserCaptureReplay({capture,root:document.getElementById('root'),autoAdvance,
        createReplayer:(events,options)=>new Replayer(events,options),
        onAction:action=>window.actions.push(action),onComplete:()=>window.completions++,onWarning:message=>window.warnings.push(message)});
      return window.controller.ready;
    };`, resolveDir: root, loader: "js" }, bundle: true, write: false, format: "iife", platform: "browser", logLevel: "silent" });
  const bundle = bundled.outputFiles[0].contents;
  const server = createServer((request, response) => {
    if (request.url === "/bundle.js") { response.writeHead(200, { "Content-Type": "text/javascript" }).end(bundle); return; }
    response.writeHead(200, { "Content-Type": "text/html" }).end('<!doctype html><html><body><main id="root" style="width:800px"></main><script src="/bundle.js"></script></body></html>');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  t.after(async () => { await browser?.close(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  const executablePath = process.env.TOURKIT_TEST_CHROMIUM ?? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath, args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-zygote"] } : {}) });
  const page = await browser.newPage();
  const sourceRequests = [];
  const errors = [];
  page.on("request", (request) => { if (request.url().startsWith("https://capture-source.invalid")) sourceRequests.push(request.url()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.evaluate((capture) => window.mountCapture(capture), fixture());
  await page.waitForFunction(() => window.controller.getDocument()?.querySelector("#name"));
  const inner = page.frameLocator('iframe[title="Browser fixture — captured interface"]').frameLocator(".replayer-wrapper > iframe");
  assert.equal(await inner.locator("#save").evaluate((button) => getComputedStyle(button).backgroundColor), "rgb(12, 34, 56)", "rrweb inlineStylesheet CSS survives reconstruction.");
  await inner.getByLabel("Project name").fill("Learner name");
  assert.equal(await page.evaluate(() => window.controller.getCurrentIndex()), 0, "Typing must not advance after the first character.");
  await inner.getByLabel("Project name").press("Enter");
  await page.waitForFunction(() => window.controller.getCurrentIndex() === 1);
  assert.equal(await inner.getByLabel("Project name").inputValue(), "Learner name", "Learner input survives a checkpoint rebuild.");
  const rect = await page.evaluate(() => window.controller.getTargetRect());
  assert.ok(rect && rect.width > 0 && rect.left >= 0 && rect.right <= 800, "Target geometry is measured in the scaled root.");
  await inner.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForFunction(() => window.controller.isComplete());
  assert.equal(await inner.locator("#result").innerText(), "Saved result", "Last action shows its recorded result.");
  assert.equal(await page.evaluate(() => window.completions), 1);
  assert.equal(await inner.getByLabel("Project name").inputValue(), "Learner name");
  await page.evaluate(() => window.controller.reset());
  await page.waitForFunction(() => window.controller.getCurrentIndex() === 0 && !window.controller.isComplete());
  assert.equal(await inner.getByLabel("Project name").inputValue(), "Recorded");
  assert.deepEqual(await page.evaluate(() => window.controller.getVariables()), {});

  await page.evaluate(() => window.controller.beginTargetPicking((target) => { window.picked = target; }));
  await inner.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForFunction(() => window.picked !== null);
  assert.equal(await page.evaluate(() => window.picked.nodeId), 6);
  assert.equal(await page.evaluate(() => window.controller.getCurrentIndex()), 0, "Picking does not run a step.");
  await page.evaluate(() => window.controller.endTargetPicking());

  const stale = fixture(); stale.steps[0].target.documentId = "page-two";
  await page.evaluate((capture) => window.mountCapture(capture, false), stale);
  await page.waitForFunction(() => window.controller.getDocument()?.querySelector("#name"));
  assert.equal(await page.evaluate(() => window.controller.getTargetElement()), null, "Reused rrweb node IDs cannot resolve across documents.");
  assert.equal(await page.evaluate(() => Boolean(window.__sourceExecuted)), false, "Source scripts and handlers never execute.");
  assert.deepEqual(sourceRequests, [], "Source origins receive no replay requests, including CSS mutations.");
  assert.deepEqual(errors, []);
});
