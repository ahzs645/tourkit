import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compile, optimize } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";
import { buildCapturePlayerRuntime } from "./build-capture-studio.mjs";

export const kitRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const exampleOutputName = (example) => example === "task-list" ? ".tmp-tourkit-example"
  : example === "dialog-workflow" ? ".tmp-tourkit-dialog-example" : `.tmp-tourkit-${example}-example`;

export async function buildTutorialExample(example = "task-list", output = path.join(process.cwd(), exampleOutputName(example))) {
  if (!["task-list", "dialog-workflow", "studio", "library", "review", "simulated-backend"].includes(example)) throw new Error(`Unknown tutorial example: ${example}`);
  const entryPoints = example === "studio"
    ? { main: path.join(kitRoot, "examples/studio/main.tsx"), stage: path.join(kitRoot, "examples/studio/stage.tsx") }
    : { example: path.join(kitRoot, `examples/${example}.tsx`) };
  const result = await build({
    absWorkingDir: kitRoot, entryPoints, bundle: true, format: "esm", splitting: true,
    platform: "browser", target: "es2022", outdir: path.resolve(output), write: false,
    metafile: true, define: { "process.env.NODE_ENV": '"production"' }, minify: true,
    chunkNames: "chunks/[name]-[hash]",
  });
  const inputs = Object.keys(result.metafile.inputs).filter((file) => !file.split(path.sep).includes("node_modules") && !file.startsWith("(disabled):"));
  const outside = inputs.filter((file) => {
    const relative = path.relative(kitRoot, path.resolve(kitRoot, file));
    return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
  });
  if (outside.length) throw new Error(`Standalone example imported application code: ${outside.join(", ")}`);
  const html = (entry, title) => `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tourkit — ${title}</title><link rel="stylesheet" href="./${entry}.css"></head>\n<body class="bg-slate-50 dark:bg-slate-950"><div id="root"></div><script type="module" src="./${entry}.js"></script></body></html>\n`;
  const sources = await Promise.all(inputs.map(async (file) => ({ content: await readFile(path.resolve(kitRoot, file), "utf8"), extension: path.extname(file).slice(1) })));
  const pages = example === "studio" ? { "index.html": html("main", "Studio"), "stage.html": html("stage", "Project workspace") } : { "index.html": html("example", example) };
  const candidates = new Scanner({}).scanFiles([...sources, ...Object.values(pages).map((content) => ({ content, extension: "html" }))]);
  const compiler = await compile('@import "tailwindcss" source(none);@import "./ui/theme.css";', { base: kitRoot, onDependency() {} });
  const css = optimize(compiler.build(candidates), { file: "example.css" }).code;
  await mkdir(output, { recursive: true });
  const bundledStyles = result.outputFiles.filter((file) => file.path.endsWith(".css")).map((file) => file.text).join("\n");
  for (const file of result.outputFiles.filter((file) => !file.path.endsWith(".css"))) {
    await mkdir(path.dirname(file.path), { recursive: true });
    await writeFile(file.path, file.contents);
  }
  for (const name of Object.keys(entryPoints)) await writeFile(path.join(output, `${name}.css`), `${css}\n${bundledStyles}`);
  for (const [name, content] of Object.entries(pages)) await writeFile(path.join(output, name), content);
  if (example === "studio") await writeFile(path.join(output, "player-runtime.json"), JSON.stringify(await buildCapturePlayerRuntime()));
  console.log(`Standalone ${example} example built in ${output} (${inputs.length} module files; no application imports).`);
  return { output: path.resolve(output), inputs };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildTutorialExample(process.argv[2], process.argv[3]);
