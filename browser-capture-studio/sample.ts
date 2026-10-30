import type { BrowserCapturePackage, BrowserCaptureEvent, JsonValue } from "../browser-capture/types";

/** A deliberately synthetic fixture, recorded as real rrweb full-snapshot events. */
export function createCaptureStudioSample(): BrowserCapturePackage {
  const start = Date.UTC(2026, 0, 1, 12);
  const css = `*{box-sizing:border-box}body{margin:0;background:#f5f6fa;color:#263249;font:15px/1.5 system-ui,sans-serif}.top{height:70px;background:white;border-bottom:1px solid #e2e5ec;display:flex;align-items:center;justify-content:space-between;padding:0 38px}.brand{font-size:20px;font-weight:750;color:#6356d8}.avatar{border-radius:50%;background:#eeeaff;color:#6356d8;width:34px;height:34px;display:grid;place-items:center;font-size:12px;font-weight:700}main{max-width:850px;margin:50px auto;padding:0 28px}.head{display:flex;justify-content:space-between;align-items:center;margin-bottom:26px}h1{font-size:28px;margin:0}p{color:#6e7789}button{font:inherit;cursor:pointer;border:0;border-radius:8px;padding:11px 17px;background:#6859d9;color:white;font-weight:650}.card{background:white;border:1px solid #e0e4ec;border-radius:12px;padding:26px}.empty{text-align:center;padding:54px 20px}.empty strong{font-size:18px;display:block}.backdrop{position:fixed;inset:0;background:#17213a55;display:grid;place-items:center}.dialog{width:420px;background:white;border-radius:15px;box-shadow:0 18px 70px #18244433;padding:28px}.dialog h2{margin:0 0 8px}label{display:block;font-size:13px;font-weight:650;margin:22px 0 8px}input{width:100%;padding:12px;border:1px solid #cdd3df;border-radius:7px;font:inherit}.actions{display:flex;justify-content:flex-end;gap:8px;margin-top:26px}.secondary{background:#edf0f6;color:#4d5b72}.row{display:flex;align-items:center;justify-content:space-between}.tag{background:#edf8f2;color:#238051;border-radius:20px;padding:5px 11px;font-size:12px}.hint{font-size:13px;color:#7c8595}`;
  let nextId = 100;
  const stableIds = new Map<string, number>();
  const ids: Record<string, number> = { new: 11, name: 21, save: 24, result: 31 };
  const serialize = (node: Node, path: string): JsonValue => {
    let id: number;
    const name = node.nodeType === Node.ELEMENT_NODE ? (node as Element).getAttribute("data-sample") : null;
    if (name && ids[name]) id = ids[name];
    else { if (!stableIds.has(path)) stableIds.set(path, nextId++); id = stableIds.get(path)!; }
    if (node.nodeType === Node.DOCUMENT_NODE) return { type: 0, id, childNodes: Array.from(node.childNodes).map((child, i) => serialize(child, `${path}/${i}`)) };
    if (node.nodeType === Node.DOCUMENT_TYPE_NODE) return { type: 1, id, name: "html", publicId: "", systemId: "" };
    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as Element;
      return { type: 2, id, tagName: element.tagName.toLowerCase(), attributes: Object.fromEntries(Array.from(element.attributes).map((attribute) => [attribute.name, attribute.value])), childNodes: Array.from(node.childNodes).map((child, i) => serialize(child, `${path}/${i}`)) };
    }
    return { type: node.nodeType === Node.COMMENT_NODE ? 5 : 3, id, textContent: node.textContent ?? "" };
  };
  const markup = (state: number) => `<!doctype html><html><head><title>Example workspace</title><style>${css}</style></head><body><header class="top"><div class="brand">Northstar / Projects</div><div class="avatar">AJ</div></header><main><div class="head"><div><h1>Your projects</h1><p>Keep your team's next steps in one place.</p></div><button data-sample="new">New project</button></div>${state < 3 ? '<div class="card empty"><strong>A little space for your next big idea.</strong><p>Create your first project to get started.</p></div>' : '<div class="card row" data-sample="result"><div><strong>Launch plan</strong><div class="hint">Created just now · 0 tasks</div></div><span class="tag">Ready to start</span></div>'}</main>${state === 1 || state === 2 ? `<div class="backdrop"><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-heading"><h2 id="dialog-heading">Create a project</h2><p>Give your project a name your team will recognize.</p><label for="project-name">Project name</label><input id="project-name" data-sample="name" placeholder="e.g. Launch plan" value="${state === 2 ? "Launch plan" : ""}"><div class="actions"><button class="secondary">Cancel</button><button data-sample="save">Create project</button></div></section></div>` : ""}</body></html>`;
  const events: BrowserCaptureEvent[] = [{ type: 4, timestamp: start, data: { href: "https://example.invalid/projects", width: 1024, height: 700 } }];
  for (let state = 0; state < 4; state++) {
    const doc = new DOMParser().parseFromString(markup(state), "text/html");
    events.push({ type: 2, timestamp: start + state * 1500 + 1, data: { node: serialize(doc, "document"), initialOffset: { left: 0, top: 0 } } });
  }
  return {
    format: "tourkit-browser-capture", version: 1, id: "tourkit-capture-studio-sample", title: "Create your first project", createdAt: new Date(start).toISOString(), updatedAt: new Date(start).toISOString(), engine: { name: "rrweb", version: "2.2.0" }, viewport: { width: 1024, height: 700 }, privacy: { mode: "reviewed", notes: "Synthetic interface and demonstration content created for TourKit." },
    pages: [{ id: "sample", origin: "https://example.invalid", path: "/projects" }], events,
    steps: [
      { id: "open", title: "Start a new project", instruction: "Select New project to open the project form.", atMs: 2, action: "click", target: { nodeId: ids.new!, label: "New project" } },
      { id: "name", title: "Make it yours", instruction: "Enter a project name, then press Enter. Your input stays in this practice session.", atMs: 1502, action: "input", target: { nodeId: ids.name!, label: "Project name" } },
      { id: "save", title: "Create the project", instruction: "Select Create project to view the recorded result. This sample shows the captured project name.", atMs: 3002, action: "click", target: { nodeId: ids.save!, label: "Create project" } },
      { id: "result", title: "You are ready to go", instruction: "The captured project now appears in the list. Select Finish to complete this walkthrough, or reset to practice again.", atMs: 4502, action: "continue", target: { nodeId: ids.result!, label: "Created project" } },
    ], warnings: [],
  };
}
