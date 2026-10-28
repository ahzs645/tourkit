import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildTutorialExample } from "./build-example.mjs";

// The GitHub Pages site: every example built into its own folder under one
// landing page. Example pages use relative URLs, so the site works from any
// base path (https://<owner>.github.io/tourkit/ included).
const EXAMPLES = [
  { id: "task-list", title: "Task list", text: "The smallest host: one lesson creates and finishes a task through the list's own actions and state." },
  { id: "dialog-workflow", title: "Dialog workflow", text: "Practice and Watch through a modal create-project flow, with the dialog as part of the lesson." },
  { id: "studio", title: "Studio", text: "The full authoring workspace: record a lesson against a live stage, edit steps, capture screenshots and export." },
  { id: "library", title: "Lesson library", text: "Published lessons in sections with progress, for two unrelated apps: a warehouse and an observatory." },
  { id: "review", title: "Review layer", text: "Pins, notes and drawings anchored to a proposal page, saved as a portable feedback file." },
];

const output = path.resolve(process.argv[2] ?? "site");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const example of EXAMPLES) await buildTutorialExample(example.id, path.join(output, example.id));

const escape = (value) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const cards = EXAMPLES.map((example) => `<li><a href="./${example.id}/"><h2>${escape(example.title)}</h2><p>${escape(example.text)}</p></a></li>`).join("\n");
await writeFile(path.join(output, "index.html"), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tourkit</title>
<style>
:root { color-scheme: light dark; --ink: #0f172a; --muted: #475569; --line: #cbd5e1; --bg: #f8fafc; --card: #fff; --accent: #0369a1; }
@media (prefers-color-scheme: dark) { :root { --ink: #e2e8f0; --muted: #94a3b8; --line: #334155; --bg: #020617; --card: #0f172a; --accent: #38bdf8; } }
body { margin: 0; font: 16px/1.5 system-ui, sans-serif; color: var(--ink); background: var(--bg); }
main { max-width: 960px; margin: 0 auto; padding: 48px 24px; }
h1 { font-size: 2.5rem; margin: 0 0 8px; }
.lede { color: var(--muted); max-width: 680px; margin: 0 0 32px; }
ul { list-style: none; padding: 0; display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
a { color: inherit; text-decoration: none; }
li a { display: block; height: 100%; box-sizing: border-box; padding: 20px; border: 1px solid var(--line); border-radius: 8px; background: var(--card); }
li a:hover, li a:focus-visible { border-color: var(--accent); outline: none; }
h2 { font-size: 1.1rem; margin: 0 0 6px; color: var(--accent); }
li p { margin: 0; color: var(--muted); font-size: 0.95rem; }
footer { margin-top: 40px; color: var(--muted); font-size: 0.9rem; }
footer a { color: var(--accent); text-decoration: underline; }
</style></head>
<body><main>
<h1>Tourkit</h1>
<p class="lede">Guided tours for React apps. A lesson names your app's own actions and the state they should produce; Tourkit plays it as hands-on Practice or a Watch demo, records new lessons, captures screenshots and exports guides. Each example below is a different, unrelated host.</p>
<ul>
${cards}
</ul>
<footer>MIT licensed · <a href="https://github.com/ahzs645/tourkit">Source and documentation on GitHub</a></footer>
</main></body></html>
`);
console.log(`Tourkit site built in ${output} (${EXAMPLES.length} examples).`);
