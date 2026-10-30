import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { exportBrowserCaptureZip, importBrowserCapture } from "./archive";
import { BROWSER_CAPTURE_CSP, sanitizeCaptureEventsForReplay } from "./sanitize";
import { captureDuration, parseBrowserCapture, sanitizeCaptureSourceUrl, serializeBrowserCapture } from "./validation";
import type { BrowserCapturePackage, JsonValue } from "./types";

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=";
function fixture(): BrowserCapturePackage {
  return {
    format: "tourkit-browser-capture", version: 1, id: "fixture", title: "Captured form",
    createdAt: "2026-10-30T00:00:00.000Z", updatedAt: "2026-10-30T00:00:00.000Z",
    engine: { name: "rrweb", version: "2.2.0" }, viewport: { width: 1280, height: 720 },
    privacy: { mode: "unreviewed" }, pages: [{ id: "page-1", origin: "https://example.test", path: "/forms" }],
    events: [
      { type: 4, timestamp: 1000, data: { href: "https://example.test/forms", width: 1280, height: 720 } },
      { type: 2, timestamp: 1001, data: { node: { type: 0, id: 1, childNodes: [
        { type: 2, tagName: "html", id: 2, attributes: {}, childNodes: [
          { type: 2, tagName: "head", id: 3, attributes: {}, childNodes: [] },
          { type: 2, tagName: "body", id: 4, attributes: {}, childNodes: [
            { type: 2, tagName: "input", id: 5, attributes: { type: "text", value: "Recorded" }, childNodes: [] },
          ] },
        ] },
      ] }, initialOffset: { left: 0, top: 0 } } },
      { type: 5, timestamp: 2000, data: { tag: "end", payload: null } },
    ],
    steps: [{ id: "step-1", title: "Enter a name", instruction: "Type a practice name.", atMs: 10, afterMs: 900, action: "input", sourceDocumentId: "page-1", target: { nodeId: 5, documentId: "page-1" } }],
    warnings: [],
  };
}

