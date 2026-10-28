import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Bundle the actual crop implementation before crossing the browser context. */
export async function buildNativeCaptureBoundsScript({ regionSelector, adapter, root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), tsconfig } = {}) {
  const modulePath = adapter ?? path.join(root, "recording/capture-bounds.ts");
  const contents = adapter
    ? `import { tutorialCaptureBounds } from ${JSON.stringify(modulePath)}; window.__wfNativeBounds = tutorialCaptureBounds;`
    : `import { tutorialCaptureBounds } from ${JSON.stringify(modulePath)}; window.__wfNativeBounds = (doc, margin) => tutorialCaptureBounds(doc, { margin, regionSelector: ${JSON.stringify(regionSelector)} });`;
  const result = await build({ absWorkingDir: root, tsconfig, stdin: { contents, resolveDir: root, sourcefile: "tutorial-native-capture-bounds.ts", loader: "ts" }, bundle: true, write: false, format: "iife", platform: "browser", target: "es2022" });
  return result.outputFiles[0].text;
}

/**
 * Bundle the player's real anchor/ring resolver before crossing the browser
 * context. Only the DOM selectors are needed here; a policy's outcome predicate
 * is not serialized, and the host's independent crop adapter stays untouched.
 */
export async function buildNativeCaptureAnchorScript({ domPolicy, root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), tsconfig } = {}) {
  const policy = domPolicy ? `{ ...${JSON.stringify({
    applicationDialogSelector: domPolicy.applicationDialogSelector,
    floatingWindowSelector: domPolicy.floatingWindowSelector,
  })}, stepExpectsDialog: () => false }` : "DEFAULT_TUTORIAL_DOM_POLICY";
  const contents = `
    import { findTutorialAnchor, resolveRingElement } from ${JSON.stringify(path.join(root, "player/anchor.ts"))};
    import { DEFAULT_TUTORIAL_DOM_POLICY } from ${JSON.stringify(path.join(root, "player/dom-policy.ts"))};
    const domPolicy = ${policy};
    window.__wfNativeRingElement = (doc, step) => {
      const target = step.target?.id ? findTutorialAnchor(doc, step.target.id, domPolicy) : null;
      const anchor = target ?? (step.anchor?.id ? findTutorialAnchor(doc, step.anchor.id, domPolicy) : null);
      return anchor ? resolveRingElement(anchor, null, domPolicy) : null;
    };
  `;
  const result = await build({ absWorkingDir: root, tsconfig, stdin: { contents, resolveDir: root, sourcefile: "tutorial-native-capture-anchor.ts", loader: "ts" }, bundle: true, write: false, format: "iife", platform: "browser", target: "es2022" });
  return result.outputFiles[0].text;
}
