import React from "react";
import { createRoot } from "react-dom/client";
import { parseBrowserCapture } from "../../browser-capture";
import { BrowserCapturePlayer } from "../../browser-capture-studio";

const root = document.getElementById("root");
if (!root) throw new Error("The capture player mount is missing.");
try {
  const source = document.getElementById("tourkit-capture-data")?.textContent;
  if (!source) throw new Error("The capture package is missing.");
  const capture = parseBrowserCapture(JSON.parse(source));
  createRoot(root).render(<BrowserCapturePlayer capture={capture} />);
} catch (error) {
  root.textContent = `This tutorial could not be opened: ${error instanceof Error ? error.message : String(error)}`;
}
