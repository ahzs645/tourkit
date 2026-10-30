import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function buildCapturePlayerRuntime() {
  const result = await build({
    absWorkingDir: directory,
    entryPoints: ["apps/capture-player/main.tsx"],
    bundle: true, format: "iife", platform: "browser", target: "es2022",
    outfile: "player.js", minify: true, write: false,
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const javascript = result.outputFiles.find((file) => file.path.endsWith(".js"))?.text;
  if (!javascript) throw new Error("The capture player build produced no JavaScript.");
  return { version: 1, javascript, css: result.outputFiles.filter((file) => file.path.endsWith(".css")).map((file) => file.text).join("\n") };
}

/** The extension can supply its own entry to load a recording from extension storage. */
export async function buildCaptureStudio(outputDirectory = path.join(directory, "dist-capture-studio"), options = {}) {
  const output = path.resolve(outputDirectory);
  await mkdir(output, { recursive: true });
  await build({
    absWorkingDir: directory,
    entryPoints: { main: options.entryFile ?? "apps/capture-studio/main.tsx" },
    outdir: output, bundle: true, format: "iife", platform: "browser", target: "es2022",
    minify: true, sourcemap: false,
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const html = await readFile(path.join(directory, "apps/capture-studio/index.html"), "utf8");
  await writeFile(path.join(output, "index.html"), html);
  await writeFile(path.join(output, "player-runtime.json"), JSON.stringify(await buildCapturePlayerRuntime()));
  return output;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = await buildCaptureStudio(process.argv[2]);
  console.log(`Built captured-website Studio and offline player in ${output}.`);
}
