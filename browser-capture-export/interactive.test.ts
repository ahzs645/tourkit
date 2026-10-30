// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { browserCaptureInteractiveHtml, createBrowserCaptureInteractiveExporter, createDefaultBrowserCaptureInteractiveExporter } from "./interactive";
import { createCaptureStudioSample } from "../browser-capture-studio/sample";

const runtime = { version: 1 as const, javascript: "window.tourkitReady = true;", css: "body{margin:0}" };
const publishablePng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=";
const originalPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

describe("portable interactive capture export", () => {
  it("keeps captured markup and malicious titles in inert JSON and strips original screenshot pixels", () => {
    const capture = createCaptureStudioSample();
    capture.title = '</title><script>window.injected=true</script>';
    capture.steps[0]!.instruction = '</script><img src="https://unwanted.invalid/pixel">';
    capture.steps[0]!.screenshot = {
      dataUrl: publishablePng, width: 1, height: 1, alt: "Publishable image",
      sourceDataUrl: originalPng, sourceWidth: 1, sourceHeight: 1,
    };
    const html = browserCaptureInteractiveHtml(capture, runtime);
    expect(html).toContain("&lt;/title&gt;&lt;script&gt;");
    expect(html).not.toContain('<script>window.injected=true</script>');
    expect(html).not.toContain('src="https://unwanted.invalid');
    expect(html).not.toContain("sourceDataUrl");
    expect(html).not.toContain(originalPng);
    expect(html).toContain(publishablePng);
    expect(html).toContain("connect-src 'none'");
    const data = html.match(/<script id="tourkit-capture-data" type="application\/json">([\s\S]*?)<\/script>/)![1]!;
    expect(JSON.parse(data).title).toBe(capture.title);
    expect(JSON.parse(data).steps[0].instruction).toBe(capture.steps[0]!.instruction);
  });

  it("retries a failed runtime load, caches a successful bundle and reports missing bundles", async () => {
    const loadRuntime = vi.fn().mockRejectedValueOnce(new Error("Bundle unavailable")).mockResolvedValue(runtime);
    const exportCapture = createBrowserCaptureInteractiveExporter({ loadRuntime });
    await expect(exportCapture(createCaptureStudioSample())).rejects.toThrow("Bundle unavailable");
    const blob = await exportCapture(createCaptureStudioSample());
    expect(blob.type).toBe("text/html;charset=utf-8");
    expect(await blob.text()).toContain(runtime.javascript);
    await exportCapture(createCaptureStudioSample());
    expect(loadRuntime).toHaveBeenCalledTimes(2);
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("missing", { status: 404 }));
    try {
      await expect(createDefaultBrowserCaptureInteractiveExporter("https://example.invalid/player-runtime.json")(createCaptureStudioSample())).rejects.toThrow("404");
    } finally { fetcher.mockRestore(); }
  });

  it("requires a valid capture and a trusted bundled runtime", () => {
    expect(() => browserCaptureInteractiveHtml(createCaptureStudioSample(), { ...runtime, javascript: "" })).toThrow("bundled");
    expect(() => browserCaptureInteractiveHtml({ ...createCaptureStudioSample(), version: 2 } as never, runtime)).toThrow();
  });
});
