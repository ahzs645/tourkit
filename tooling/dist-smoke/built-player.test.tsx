// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
// The built package, deliberately: every other test imports source, so none of
// them can see a build that compiles and then throws in the browser.
// @ts-expect-error dist is produced by `npm run build`, and has no types here.
import { parseTutorialManifest } from "../../dist/core.js";
// @ts-expect-error dist is produced by `npm run build`, and has no types here.
import { TutorialPlayer } from "../../dist/player.js";

it("renders a tour from the built player", async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const manifest = parseTutorialManifest({
    schemaVersion: 1, id: "smoke", title: "Smoke", launch: { fixture: "app" }, interaction: "guided",
    chapters: [{ id: "tour", title: "Tour", steps: [
      { id: "one", completion: "continue", anchor: { id: "target" }, overlay: { title: "Built", body: "It runs." } },
    ] }],
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<>
    <button data-tutorial-id="target">Target</button>
    <TutorialPlayer manifest={manifest} persistProgress={false} />
  </>));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
  expect(document.querySelector('[data-testid="tutorial-overlay"]')?.textContent).toContain("Built");
  await act(async () => root.unmount());
});