describe("portable browser capture validation", () => {
  it("round trips engine data without claiming that a recording is synthetic", () => {
    const capture = fixture();
    expect(parseBrowserCapture(serializeBrowserCapture(capture))).toEqual(capture);
    expect(captureDuration(capture)).toBe(1000);
    expect(parseBrowserCapture(capture).privacy.mode).toBe("unreviewed");
    expect(serializeBrowserCapture(capture)).not.toContain("syntheticDataOnly");
  });

  it("rejects duplicate IDs, dangling references and invalid timeline bounds", () => {
    const duplicate = fixture(); duplicate.steps.push({ ...duplicate.steps[0]! });
    expect(() => parseBrowserCapture(duplicate)).toThrow(/Duplicate step/);
    const missing = fixture(); missing.steps[0]!.target!.documentId = "missing";
    expect(() => parseBrowserCapture(missing)).toThrow(/Unknown source/);
    const pastEnd = fixture(); pastEnd.steps[0]!.atMs = 5000;
    expect(() => parseBrowserCapture(pastEnd)).toThrow(/outside/);
    const unsorted = fixture(); unsorted.events[2]!.timestamp = 999;
    expect(() => parseBrowserCapture(unsorted)).toThrow(/ordered/);
    const empty = fixture(); empty.events = [empty.events[0]!];
    expect(() => parseBrowserCapture(empty)).toThrow(/full DOM snapshot/);
  });

  it("bounds nested data and refuses prototype keys before parsing an engine event", () => {
    const deep = fixture();
    let nested: JsonValue = null;
    for (let i = 0; i < 170; i++) nested = { child: nested };
    deep.events[2]!.data = nested;
    expect(() => parseBrowserCapture(deep)).toThrow(/nesting/);
    const unsafe = serializeBrowserCapture(fixture()).replace('"payload":null', '"payload":{"__proto__":{"polluted":true}}');
    expect(() => parseBrowserCapture(unsafe)).toThrow(/unsafe JSON property/);
    expect(() => parseBrowserCapture(fixture(), { maxBytes: 100 })).toThrow(/size/);
  });

  it("strips query/fragment/credentials from source metadata and rejects unsanitized pages", () => {
    expect(sanitizeCaptureSourceUrl("https://user:password@example.test/forms?token=private#value")).toEqual({ origin: "https://example.test", path: "/forms" });
    const capture = fixture(); capture.pages![0]!.path += "?token=private";
    expect(() => parseBrowserCapture(capture)).toThrow(/origin and path/);
    expect(() => sanitizeCaptureSourceUrl("chrome://settings")).toThrow(/HTTP/);
  });

  it("removes the original image behind a redacted screenshot from portable output", () => {
    const capture = fixture();
    capture.steps[0]!.screenshot = { dataUrl: png, width: 1, height: 1, alt: "Redacted image", sourceDataUrl: png, sourceWidth: 1, sourceHeight: 1 };
    const parsed = parseBrowserCapture(capture);
    expect(parsed.steps[0]!.screenshot).not.toHaveProperty("sourceDataUrl");
    expect(capture.steps[0]!.screenshot).toHaveProperty("sourceDataUrl");
  });

  it("rejects executable and SVG assets, but permits CSS for controlled inlining", () => {
    const capture = fixture();
    capture.assets = [{ id: "css", url: "urn:tourkit:asset:css", mime: "text/css", dataUrl: "data:text/css;base64,Ym9keXtjb2xvcjpyZWR9" }];
    expect(parseBrowserCapture(capture).assets).toHaveLength(1);
    capture.assets[0] = { id: "code", url: "source", mime: "text/javascript", dataUrl: "data:text/javascript;base64,YWxlcnQoMSk=" };
    expect(() => parseBrowserCapture(capture)).toThrow();
  });
});

describe("browser capture package archive", () => {
  it("imports the JSON or ZIP form, including UTF-8 content", async () => {
    const capture = fixture(); capture.title = "واجهة التدريب — Practice";
    expect(await importBrowserCapture(serializeBrowserCapture(capture))).toEqual(capture);
    const blob = await exportBrowserCaptureZip(capture);
    expect(await importBrowserCapture(blob)).toEqual(capture);
  });

  it("rejects traversal entries and unrelated ZIP files", async () => {
    const zip = new JSZip();
    zip.file("../capture.json", serializeBrowserCapture(fixture()), { createFolders: false });
    await expect(importBrowserCapture(await zip.generateAsync({ type: "uint8array" }))).rejects.toThrow(/Unexpected/);
    const other = new JSZip(); other.file("index.html", "<script>evil()</script>");
    await expect(importBrowserCapture(await other.generateAsync({ type: "uint8array" }))).rejects.toThrow(/Unexpected/);
  });

  it("checks both central-directory bounds and decompressed integrity", async () => {
    const bytes = new Uint8Array(await (await exportBrowserCaptureZip(fixture())).arrayBuffer());
    const view = new DataView(bytes.buffer);
    let central = 0;
    while (view.getUint32(central, true) !== 0x02014b50) central++;
    view.setUint32(central + 24, 0x7fffffff, true);
    await expect(importBrowserCapture(bytes)).rejects.toThrow(/size limit/);
    const broken = new Uint8Array(await (await exportBrowserCaptureZip(fixture())).arrayBuffer());
    const brokenView = new DataView(broken.buffer);
    central = 0;
    while (brokenView.getUint32(central, true) !== 0x02014b50) central++;
    brokenView.setUint32(central + 16, 0, true);
    await expect(importBrowserCapture(broken)).rejects.toThrow(/integrity/);
  });
});

