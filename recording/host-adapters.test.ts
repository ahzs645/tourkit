import { describe, expect, it } from "vitest";
import type { TutorialActionEvent } from "../core/actions";
import { actionEventForRecording } from "./action-source";
import type { TutorialCheckSuggestionProvider } from "./check-suggestions";
import { applyCaptureToDraft, createTutorialRecordingDraft, mergeCaptureIntoDraft, suggestedCheckForStep, tutorialRecordingDraftToManifest } from "./draft";
import type { TutorialCapture } from "./types";

/** An unrelated host: a project board supplies its own state and outcomes. */
const boards: TutorialCheckSuggestionProvider = {
  forLaunch(launch) {
    let board = launch.hash.board ?? "inbox";
    return {
      suggest(action) {
        if (!action) return { reason: "no-action" };
        if (action.id !== "projects.openBoard" || typeof action.args?.board !== "string") return { reason: "unsupported-action" };
        if (action.args.board === board) return { reason: "already-satisfied" };
        return { check: { description: "the requested project board is open", all: [{ path: "project.board", equals: action.args.board, mode: "absolute" }] } };
      },
      apply(action) { if (action?.id === "projects.openBoard" && typeof action.args?.board === "string") board = action.args.board; },
    };
  },
};

const recording: TutorialCapture = {
  startedAt: "2026-10-26T00:00:00.000Z", durationMs: 2000, warnings: [],
  actions: [
    { id: "projects.openBoard", args: { board: "review" }, atMs: 100 },
    { id: "projects.openBoard", args: { board: "review" }, atMs: 1000 },
  ],
};

describe("application-independent recording adapters", () => {
  it("records and compiles arbitrary semantic actions without inventing app-specific checks", () => {
    const empty = createTutorialRecordingDraft();
    expect(empty.launch).toEqual({ fixture: "tutorial-fixture", path: "/", hash: {} });
    const draft = applyCaptureToDraft(empty, recording);
    expect(draft.steps.every((step) => step.check === undefined)).toBe(true);
    const manifest = tutorialRecordingDraftToManifest(draft);
    expect(manifest.chapters[0].steps.map((step) => step.action?.id)).toEqual(["projects.openBoard", "projects.openBoard"]);
  });

  it("uses the injected projection before each action and does not share it between recordings", () => {
    const empty = createTutorialRecordingDraft({ fixture: "projects-demo", path: "/projects/", hash: { board: "inbox" } });
    const draft = applyCaptureToDraft(empty, recording, "practice", new Date(recording.startedAt), boards);
    expect(draft.steps[0].check?.all).toEqual([{ path: "project.board", equals: "review", mode: "absolute" }]);
    expect(draft.steps[1].check).toBeUndefined();
    expect(suggestedCheckForStep(draft, draft.steps[1].id, boards)).toEqual({ reason: "already-satisfied" });
    const again = applyCaptureToDraft(empty, recording, "practice", new Date(recording.startedAt), boards);
    expect(again.steps[0].check).toEqual(draft.steps[0].check);
    expect(suggestedCheckForStep(draft, draft.steps[0].id)).toEqual({ reason: "unsupported-action" });
  });

  it("projects existing steps before an appended segment without replacing existing narration", () => {
    const initial = applyCaptureToDraft(createTutorialRecordingDraft(), { ...recording, actions: recording.actions.slice(0, 1) }, "practice", new Date(recording.startedAt), boards);
    initial.audio = { blob: new Blob(["narration"], { type: "audio/webm" }), mimeType: "audio/webm", durationMs: 2000 };
    const appended = mergeCaptureIntoDraft(initial, { ...recording, actions: recording.actions.slice(1) }, "append", new Date(recording.startedAt), boards);
    expect(appended.steps).toHaveLength(2);
    expect(appended.steps[1].check).toBeUndefined();
    expect(appended.audio).toBe(initial.audio);
    expect(initial.steps).toHaveLength(1);
  });

  it("keeps anchor inference local to each caller", () => {
    const event: TutorialActionEvent = { action: "projects.openBoard", payload: { board: "review" }, source: "user", timestamp: 1, sequence: 1 };
    expect(actionEventForRecording(event).anchor).toBeUndefined();
    expect(actionEventForRecording(event, (_id, args) => `board.${args?.board}`).anchor).toBe("board.review");
    expect(actionEventForRecording(event, () => "another-app.target").anchor).toBe("another-app.target");
    expect(actionEventForRecording(event).anchor).toBeUndefined();
  });
});
