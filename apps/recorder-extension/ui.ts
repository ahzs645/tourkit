import { exportBrowserCaptureZip } from "../../browser-capture/index";
import { CHANNEL, type RecordingSession } from "./protocol";
import { deleteSession, getSession, sessionCapture, updateSession } from "./storage";

const app = document.querySelector<HTMLElement>("#app")!;
const isPopup = document.body.dataset.view === "popup";
let active: RecordingSession | undefined;
let busy = false;
let statusText = "";
let statusError = false;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function button(text: string, action: () => Promise<unknown> | unknown, className = "secondary") {
  const node = element("button", text, className);
  node.type = "button";
  node.disabled = busy;
  node.addEventListener("click", () => {
    if (busy) return;
    busy = true; node.disabled = true;
    let result: unknown;
    try { result = action(); } catch (error) { result = Promise.reject(error); }
    Promise.resolve(result).then(() => { statusError = false; }).catch((error) => {
      statusText = error instanceof Error ? error.message : "The action could not be completed."; statusError = true;
    }).finally(async () => { busy = false; await render(); });
  });
  return node;
}
async function command(message: object) {
  const response = await chrome.runtime.sendMessage({ channel: CHANNEL, ...message });
  if (!response?.ok) throw new Error(response?.error || "The recorder is unavailable. Reload the extension and try again.");
  return response;
}
async function currentTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) throw new Error("Open the source website, then click the TourKit extension button to start or resume.");
  return tab.id;
}
function openStudio(id?: string) {
  return chrome.tabs.create({ url: chrome.runtime.getURL(`studio.html${id ? `#session=${encodeURIComponent(id)}` : ""}`) });
}
async function exportSession(id: string) {
  if ((await getSession(id))?.status === "recording") await command({ type: "pause", sessionId: id });
  const capture = await sessionCapture(id);
  const blob = await exportBrowserCaptureZip(capture);
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename: `${capture.title.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "") || "recording"}.tourkit`, saveAs: true });
    statusText = "Your .tourkit recording is ready. Open it in Studio to edit, preview and export.";
  } finally { setTimeout(() => URL.revokeObjectURL(url), 60000); }
}
async function grantAssets(session: RecordingSession) {
  const origins = session.missingAssetOrigins.filter((origin) => /^https?:\/\//.test(origin)).map((origin) => `${origin}/*`);
  if (!origins.length) return;
  // Called directly from the button's user gesture. No site access is requested at install time.
  const accepted = await chrome.permissions.request({ origins });
  if (!accepted) throw new Error("Asset access was not granted. The recording remains available with its resource warnings.");
  await command({ type: "refresh-assets", sessionId: session.id });
  statusText = "Asset access granted. Resume the recording on the source page to collect newly available resources.";
}

function sessionCard(session: RecordingSession): HTMLElement {
  const card = element("article", undefined, "recording-card");
  const heading = element("div", undefined, "recording-heading");
  heading.append(element("h2", session.title), element("span", session.status, `status ${session.status}`));
  card.append(heading);
  card.append(element("p", `${session.steps.length} steps · ${session.eventCount.toLocaleString()} events · ${new Date(session.updatedAt).toLocaleString()}`, "muted"));
  const actions = element("div", undefined, "actions");
  if (session.status === "recording") {
    actions.append(button("Pause", () => command({ type: "pause", sessionId: session.id })), button("Stop recording", () => command({ type: "stop", sessionId: session.id }), "primary"));
  } else if (isPopup) actions.append(button("Resume on this tab", async () => { await command({ type: "resume", sessionId: session.id, tabId: await currentTabId() }); statusText = "Recording resumed. Return to the page to continue."; }, "primary"));
  if (session.eventCount) {
    actions.append(button("Open in Studio", async () => { if (session.status === "recording") await command({ type: "pause", sessionId: session.id }); await openStudio(session.id); }, "primary"));
    actions.append(button("Download .tourkit", () => exportSession(session.id)));
  }
  if (!isPopup) {
    actions.append(button("Rename", async () => {
      const value = prompt("Recording title", session.title);
      if (value?.trim()) await updateSession(session.id, (draft) => { draft.title = value.trim().slice(0, 120); });
    }));
    actions.append(button("Delete", async () => {
      if (!confirm(`Delete “${session.title}” from this browser? Export it first if you need a copy.`)) return;
      if (session.status === "recording") await command({ type: "stop", sessionId: session.id });
      await deleteSession(session.id);
    }, "danger"));
  }
  card.append(actions);
  if (session.missingAssetOrigins.length) {
    const access = button(`Grant asset access (${session.missingAssetOrigins.length} sites)`, () => grantAssets(session));
    card.append(access);
  }
  if (session.warnings.length) {
    const details = element("details");
    details.append(element("summary", `${session.warnings.length} capture notes`));
    const list = element("ul");
    for (const warning of session.warnings) list.append(element("li", warning.message));
    details.append(list); card.append(details);
  }
  return card;
}

async function render() {
  const response = await command({ type: "status" }).catch(() => ({ sessions: [], active: undefined }));
  active = response.active as RecordingSession | undefined;
  const sessions = response.sessions as RecordingSession[];
  app.replaceChildren();
  const header = element("header");
  header.append(element("span", "TOURKIT", "eyebrow"), element("h1", isPopup ? "Record a walkthrough" : "Your recordings"), element("p", "Capture real interface elements, actions and private screenshot checkpoints.", "subtitle"));
  app.append(header);
  if (statusText) {
    const message = element("p", statusText, statusError ? "notice error" : "notice");
    message.setAttribute("role", statusError ? "alert" : "status"); app.append(message);
  }
  if (isPopup && active?.status !== "recording") {
    const form = element("section", undefined, "start-panel");
    const titleLabel = element("label", "Recording title");
    const title = element("input"); title.id = "recording-title"; title.placeholder = "e.g. Create a new form"; title.maxLength = 120; titleLabel.htmlFor = title.id;
    const checkLabel = element("label", undefined, "check-label");
    const screenshots = element("input"); screenshots.type = "checkbox"; screenshots.checked = true;
    checkLabel.append(screenshots, document.createTextNode("Include screenshot checkpoints"));
    const advanced = element("details"); advanced.append(element("summary", "Privacy options"));
    const selectorLabel = element("label", "Additional private CSS selectors");
    const selector = element("input"); selector.id = "private-selector"; selector.placeholder = ".customer-details, #account-number"; selector.maxLength = 1000; selectorLabel.htmlFor = selector.id;
    advanced.append(selectorLabel, selector, element("p", "All form inputs, editable text, .rr-mask, .rr-block and [data-tourkit-private] regions are masked. Screenshots also cover embedded frames. Review visible page text and images before sharing.", "muted"));
    form.append(titleLabel, title, checkLabel, advanced, button("Start on this tab", async () => {
      if (selector.value.trim()) { try { document.querySelector(selector.value); } catch { throw new Error("The private selectors are not valid CSS. Use selectors such as .customer-details or #account-number."); } }
      await command({ type: "start", title: title.value, screenshots: screenshots.checked, privateSelector: selector.value.trim(), tabId: await currentTabId() });
      statusText = "Recording started. Close this popup and walk through the website.";
    }, "primary"));
    app.append(form);
  }
  if (!isPopup) app.append(element("p", "To record or resume: open your source website and use the TourKit extension button. Recordings stay in this browser until you download or delete them.", "notice"));
  const display = isPopup ? sessions.slice(0, 2) : sessions;
  for (const session of display) app.append(sessionCard(session));
  if (!sessions.length) app.append(element("p", "No recordings yet. Start on a website, or open Studio to import an existing .tourkit file.", "empty"));
  const footer = element("footer", undefined, "actions");
  if (isPopup) footer.append(button("All recordings", () => chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") })));
  footer.append(button("Import in Studio", () => openStudio()));
  app.append(footer);
  app.append(element("p", "Recorded pages are reconstructed with TourKit controls. Original app scripts and backend services do not run in this capture mode.", "fine-print"));
}

void render();
document.addEventListener("visibilitychange", () => { if (!document.hidden && !busy) void render(); });
