// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { parseBrowserCapture, serializeBrowserCapture } from "../browser-capture/validation";
import { importBrowserCapture, exportBrowserCaptureZip } from "../browser-capture/archive";
import { createCaptureStudioSample } from "./sample";
import { moveCaptureStep, removeCaptureStep, replaceCaptureTargetText, updateCaptureStep } from "./model";
import { captureReadingHtml, captureReadingMarkdown } from "./reading-export";

describe("captured-website authoring", () => {
  it("keeps reordered checkpoints, repaired targets, copy edits and privacy classification through a portable package", async () => {
    const original = createCaptureStudioSample();
    original.privacy = { mode: "unreviewed" };
    let edited = updateCaptureStep(original, "save", { title: "Save this project", instruction: "Confirm the project name, then create it.", target: { nodeId: 24, documentId: "sample", label: "Create project" } });
    edited = moveCaptureStep(edited, "save", -1);
    edited = removeCaptureStep(edited, "result");
    const reimported = await importBrowserCapture(await exportBrowserCaptureZip(edited));
    expect(reimported.steps.map((step) => step.id)).toEqual(["open", "save", "name"]);
    expect(reimported.steps[1]).toMatchObject({ atMs: 3002, title: "Save this project", target: { nodeId: 24 } });
    expect(reimported.events).toEqual(original.events);
    expect(reimported.privacy.mode).toBe("unreviewed");
    expect(JSON.stringify(reimported)).not.toContain("syntheticDataOnly");
    expect(original.steps[2]!.title).toBe("Create the project");
  });

  it("persists a target text edit in recorded DOM without pretending screenshots were redacted", () => {
    const original = createCaptureStudioSample();
    const edited = replaceCaptureTargetText(original, "open", "Create a plan");
    expect(serializeBrowserCapture(edited)).toContain("Create a plan");
    expect(JSON.stringify(original.events)).not.toContain("Create a plan");
    expect(edited.warnings).toContainEqual(expect.objectContaining({ code: "edited-interface-screenshots", stepId: "open" }));
    expect(edited.privacy.mode).toBe("unreviewed");
    expect(parseBrowserCapture(edited).events).toEqual(edited.events);
  });

  it("does not turn a display-data edit into a required learner answer", () => {
    const edited = replaceCaptureTargetText(createCaptureStudioSample(), "name", "A new baseline");
    expect(JSON.stringify(edited.events)).toContain("A new baseline");
    expect(edited.steps.find((step) => step.id === "name")!.value).toBeUndefined();
  });

  it("edits repeated checkpoints of one document without changing a reused node ID on another page", () => {
    const capture = createCaptureStudioSample();
    const start = capture.events[0]!.timestamp;
    const firstSnapshot = capture.events.find((event) => event.type === 2)!;
    capture.events = [
      capture.events[0]!,
      { type: 5, timestamp: start, data: { tag: "tourkit-document", payload: { documentId: "sample" } } },
      ...capture.events.slice(1),
      { type: 4, timestamp: start + 5000, data: { href: "https://example.invalid/projects", width: 1024, height: 700 } },
      { ...firstSnapshot, timestamp: start + 5001 },
      { type: 5, timestamp: start + 6000, data: { tag: "tourkit-document", payload: { documentId: "second" } } },
      { ...firstSnapshot, timestamp: start + 6001 },
    ];
    capture.pages!.push({ id: "second", origin: "https://example.invalid", path: "/second" });
    const edited = replaceCaptureTargetText(capture, "open", "Make another plan");
    expect(JSON.stringify(edited.events.find((event) => event.timestamp === start + 5001))).toContain("Make another plan");
    expect(JSON.stringify(edited.events.at(-1))).not.toContain("Make another plan");
    expect(JSON.stringify(edited.events.at(-1))).toContain("New project");
    capture.steps[0]!.target!.documentId = "second";
    expect(() => replaceCaptureTargetText(capture, "open", "Wrong page")).toThrow("another captured document");
  });

  it("escapes authored markup in reading exports", () => {
    const capture = createCaptureStudioSample();
    capture.title = '<script>alert("title")</script>';
    capture.steps[0]!.instruction = '<img src=x onerror="alert(1)">';
    const html = captureReadingHtml(capture);
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
    expect(captureReadingMarkdown(capture)).toContain('\\<script\\>');
  });
});
