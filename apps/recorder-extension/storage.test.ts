import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { appendChunk, deleteSession, getSession, putAsset, putSession, sessionCapture, updateSession } from "./storage";
import { DEFAULT_BROWSER_CAPTURE_LIMITS } from "../../browser-capture/types";
import { resourceKey } from "./privacy";
import type { RecordingSession } from "./protocol";

function session(): RecordingSession {
  return {
    id: crypto.randomUUID(), title: "Recorder integration fixture", createdAt: "2026-10-30T00:00:00.000Z", updatedAt: "2026-10-30T00:00:00.000Z",
    status: "stopped", tabId: 4, settings: { screenshots: true, privateSelector: "", advanced: false },
    viewport: { width: 800, height: 600 }, pages: [{ id: "doc-a", origin: "https://example.com", path: "/forms" }],
    steps: [{ id: "step-a", title: "Create", instruction: "Select Create.", action: "click", at: 120, afterAt: 150, sourceDocumentId: "doc-a", target: { nodeId: 4, documentId: "doc-a" } }],
    warnings: [], eventCount: 0, eventBytes: 0, assetBytes: 0, screenshotBytes: 0, missingAssetOrigins: [],
  };
}

describe("durable extension recordings", () => {
  it("acknowledges duplicate chunks once and preserves simultaneous session edits", async () => {
    const source = session(); await putSession(source);
    const chunk = { id: `${source.id}:one`, sessionId: source.id, documentId: "doc-a", events: [{ type: 4, timestamp: 100, data: { href: "https://capture.invalid", width: 800, height: 600 } }] };
    await Promise.all([appendChunk(chunk), appendChunk(chunk), updateSession(source.id, (draft) => { draft.title = "Renamed while recording"; })]);
    const stored = await getSession(source.id);
    expect(stored?.eventCount).toBe(1);
    expect(stored?.title).toBe("Renamed while recording");
    expect(stored?.steps).toHaveLength(1);
    await deleteSession(source.id);
  });

  it("exports a validated package with relative pre/post checkpoints and recoverable chunks", async () => {
    const source = session(); await putSession(source);
    await appendChunk({ id: `${source.id}:first`, sessionId: source.id, documentId: "doc-a", events: [
      { type: 5, timestamp: 99, data: { tag: "tourkit-document", payload: { documentId: "doc-a" } } },
      { type: 4, timestamp: 100, data: { href: "https://capture.invalid", width: 800, height: 600 } },
      { type: 2, timestamp: 110, data: { node: { type: 0, id: 1, childNodes: [{ type: 2, id: 2, tagName: "html", attributes: {}, childNodes: [{ type: 2, id: 3, tagName: "body", attributes: {}, childNodes: [{ type: 2, id: 4, tagName: "button", attributes: {}, childNodes: [] }] }] }] }, initialOffset: { top: 0, left: 0 } } },
    ] });
    const capture = await sessionCapture(source.id);
    expect(capture.steps[0]).toMatchObject({ atMs: 21, afterMs: 51, sourceDocumentId: "doc-a" });
    expect(capture.events.at(-1)?.timestamp).toBe(150);
    expect(capture.privacy.mode).toBe("masked");
    expect(capture.events.filter((event) => event.type === 2)).toHaveLength(1);
    await deleteSession(source.id);
    expect(await getSession(source.id)).toBeUndefined();
    await expect(sessionCapture(source.id)).rejects.toThrow("no longer exists");
  });

  it("rejects a chunk before the portable event limit and preserves acknowledged data", async () => {
    const source = session();
    source.eventCount = DEFAULT_BROWSER_CAPTURE_LIMITS.maxEvents - 1;
    await putSession(source);
    await expect(appendChunk({ id: `${source.id}:over-limit`, sessionId: source.id, documentId: "doc-a", events: [
      { type: 5, timestamp: 160, data: { tag: "tourkit-checkpoint", payload: {} } },
    ] })).rejects.toThrow("event limit");
    expect((await getSession(source.id))?.eventCount).toBe(DEFAULT_BROWSER_CAPTURE_LIMITS.maxEvents - 1);
    expect((await getSession(source.id))?.eventBytes).toBe(0);
    await deleteSession(source.id);
  });

  it("excludes resources marked private during capture and rejects their later persistence", async () => {
    const source = session(); await putSession(source);
    await appendChunk({ id: `${source.id}:snapshot`, sessionId: source.id, documentId: "doc-a", events: [
      { type: 2, timestamp: 100, data: { node: { type: 0, id: 1, childNodes: [] }, initialOffset: { top: 0, left: 0 } } },
    ] });
    const url = resourceKey("https://example.com/private.png?signature=private");
    const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jMZkAAAAASUVORK5CYII=";
    const asset = { id: `${source.id}:private`, sessionId: source.id, url, mime: "image/png", dataUrl, bytes: dataUrl.length };
    expect(await putAsset(asset)).toBe(true);
    await updateSession(source.id, (draft) => { draft.blockedResourceKeys = [url]; });
    expect(await putAsset({ ...asset, id: `${source.id}:private-later` })).toBe(false);
    const capture = await sessionCapture(source.id);
    expect(capture.assets).toEqual([]);
    expect(JSON.stringify(capture)).not.toContain(dataUrl);
    await deleteSession(source.id);
  });
});
