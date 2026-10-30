import { build } from "esbuild";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { compile, optimize } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";
import ts from "typescript";
import { tourkitBoundaryIssues } from "./boundaries.mjs";
import { verifyTutorialVendor } from "./verify-vendor.mjs";

const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(directory, "dist");
const issues = await tourkitBoundaryIssues(directory);
if (issues.length) throw new Error(issues.join("\n"));
await verifyTutorialVendor(directory);
const entryPoints = Object.fromEntries(["core", "player", "recording", "export", "studio", "ui", "library", "review", "browser-capture", "browser-capture-studio", "browser-capture-export", "simulation"].map((name) => [name, path.join(directory, name, "index.ts")]));
entryPoints.share = path.join(directory, "share.ts");
entryPoints.session = path.join(directory, "components/tutorial-session.ts");
entryPoints.capture = path.join(directory, "recording/capture.ts");
entryPoints.validation = path.join(directory, "tooling/validate-lesson.ts");
const result = await build({ absWorkingDir: directory, entryPoints, outdir: output, bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022", packages: "external", metafile: true, write: false, chunkNames: "chunks/[name]-[hash]" });
const outside = Object.keys(result.metafile.inputs).filter((file) => file.startsWith("../") || path.isAbsolute(file));
if (outside.length) throw new Error(`Package build escaped the Tourkit: ${outside.join(", ")}`);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const clientEntries = new Set(["player.js", "studio.js", "ui.js", "library.js", "review.js", "session.js", "capture.js", "browser-capture-studio.js"]);
for (const file of result.outputFiles) {
  await mkdir(path.dirname(file.path), { recursive: true });
  // Bundling removes source directives. Restore the public React boundary for
  // consumers with server components while keeping core usable in plain Node.
  await writeFile(file.path, clientEntries.has(path.basename(file.path)) && path.dirname(file.path) === output
    ? `"use client";\n${file.text}` : file.contents);
}
const sources = [];
async function scan(folder) {
  for (const item of await readdir(folder, { withFileTypes: true })) {
    if (["node_modules", "dist", "vendor", "tooling", ".git", "dist-capture-studio", "dist-extension", "dist-extension-advanced", "site", ".artifacts"].includes(item.name) || item.name.startsWith(".tmp-")) continue;
    const file = path.join(folder, item.name);
    if (item.isDirectory()) await scan(file);
    else if (/\.[jt]sx?$/.test(item.name) && !/\.test\./.test(item.name)) sources.push({ content: await readFile(file, "utf8"), extension: path.extname(file).slice(1) });
  }
}
await scan(directory);
const compiler = await compile('@import "tailwindcss" source(none);@import "./ui/theme.css";', { base: directory, onDependency() {} });
const css = optimize(compiler.build(new Scanner({}).scanFiles(sources)), { file: "styles.css" }).code;
const componentStyles = result.outputFiles.filter((file) => file.path.endsWith(".css")).map((file) => file.text).join("\n");
await writeFile(path.join(output, "styles.css"), `${css}\n${componentStyles}`);
await writeFile(path.join(output, "build-manifest.json"), JSON.stringify({ entries: Object.keys(entryPoints), inputs: Object.keys(result.metafile.inputs), applicationImports: [] }, null, 2));
const require = createRequire(import.meta.url);
const checked = spawnSync(process.execPath, [require.resolve("typescript/bin/tsc"), "-p", path.join(directory, "tsconfig.build.json")], { cwd: directory, stdio: "inherit" });
if (checked.status !== 0) process.exit(checked.status ?? 1);
// TypeScript preserves source specifiers in declaration output. An ESM
// package needs explicit extensions for strict NodeNext consumers as well as
// bundlers; choose the actual emitted file rather than guessing at directories.
const typesRoot = path.join(output, "types");
const declarations = (await readdir(typesRoot, { recursive: true, withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".d.ts"))
  .map((entry) => path.join(entry.parentPath, entry.name));
const declarationFiles = new Set(declarations);
for (const file of declarations) {
  const content = await readFile(file, "utf8");
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
  const replacements = [];
  function visit(node) {
    const literal = (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) ? node.moduleSpecifier
      : ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) ? node.argument.literal : undefined;
    if (literal && ts.isStringLiteralLike(literal) && literal.text.startsWith(".") && !path.extname(literal.text)) {
      const target = path.resolve(path.dirname(file), literal.text);
      const suffix = declarationFiles.has(`${target}.d.ts`) ? ".js"
        : declarationFiles.has(path.join(target, "index.d.ts")) ? "/index.js" : null;
      if (!suffix) throw new Error(`Declaration imports a missing emitted module: ${file} -> ${literal.text}`);
      replacements.push({ start: literal.getStart(source) + 1, end: literal.end - 1, text: literal.text + suffix });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  let rewritten = content;
  for (const change of replacements.sort((a, b) => b.start - a.start)) rewritten = rewritten.slice(0, change.start) + change.text + rewritten.slice(change.end);
  if (rewritten !== content) await writeFile(file, rewritten);
}
console.log(`Built ${Object.keys(entryPoints).length} tourkit entry points, declarations and styles in ${output}.`);
