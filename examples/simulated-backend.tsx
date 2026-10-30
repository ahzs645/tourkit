"use client";

import { useEffect, useState, type FormEvent, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { createTutorialServiceSimulator } from "../simulation";
import "./simulated-backend.css";

interface Project { id: string; name: string; description: string; }
const service = createTutorialServiceSimulator({
  origin: window.location.origin,
  collections: [{ name: "projects", path: "/api/projects", records: [], required: ["name"], searchFields: ["name", "description"] }],
});

/** The demo deliberately uses the same request/response shape as an API client. */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await service.fetch(path, init);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "The project could not be saved.");
  return data as T;
}

export function SimulatedProjectWorkspace(): ReactElement {
  const [projects, setProjects] = useState<Project[]>([]);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Project | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const refresh = async () => setProjects(await request<Project[]>("/api/projects"));
  useEffect(() => { void refresh(); }, []);
  async function save(event: FormEvent) {
    event.preventDefault(); setError("");
    try {
      const project = await request<Project>(selected ? `/api/projects/${encodeURIComponent(selected.id)}` : "/api/projects", {
        method: selected ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: name.trim(), description }),
      });
      await refresh(); setCreating(false); setSelected(null); setNotice(`Saved ${project.name}.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Save failed."); }
  }
  async function open(id: string) {
    const project = await request<Project>(`/api/projects/${encodeURIComponent(id)}`);
    setSelected(project); setName(project.name); setDescription(project.description); setError("");
  }
  function reset() {
    service.reset(); setProjects([]); setSelected(null); setCreating(false); setName(""); setDescription(""); setError(""); setNotice("Demo reset. You can start again.");
  }
  return <div className="simulation-demo">
    <header><a href="../">TourKit examples</a><span>Backend simulation</span><button className="secondary" onClick={reset}>Reset demo</button></header>
    <main>
      <section className="simulation-intro"><span className="eyebrow">PROJECT WORKSPACE</span><h1>Your next idea starts here.</h1>
        <p>Create a project, save it, and reopen it. This frontend has a local simulated service that remembers your changes until you reset or refresh the page.</p>
        <p className="record-hint">Try recording this workflow with TourKit Recorder, then open it in Studio to edit the captured steps.</p>
      </section>
      <section className="simulation-projects" aria-label="Projects"><div className="simulation-section-title"><h2>Your projects <span>{projects.length}</span></h2><button onClick={() => { setCreating(true); setSelected(null); setName(""); setDescription(""); setError(""); }}>New project</button></div>
        {notice && <p role="status" className="simulation-notice">{notice}</p>}
        {projects.length ? <ul>{projects.map((project) => <li key={project.id}><button className="project-card" onClick={() => void open(project.id)}><span className="project-icon">↗</span><strong>{project.name}</strong><span>{project.description || "Add a description to share what comes next."}</span><small>Open project →</small></button></li>)}</ul>
          : <div className="simulation-empty"><span>✦</span><h3>A little space for your next big idea.</h3><p>Create your first project to get started.</p></div>}
      </section>
      <details className="simulation-details"><summary>How this demo works</summary><p>The API client calls <code>createTutorialServiceSimulator().fetch</code>. POST creates a record, GET retrieves it, PATCH updates it, and Reset restores the seed data. No project requests leave this page. Unknown endpoints return a demo error instead of reaching a real service.</p><p>These are explicit demo rules. Captured walkthroughs use saved interface states; they do not infer the original application's business rules.</p></details>
    </main>
    {(creating || selected) && <div className="simulation-dialog-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="project-heading" className="simulation-dialog"><div className="simulation-section-title"><h2 id="project-heading">{selected ? "Edit project" : "Create a project"}</h2><button className="secondary" aria-label="Close project editor" onClick={() => { setCreating(false); setSelected(null); }}>×</button></div>
      <form onSubmit={(event) => void save(event)} noValidate><label htmlFor="project-name">Project name</label><input id="project-name" autoFocus autoComplete="off" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Autumn launch" />
        <label htmlFor="project-description">Description</label><textarea id="project-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What are you working toward?" />
        {error && <p role="alert" className="simulation-error">{error}</p>}
        <div className="simulation-form-actions"><button className="secondary" type="button" onClick={() => { setCreating(false); setSelected(null); }}>Cancel</button><button type="submit">{selected ? "Save changes" : "Create project"}</button></div>
      </form></section></div>}
  </div>;
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<SimulatedProjectWorkspace />);
