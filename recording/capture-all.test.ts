// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { createTutorialRecordingDraft, insertDraftStep, tutorialRecordingDraftToManifest } from "./draft";
import type { TutorialRecordingDraft } from "./types";
import type { TutorialScreenshot } from "../core/screenshot";
import { TUTORIAL_CAPTURE_PROTOCOL } from "./capture-protocol";
import { captureMissingTutorialScreenshots } from "./capture-all";

const mocks = vi.hoisted(() => ({ put: vi.fn(), remove: vi.fn(), capture: vi.fn() }));
vi.mock("./draft-store", () => ({ createDefaultTutorialDraftStore: () => ({ put: mocks.put, delete: mocks.remove }) }));
vi.mock("./capture-interface", () => ({ captureTutorialInterface: mocks.capture }));

afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

it("replays text-only actions, skips static explanations, and captures only the pictured step", async () => {
  let draft = insertDraftStep(createTutorialRecordingDraft({ title: "Mixed capture" }), null);
  draft.steps[0].screenshotMode = "none";
  const explanationId = draft.steps[0].id;
  draft = insertDraftStep(draft, explanationId);
  draft.steps[1].screenshotMode = "none";
  draft.steps[1].action = { id: "builder.addField", resultAlias: "field", match: "subset" };
  draft = insertDraftStep(draft, draft.steps[1].id);
  draft.steps[2].action = { id: "builder.selectField", args: { id: { $ref: "field.id" } }, match: "subset" };
  const image: TutorialScreenshot = { dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=", width: 1, height: 1, alt: "Synthetic interface" };
  mocks.capture.mockResolvedValue(image);
  const onScreenshot = vi.fn();
  const drawOverlay = vi.fn();
  const append = document.body.append.bind(document.body);
  const acknowledgments: string[] = [];
  vi.spyOn(document.body, "append").mockImplementation((...nodes) => {
    const frame = nodes[0] as HTMLIFrameElement;
    // The fixture handshake is simulated below; do not navigate happy-dom.
    frame.removeAttribute("src");
    frame.srcdoc = "";
    append(...nodes);
    const stored = mocks.put.mock.calls[0][0] as TutorialRecordingDraft;
    const token = stored.id.slice("capture-".length);
    // Validate the actual saved replay draft, as the fixture loader does.
    const replay = tutorialRecordingDraftToManifest(stored);
    const steps = replay.chapters.flatMap((chapter) => chapter.steps);
    expect(steps.map((step) => step.id)).toEqual(draft.steps.slice(1).map((step) => step.id));
    expect(steps[0].action?.resultAlias).toBe("field");
    let index = 0;
    const send = (type: "step" | "complete", stepId?: string) => window.dispatchEvent(new MessageEvent("message", {
      source: frame.contentWindow!, origin: window.location.origin,
      data: { protocol: TUTORIAL_CAPTURE_PROTOCOL, token, type, stepId },
    }));
    vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation((message) => {
      acknowledgments.push(message.stepId);
      index += 1;
      queueMicrotask(() => send(index < steps.length ? "step" : "complete", steps[index]?.id));
    });
    queueMicrotask(() => send("step", steps[0].id));
  });
  await captureMissingTutorialScreenshots({ draft }, { signal: new AbortController().signal, onScreenshot, onProgress: vi.fn(), drawOverlay });
  expect(acknowledgments).toEqual(draft.steps.slice(1).map((step) => step.id));
  expect(mocks.capture).toHaveBeenCalledTimes(1);
  expect(drawOverlay).toHaveBeenCalledTimes(1);
  expect(onScreenshot).toHaveBeenCalledExactlyOnceWith(draft.steps[2].id, expect.objectContaining({ ...image,
    provenance: expect.objectContaining({ engine: "dom", stepFingerprint: expect.stringMatching(/^s1-/) }) }));
  expect(draft.steps[0].id).toBe(explanationId);
  expect(draft.steps).toHaveLength(3);
  expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(mocks.put.mock.calls[0][0].id);
  expect(document.querySelector('iframe[title="Tutorial screenshot capture"]')).toBeNull();
});


