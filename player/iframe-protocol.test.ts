// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTutorialIframeController, TUTORIAL_IFRAME_PROTOCOL } from "./iframe-protocol";

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

function stage() {
  const frame = document.createElement("iframe");
  // The protocol fixture needs a same-origin window, without loading a URL or
  // enabling Happy DOM's disabled-by-default iframe navigation.
  frame.srcdoc = "";
  document.body.append(frame);
  const target = frame.contentWindow!;
  const post = vi.spyOn(target, "postMessage").mockImplementation(() => {});
  const controller = createTutorialIframeController(frame);
  const send = (data: Record<string, unknown>, origin = window.location.origin, source: Window = target) => window.dispatchEvent(new MessageEvent("message", {
    source, origin, data: { protocol: TUTORIAL_IFRAME_PROTOCOL, ...data },
  }));
  return { controller, send, post };
}

describe("tutorial frame readiness", () => {
  it("does not accept initial fixture metadata as a ready navigation result", async () => {
    const { controller, send, post } = stage();
    const view = { "workspace.activeTab": "preview" };
    const changed = vi.fn(); controller.subscribeView(changed);
    let restored = false;
    try {
      send({ type: "tutorial:view", state: view, ready: false });
      expect(changed).toHaveBeenLastCalledWith(view, false);
      const request = controller.restoreView({ label: "Preview", all: [{ path: "workspace.activeTab", equals: "preview" }] }).then(() => { restored = true; });
      const payload = post.mock.calls.at(-1)![0] as { id: string };
      send({ type: "tutorial:view-restored", id: payload.id });
      await Promise.resolve(); expect(restored).toBe(false);
      send({ type: "tutorial:view", state: view, ready: true });
      await request; expect(restored).toBe(true);
    } finally { controller.destroy(); }
  });
  it("accepts ready legacy structural messages but rejects untrusted or malformed state", () => {
    const { controller, send } = stage();
    const changed = vi.fn(); controller.subscribeView(changed);
    try {
      send({ type: "tutorial:view", state: { "host.patient": "private" }, ready: true });
      send({ type: "tutorial:view", state: { "host.module": "chart" }, ready: "yes" });
      send({ type: "tutorial:view", state: { "host.module": "chart" }, ready: true }, "https://other.example");
      send({ type: "tutorial:view", state: { "host.module": "chart" }, ready: true }, window.location.origin, window);
      expect(changed).not.toHaveBeenCalled();
      send({ type: "tutorial:view", state: { "host.module": "chart" } });
      expect(changed).toHaveBeenCalledExactlyOnceWith({ "host.module": "chart" }, true);
    } finally { controller.destroy(); }
  });
  it("rejects pending navigation when the frame is replaced", async () => {
    const { controller } = stage();
    const request = controller.restoreView({ label: "Preview", all: [{ path: "workspace.activeTab", equals: "preview" }] });
    const result = expect(request).rejects.toThrow("stage changed");
    controller.destroy(); await result;
  });
});


