import { build } from "esbuild";
import { mkdir, rm, writeFile, copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildCaptureStudio } from "./build-capture-studio.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "dist-extension");
if (process.argv.includes("--advanced")) throw new Error("The debugger-based application archiver is not part of this recorder. Build the standard DOM recorder without --advanced.");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const shared = { absWorkingDir: root, bundle: true, platform: "browser", target: "chrome120", minify: true, legalComments: "eof", sourcemap: false };
await build({ ...shared, entryPoints: ["apps/recorder-extension/background.ts"], outfile: path.join(output, "background.js"), format: "esm" });
await build({ ...shared, entryPoints: ["apps/recorder-extension/content.ts"], outfile: path.join(output, "content.js"), format: "iife" });
await build({ ...shared, entryPoints: ["apps/recorder-extension/ui.ts"], outfile: path.join(output, "ui.js"), format: "esm" });
await buildCaptureStudio(path.join(output, "studio"));
await build({ ...shared, entryPoints: ["apps/recorder-extension/studio.ts"], outfile: path.join(output, "studio.js"), format: "esm", define: { "process.env.NODE_ENV": '"production"' } });
// The Studio's standalone export fetches this static, packaged runtime. It is
// bundled at build time; no recorder/player code is downloaded from a CDN.
await copyFile(path.join(output, "studio", "player-runtime.json"), path.join(output, "player-runtime.json"));
await copyFile(path.join(root, "apps/recorder-extension/ui.css"), path.join(output, "ui.css"));
const html = (title, body, script, css) => `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><link rel="stylesheet" href="${css}"></head><body ${body}><main id="app"></main><script type="module" src="${script}"></script></body></html>\n`;
await writeFile(path.join(output, "popup.html"), html("TourKit recorder", 'data-view="popup"', "ui.js", "ui.css"));
await writeFile(path.join(output, "dashboard.html"), html("TourKit recordings", 'data-view="dashboard"', "ui.js", "ui.css"));
await writeFile(path.join(output, "studio.html"), html("TourKit Capture Studio", 'style="margin:0"', "studio.js", "studio.css"));
const manifest = {
  manifest_version: 3, name: "TourKit Recorder", version: "0.2.0", minimum_chrome_version: "120",
  description: "Record real interface elements and actions, then edit and share a self-contained TourKit walkthrough.",
  action: { default_title: "Record with TourKit", default_popup: "popup.html" },
  background: { service_worker: "background.js", type: "module" },
  permissions: ["activeTab", "scripting", "storage", "downloads"],
  optional_host_permissions: ["https://*/*", "http://*/*"],
  content_security_policy: { extension_pages: "script-src 'self'; object-src 'none'; base-uri 'none'" },
};
await writeFile(path.join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await copyFile(path.join(root, "apps/recorder-extension/README.md"), path.join(output, "README.md"));
await copyFile(path.join(root, "LICENSE"), path.join(output, "LICENSE"));
await writeFile(path.join(output, "THIRD_PARTY_NOTICES.txt"), "TourKit Recorder includes rrweb/@rrweb/record and @rrweb/replay (MIT), React (MIT), JSZip (MIT), and Zod (MIT). Dependency license notices are preserved in bundled JavaScript. See package-lock.json in the source repository for exact versions.\n");
console.log(`Built TourKit Recorder in ${output}. Load this directory as an unpacked extension in chrome://extensions.`);
