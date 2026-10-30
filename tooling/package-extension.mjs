import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "dist-extension");
const manifest = JSON.parse(await readFile(path.join(source, "manifest.json"), "utf8"));
if (manifest.manifest_version !== 3) throw new Error("Build the Manifest V3 recorder before packaging it.");
const archive = new JSZip();
async function addDirectory(directory, prefix = "") {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = `${prefix}${entry.name}`;
    if (entry.isDirectory()) await addDirectory(path.join(directory, entry.name), `${name}/`);
    else if (entry.isFile()) archive.file(name, await readFile(path.join(directory, entry.name)), { date: new Date("2026-01-01T00:00:00.000Z") });
  }
}
await addDirectory(source);
const output = path.resolve(process.argv[2] ?? path.join(root, ".artifacts", `tourkit-recorder-${manifest.version}.zip`));
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, await archive.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } }));
console.log(`Packaged ${output}. Extract it, then select the extracted folder with Chrome's Load unpacked command.`);
