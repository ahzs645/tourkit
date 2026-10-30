import { createRoot, type Root } from "react-dom/client";
import { CaptureStudio } from "../../browser-capture-studio";
import type { BrowserCapturePackage } from "../../browser-capture/types";
import { createDefaultBrowserCaptureInteractiveExporter } from "../../browser-capture-export";

/** Extension pages may load a local recording before mounting the same editor. */
export function mountCaptureStudio(element: HTMLElement, initialCapture?: BrowserCapturePackage): Root {
  const root = createRoot(element);
  const exportInteractive = createDefaultBrowserCaptureInteractiveExporter(new URL("./player-runtime.json", document.baseURI));
  root.render(<CaptureStudio initialCapture={initialCapture} exportInteractive={exportInteractive} />);
  return root;
}
