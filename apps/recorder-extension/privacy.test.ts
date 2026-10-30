import { describe, expect, it } from "vitest";
import type { BrowserCaptureEvent } from "../../browser-capture/types";
import { createCapturePrivacyState, privatizeEvent, privateResourceKey, redactionRects, resourceKey, rewriteCss, safeSource } from "./privacy";

describe("recorder privacy boundary", () => {
  it("keeps signed resource variants distinct without retaining tokens or credentials", () => {
    const first = resourceKey("https://user:pass@example.com/image.png?token=first#secret");
    const second = resourceKey("https://user:pass@example.com/image.png?token=second#secret");
    expect(first).toMatch(/^https:\/\/capture\.invalid\/assets\/[0-9a-f]{16}$/);
    expect(first).not.toBe(second);
    expect(resourceKey(first)).toBe(first);
    expect(safeSource("https://user:pass@example.com/forms?patient=123#private")).toEqual({ origin: "https://example.com", path: "/forms" });
  });

  it("removes DOM and mutation input values and rewrites CSS/font/image references before persistence", () => {
    const resources: string[] = [];
    const event = privatizeEvent({ type: 2, timestamp: 123, data: {
      node: { type: 0, id: 1, childNodes: [
        { type: 2, id: 2, tagName: "input", attributes: { value: "never store me", "data-access-token": "SECRET", oninput: "evil()" }, childNodes: [] },
        { type: 2, id: 3, tagName: "img", attributes: { src: "/patient.png?signature=SECRET" }, childNodes: [] },
        { type: 2, id: 4, tagName: "style", attributes: {}, childNodes: [{ type: 3, id: 5, textContent: '.x { background:url("/tile.png?secret=SECRET") }' }] },
      ] },
    } }, "https://example.com/app", (url) => resources.push(url));
    expect(JSON.stringify(event)).not.toContain("never store me");
    expect(JSON.stringify(event)).not.toContain("SECRET");
    expect(JSON.stringify(event)).not.toContain("evil()");
    expect(resources).toContain("https://example.com/patient.png?signature=SECRET");
    expect(resources).toContain("https://example.com/tile.png?secret=SECRET");
    expect(privatizeEvent({ type: 3, timestamp: 124, data: { source: 5, id: 2, text: "PRIVATE", isChecked: false } }, "https://example.com").data).toEqual({ source: 5, id: 2, text: "••••", isChecked: false });
    expect(JSON.stringify(privatizeEvent({ type: 3, timestamp: 125, data: { source: 0, attributes: [{ id: 2, attributes: { value: "PRIVATE" } }] } }, "https://example.com"))).not.toContain("PRIVATE");
  });

  it("resolves relative CSS resources against their stylesheet, and leaves embedded fragments alone", () => {
    const resources: string[] = [];
    const output = rewriteCss('@import "theme.css?v=SECRET"; @font-face{src:url(../fonts/a.woff2?t=SECRET)} .x{filter:url(#local)}', "https://cdn.example.com/css/base.css", (url) => resources.push(url));
    expect(resources).toEqual(["https://cdn.example.com/css/theme.css?v=SECRET", "https://cdn.example.com/fonts/a.woff2?t=SECRET"]);
    expect(output).not.toContain("SECRET");
    expect(output).toContain('url("#local")');
  });

  it("handles escaped URL tokens, image-set and import strings without retaining signed URLs", () => {
    const urls: string[] = [];
    const css = String.raw`/* SECRET in a discarded comment */ @im\70ort "theme.css?token=SECRET";
      .one { background: u\72l("https://cdn.example.com/a.png?token=SECRET") }
      .two { background: image-set("/b.png?token=SECRET" 1x, u\000072l('/c.png?token=SECRET') 2x) }
      .three { background: -webkit-image-set('https://cdn.example.com/d.png?token=SECRET' 1x) }
      .four { background: url('data:text/html,<script>SECRET</script>') }`;
    const rewritten = rewriteCss(css, "https://example.com/css/base.css", (url) => urls.push(url));
    expect(rewritten).not.toContain("SECRET");
    expect(rewritten).not.toContain("data:text/html");
    expect(rewritten).not.toContain(String.raw`u\72l`);
    expect(urls).toHaveLength(5);
    expect(urls).toContain("https://example.com/c.png?token=SECRET");
  });

  it("drops raw iframe HTML and executable data URLs, and redacts every rrweb CSS mutation shape", () => {
    const state = createCapturePrivacyState();
    const first = privatizeEvent({ type: 2, timestamp: 1, data: { node: { type: 0, id: 1, childNodes: [
      { type: 2, id: 2, tagName: "iframe", attributes: { srcdoc: '<input value="SECRET"><script>SECRET</script>', src: "data:text/html,SECRET" }, childNodes: [] },
      { type: 2, id: 3, tagName: "style", attributes: {}, childNodes: [{ type: 3, id: 4, textContent: ".x{color:red}" }] },
    ] } } }, "https://example.com", undefined, state);
    expect(JSON.stringify(first)).not.toContain("SECRET");
    const events: BrowserCaptureEvent[] = [
      { type: 3, timestamp: 2, data: { source: 0, attributes: [{ id: 9, attributes: { style: { "background-image": ['url("/a.png?token=SECRET")', "important"] } } }] } },
      { type: 3, timestamp: 3, data: { source: 0, texts: [{ id: 4, value: '.x{background:url("/b.png?token=SECRET")}' }] } },
      { type: 3, timestamp: 4, data: { source: 13, id: 3, set: { property: "background-image", value: 'url("/c.png?token=SECRET")', priority: "" } } },
      { type: 3, timestamp: 5, data: { source: 0, adds: [{ parentId: 3, node: { type: 3, id: 10, textContent: '.x{background:url("/d.png?token=SECRET")}' } }] } },
    ];
    for (const event of events) expect(JSON.stringify(privatizeEvent(event, "https://example.com", undefined, state))).not.toContain("SECRET");
  });

  it("excludes private image resources from DOM references and CSS, including embedded bytes", () => {
    const privateUrl = "https://example.com/private.png?token=SECRET";
    const embedded = "data:image/png;base64,U0VDUkVU";
    const blocked = new Set([privateResourceKey(privateUrl), privateResourceKey(embedded)]);
    const allow = (url: string) => !blocked.has(privateResourceKey(url));
    const event = privatizeEvent({ type: 2, timestamp: 1, data: { node: {
      type: 2, id: 2, tagName: "img", attributes: { src: privateUrl }, childNodes: [],
    } } }, "https://example.com", allow);
    expect(JSON.stringify(event)).not.toContain(resourceKey(privateUrl));
    const css = rewriteCss(`.one{background:url("${privateUrl}")}.two{background:image-set("${embedded}" 1x)}`, "https://example.com", allow);
    expect(css).not.toContain("SECRET");
    expect(css).not.toContain("U0VDUkVU");
    expect(css).not.toContain(resourceKey(privateUrl));
  });

  it("expands, scales and clips screenshot masks instead of exposing edge pixels", () => {
    expect(redactionRects([{ x: 10, y: 10, width: 20, height: 10 }, { x: -100, y: -100, width: 1, height: 1 }], 100, 100, 2, 2)).toEqual([
      { x: 12, y: 12, width: 56, height: 36 },
    ]);
    expect(redactionRects([{ x: NaN, y: 0, width: 3, height: 3 }], 100, 100)).toEqual([]);
  });
});
