import { describe, expect, it, vi } from "vitest";
import { Window, HTMLButtonElement } from "happy-dom";
import { SCORM_PLAYER, tutorialHtml } from "./html";
import type { TutorialDocument } from "./document";

const doc: TutorialDocument = { title: "Read a guide", description: "Synthetic tutorial", estimatedMinutes: 2,
  chapters: [{ title: "Start", steps: [1, 2, 3].map((number) => ({ number, title: `Step ${number}`, instruction: "Read this" })) }] };

function page() {
  // Execute only our bundled player script, never imported tutorial text.
  const window = new Window({ settings: { enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true } });
  window.document.body.innerHTML = tutorialHtml(doc, true);
  return { window };
}

function launch(saved: Record<string, string> = {}, initializes = true) {
  const values: Record<string, string> = { "cmi.core.lesson_status": "not attempted", ...saved };
  const api = {
    LMSInitialize: vi.fn(() => String(initializes)),
    LMSGetValue: vi.fn((key: string) => values[key] ?? ""),
    LMSSetValue: vi.fn((key: string, value: string) => { values[key] = value; return "true"; }),
    LMSCommit: vi.fn(() => "true"), LMSFinish: vi.fn(() => "true"),
  };
  const dom = page();
  Object.assign(dom.window, { API: api });
  dom.window.eval(SCORM_PLAYER);
  const click = (id: string) => (dom.window.document.getElementById(id) as HTMLButtonElement).click();
  return { dom, values, api, click };
}

describe("SCORM 1.2 reading course", () => {
  it("tracks completion only after every step and Finish, commits time and terminates once", () => {
    const { dom, values, api, click } = launch();
    expect(api.LMSInitialize).toHaveBeenCalledWith("");
    expect(values["cmi.core.lesson_status"]).toBe("incomplete");
    click("next"); click("next");
    expect(values["cmi.core.lesson_status"]).toBe("incomplete");
    click("next");
    expect(values["cmi.core.lesson_status"]).toBe("completed");
    expect(values["cmi.core.lesson_location"]).toBe("2");
    expect(values["cmi.suspend_data"]).toBe("111");
    expect(values["cmi.core.session_time"]).toMatch(/^\d{4}:\d{2}:\d{2}\.\d{2}$/);
    dom.window.dispatchEvent(new dom.window.Event("pagehide"));
    dom.window.dispatchEvent(new dom.window.Event("beforeunload"));
    expect(api.LMSFinish).toHaveBeenCalledTimes(1);
    expect(values["cmi.core.exit"]).toBe("");
    dom.window.close();
  });

  it("resumes a bookmark but requires earlier unread steps before completion", () => {
    const { dom, values, click } = launch({ "cmi.core.lesson_location": "2", "cmi.suspend_data": "001" });
    click("next");
    expect(values["cmi.core.lesson_status"]).toBe("incomplete");
    expect(values["cmi.core.lesson_location"]).toBe("0");
    click("next"); click("next"); click("next");
    expect(values["cmi.core.lesson_status"]).toBe("completed");
    dom.window.close();
  });

  it("suspends unfinished sessions and never resets an existing completion", () => {
    const first = launch();
    first.dom.window.dispatchEvent(new first.dom.window.Event("pagehide"));
    expect(first.values["cmi.core.exit"]).toBe("suspend");
    first.dom.window.close();
    const second = launch({ "cmi.core.lesson_status": "completed" });
    expect(second.values["cmi.core.lesson_status"]).toBe("completed");
    second.dom.window.close();
  });

  it("shows all text without scripts, works offline, and does not write after initialization fails", () => {
    const staticDom = page();
    expect(staticDom.window.document.querySelectorAll("article[hidden]")).toHaveLength(0);
    staticDom.window.close();
    const offline = page();
    offline.window.eval(SCORM_PLAYER);
    expect(offline.window.document.getElementById("tracking")?.textContent).toContain("Reading offline");
    offline.window.close();
    const failed = launch({}, false);
    failed.click("next");
    expect(failed.api.LMSSetValue).not.toHaveBeenCalled();
    expect(failed.api.LMSCommit).not.toHaveBeenCalled();
    failed.dom.window.close();
  });
});

