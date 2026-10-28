// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { createReviewEnvironment, ReviewEnvironmentProvider } from "./environment";
import { ReviewInboxHost } from "./ReviewInboxDrawer";
import { StudioReviewHost } from "./StudioReviewHost";
import { addReviewItem, createReviewBundle } from "./model";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function comment(kind: string, id: string, fieldId: string) {
  const bundle = createReviewBundle({ kind, subjectId: id, formName: "A useful guide", target: "preview", shareUrl: null, fields: [{ id: fieldId, type: "text", label: "Overview" }] });
  return addReviewItem(bundle, { kind: "comment", page: "Overview", text: "Make the outcome clearer.", color: "#2563eb", anchor: { attribute: null, value: null, fieldId, fieldLabel: "Overview", dx: 0, dy: 0 } }).bundle;
}
const button = (text: string) => [...document.querySelectorAll("button")].find((element) => element.textContent?.trim() === text);

it("renders an unrelated subject in an isolated inbox and resolves/reopens the real stored item", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const environment = createReviewEnvironment({ namespace: "document-editor", storage: null, kinds: ["document"], labels: () => ({ title: "Proposal", one: "paragraph", changed: "Paragraph edited", removed: "Paragraph removed" }) });
  const bundle = comment("document", "proposal-1", "overview");
  environment.inbox.import(bundle, { open: ["document"] });
  try {
    await act(async () => root.render(<ReviewEnvironmentProvider value={environment}><ReviewInboxHost kinds={["document"]} dropHint="open it here" /></ReviewEnvironmentProvider>));
    expect(document.body.textContent).toContain("Proposal · A useful guide");
    expect(document.body.textContent).toContain("Make the outcome clearer.");
    await act(async () => button("Resolve")?.click());
    expect(environment.inbox.getSnapshot().bundles.document?.items[0].status).toBe("resolved");
    expect(document.body.textContent).not.toContain("Make the outcome clearer.");
    await act(async () => button("All")?.click());
    await act(async () => button("Reopen")?.click());
    expect(environment.inbox.getSnapshot().bundles.document?.items[0].status).toBe("open");
    await act(async () => button("Clear")?.click());
    expect(environment.inbox.getSnapshot().bundles.document).toBeUndefined();
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("opens the matching Studio draft step through the adapter callback", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const environment = createReviewEnvironment({ namespace: "studio", storage: null });
  const onFocusStep = vi.fn();
  environment.inbox.import(comment("tutorial", "draft-one", "step-one"), { open: ["tutorial"] });
  try {
    await act(async () => root.render(<ReviewEnvironmentProvider value={environment}><StudioReviewHost draft={{ id: "draft one", steps: [{ id: "step one", title: "First step", instruction: "Try the app." }] }} onFocusStep={onFocusStep} /></ReviewEnvironmentProvider>));
    expect(button("Go to step")).toBeDefined();
    await act(async () => button("Go to step")?.click());
    expect(onFocusStep).toHaveBeenCalledWith("step one");
    expect(environment.inbox.getSnapshot().open).toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); }
});
