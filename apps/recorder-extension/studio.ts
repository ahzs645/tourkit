import { mountCaptureStudio } from "../capture-studio/mount";
import { sessionCapture } from "./storage";

async function boot() {
  const root = document.getElementById("app")!;
  const id = new URLSearchParams(location.hash.slice(1)).get("session");
  try {
    const capture = id ? await sessionCapture(id) : undefined;
    mountCaptureStudio(root, capture);
  } catch (error) {
    const message = document.createElement("p");
    message.textContent = `This recording could not be opened: ${error instanceof Error ? error.message : "unknown error"}`;
    const back = document.createElement("a"); back.href = "dashboard.html"; back.textContent = "Return to recordings";
    root.replaceChildren(message, back);
  }
}
void boot();