describe("safe DOM replay copy", () => {
  it("removes scripts, frame HTML, handlers and external sources before construction", () => {
    const capture = fixture();
    const snapshot = capture.events[1]!.data as { node: { childNodes: { childNodes: { childNodes: JsonValue[] }[] }[] } };
    const head = snapshot.node.childNodes[0]!.childNodes[0]!;
    const body = snapshot.node.childNodes[0]!.childNodes[1]!;
    head.childNodes.push({ type: 2, tagName: "meta", id: 10, attributes: { "http-equiv": "refresh", content: "0;url=https://example.test/write" }, childNodes: [] });
    body.childNodes.push(
      { type: 2, tagName: "script", id: 11, attributes: { src: "https://example.test/evil.js" }, childNodes: [{ type: 3, id: 12, textContent: "evil()" }] },
      { type: 2, tagName: "iframe", id: 13, attributes: { src: "https://example.test", srcdoc: "<script>evil()</script>", onload: "evil()" }, childNodes: [] },
      { type: 2, tagName: "img", id: 14, attributes: { src: "https://example.test/pixel", srcset: "https://example.test/2x 2x", onerror: "evil()" }, childNodes: [] },
    );
    const safe = JSON.stringify(sanitizeCaptureEventsForReplay(capture.events));
    expect(safe).toContain(BROWSER_CAPTURE_CSP);
    expect(safe).not.toContain("evil()");
    expect(safe).not.toContain("evil.js");
    expect(safe).not.toContain("https://example.test/pixel");
    expect(safe).not.toContain("srcdoc");
    expect(safe).toContain('"src":"about:blank"');
    expect(JSON.stringify(capture.events)).toContain("evil()");
  });

  it("inlines captured styles and raster assets with no dependence on the origin", () => {
    const capture = fixture();
    const snapshot = capture.events[1]!.data as { node: { childNodes: { childNodes: { childNodes: JsonValue[] }[] }[] } };
    snapshot.node.childNodes[0]!.childNodes[0]!.childNodes.push({ type: 2, tagName: "link", id: 20, attributes: { rel: "stylesheet", href: "urn:tourkit:asset:css" }, childNodes: [] });
    const css = 'body{background:url("urn:tourkit:asset:png")}@import url("https://example.test/not-captured.css");';
    const result = sanitizeCaptureEventsForReplay(capture.events, [
      { id: "css", url: "urn:tourkit:asset:css", mime: "text/css", dataUrl: `data:text/css;base64,${btoa(css)}` },
      { id: "png", url: "urn:tourkit:asset:png", mime: "image/png", dataUrl: png },
    ]);
    const text = JSON.stringify(result);
    expect(text).toContain('"tagName":"style"');
    expect(text).toContain(png);
    expect(text).not.toContain("not-captured.css");
  });

  it("preserves rrweb inlineStylesheet link nodes that have _cssText instead of href/rel", () => {
    const capture = fixture();
    const snapshot = capture.events[1]!.data as { node: { childNodes: { childNodes: { childNodes: JsonValue[] }[] }[] } };
    snapshot.node.childNodes[0]!.childNodes[0]!.childNodes.push({ type: 2, tagName: "link", id: 20, attributes: { _cssText: 'body{background:rgb(1,2,3);background-image:url("https://source.invalid/private")}' }, childNodes: [] });
    const text = JSON.stringify(sanitizeCaptureEventsForReplay(capture.events));
    expect(text).toContain('"tagName":"style"');
    expect(text).toContain("background:rgb(1,2,3)");
    expect(text).not.toContain("https://source.invalid/private");
  });

  it("never replays canvas commands or unknown plugins", () => {
    const result = sanitizeCaptureEventsForReplay([
      { type: 3, timestamp: 10, data: { source: 9, commands: [{ property: "drawImage", args: ["https://example.test"] }] } },
      { type: 6, timestamp: 20, data: { plugin: "remote-plugin", payload: {} } },
    ]);
    expect(result.every((event) => event.type === 5)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("drawImage");
  });
});
