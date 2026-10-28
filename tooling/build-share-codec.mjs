#!/usr/bin/env node
/** Deliberate maintainer rebuild; normal kit installs use the checked-in distribution. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { build, version as esbuildVersion } from "esbuild";

const toolingDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultOutput = path.resolve(toolingDirectory, "../vendor/json-url");
const defaultLock = path.join(toolingDirectory, "share-codec.lock.json");
export const TUTORIAL_SHARE_CODECS = Object.freeze(["lz", "gz", "df", "zl", "raw", "hgz"]);
const upstreamCodecs = ["lzma", "lzstring", "lzw", "pack", "raw", "gz", "hgz", "df", "zl", "br", "hbr", "pbr", "pdf", "lz"];
const registryFile = "src/main/codecs/index.ts";
const browserAliases = {
  assert: "node_modules/assert/build/assert.js",
  events: "node_modules/events/events.js",
  util: "node_modules/util/util.js",
  // Kept as an explicit browser-only resolution rule; this codec is excluded.
  lzma: "node_modules/lzma/src/lzma_worker-min.js",
};
const buildOptions = {
  bundle: true, platform: "browser", format: "esm", target: "es2022", minify: true,
  external: ["node:*"], define: { "process.env.NODE_ENV": '"production"' },
};

export const shareCodecSha256 = (value) => createHash("sha256").update(value).digest("hex");
// The pinned source was also distributed as an API snapshot. Its terminal LF
// may differ from a Git checkout; no other source character is normalized.
export const normalizeShareCodecSource = (value) => value.toString("utf8").replace(/\n+$/, "");

function inside(directory, name) {
  const filename = path.resolve(directory, name);
  if (name.includes("\\") || !filename.startsWith(directory + path.sep)) throw new Error(`Invalid locked input path: ${name}`);
  return filename;
}

/** Remove loader registrations only. The selected algorithms and entry stay unchanged. */
export function selectTutorialCodecRegistry(source) {
  const entry = /^\t([a-z]+): async \(\) => \(await import\('\.\/([a-z]+)\.js'\)\)\.default,?\r?$/gm;
  const matches = [...source.matchAll(entry)];
  if (matches.length !== upstreamCodecs.length || matches.some((match, index) => match[1] !== upstreamCodecs[index] || match[2] !== match[1])) {
    throw new Error("The pinned upstream codec registry changed; review the selection patch before rebuilding.");
  }
  return source.replace(entry, (line, name) => TUTORIAL_SHARE_CODECS.includes(name) ? line : "");
}

export async function verifyShareCodecSource(upstream, lock) {
  const directory = await realpath(upstream);
  const contents = new Map();
  for (const [name, expected] of Object.entries(lock.sourceFiles).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    const source = normalizeShareCodecSource(await readFile(inside(directory, name)));
    if (shareCodecSha256(source) !== expected) throw new Error(`Pinned upstream source identity differs: ${name}`);
    contents.set(name, source + "\n");
  }
  const manifest = JSON.parse(contents.get("package.json"));
  if (manifest.name !== lock.name || manifest.version !== lock.version) throw new Error("The upstream package identity differs from the codec lock.");
  // Content identities are always checked. A real checkout additionally has to
  // identify the pinned commit; an exported source tree needs no .git folder.
  const entries = await readdir(directory);
  if (entries.includes(".git")) {
    const revision = execFileSync("git", ["-C", directory, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    if (revision !== lock.revision) throw new Error(`Expected upstream revision ${lock.revision}; found ${revision}.`);
  }
  return { directory, contents };
}

async function packageIdentity(directory) {
  try {
    const value = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
    return `${value.name}@${value.version}`;
  } catch { return undefined; }
}

/** Find exact installed versions without depending on npm/pnpm hoisting. */
async function installedPackages(upstream, lock) {
  const found = new Map();
  for (const [location, identity] of Object.entries(lock.dependencyLocations)) {
    const candidate = inside(upstream, location);
    if (!found.has(identity) && await packageIdentity(candidate) === identity) found.set(identity, candidate);
  }
  const visited = new Set();
  async function scanModules(directory) {
    if (found.size === Object.keys(lock.dependencies).length) return;
    let canonical;
    try { canonical = await realpath(directory); } catch { return; }
    if (visited.has(canonical)) return;
    visited.add(canonical);
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      if (entry.name === ".pnpm") {
        for (const item of await readdir(path.join(directory, entry.name))) await scanModules(path.join(directory, entry.name, item, "node_modules"));
        continue;
      }
      if (entry.name.startsWith(".")) continue;
      const candidate = path.join(directory, entry.name);
      if (entry.name.startsWith("@")) { await scanModules(candidate); continue; }
      const identity = await packageIdentity(candidate);
      if (lock.dependencies[identity] && !found.has(identity)) found.set(identity, candidate);
      await scanModules(path.join(candidate, "node_modules"));
    }
  }
  await scanModules(path.join(upstream, "node_modules"));
  const missing = Object.keys(lock.dependencies).filter((identity) => !found.has(identity));
  if (missing.length) throw new Error(`Install the exact refresh dependencies recorded in share-codec.lock.json. Missing: ${missing.join(", ")}`);
  return found;
}

function requireNotice(identity, dependency) {
  if (!dependency.notices?.length) {
    throw new Error(`No complete license/notice text is locked for ${identity} (${dependency.license}). A package URL is not a license notice.`);
  }
  for (const filename of dependency.notices) {
    if (!dependency.files[filename]) throw new Error(`Unpinned license/notice text for ${identity}: ${filename}`);
  }
}

export async function prepareShareCodecInputs(upstream, lock, stage) {
  const source = await verifyShareCodecSource(upstream, lock);
  for (const [name, content] of source.contents) {
    const target = inside(stage, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  const locations = await installedPackages(source.directory, lock);
  const dependencies = {};
  const notices = ["Bundled dependencies of the six-codec json-url tutorial distribution.\nUpstream json-url license is in LICENSE.\n"];
  const bytesByPackage = new Map();
  for (const [identity, dependency] of Object.entries(lock.dependencies).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    requireNotice(identity, dependency);
    const files = new Map();
    for (const [name, expected] of Object.entries(dependency.files)) {
      const bytes = await readFile(inside(locations.get(identity), name));
      if (shareCodecSha256(bytes) !== expected) throw new Error(`Pinned dependency input differs: ${identity}/${name}`);
      files.set(name, bytes);
    }
    const manifest = JSON.parse(files.get("package.json").toString("utf8"));
    if (`${manifest.name}@${manifest.version}` !== identity || manifest.license !== dependency.license) throw new Error(`Dependency metadata differs: ${identity}`);
    if (dependency.notices.some((name) => !files.get(name).toString("utf8").trim())) throw new Error(`Empty license/notice text for ${identity}.`);
    bytesByPackage.set(identity, files);
    dependencies[identity] = { name: dependency.name, version: dependency.version, license: dependency.license,
      notices: dependency.notices, inputSha256: shareCodecSha256(JSON.stringify(dependency.files)) };
    notices.push(`${"=".repeat(72)}\n${identity}\nLicense: ${dependency.license}\n\n${dependency.notices.map((name) => `--- ${name} ---\n${files.get(name).toString("utf8").trimEnd()}`).join("\n\n")}\n`);
  }
  // Recreate the locked module graph in a temporary tree. Installed duplicates
  // can be hoisted or symlinked differently without changing the release bytes.
  for (const [location, identity] of Object.entries(lock.dependencyLocations)) {
    for (const [name, bytes] of bytesByPackage.get(identity)) {
      const target = inside(stage, `${location}/${name}`);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bytes);
    }
  }
  return { dependencies, notices: notices.join("\n"), license: source.contents.get("LICENSE") };
}

export async function buildShareCodec(upstream, { outputDirectory = defaultOutput, check = false, lockFile = defaultLock } = {}) {
  if (!upstream) throw new Error("Supply an explicit upstream json-url checkout or source snapshot path.");
  const lockBytes = await readFile(lockFile);
  const lock = JSON.parse(lockBytes);
  if (lock.schemaVersion !== 1 || lock.compiler?.version !== esbuildVersion) throw new Error(`Rebuild requires esbuild ${lock.compiler?.version}; found ${esbuildVersion}.`);
  if (JSON.stringify(lock.codecs) !== JSON.stringify(TUTORIAL_SHARE_CODECS)) throw new Error("The locked codec policy differs from the tutorial sharing policy.");
  // esbuild reports real paths; macOS tmpdir() is behind a /var -> /private/var symlink.
  const stage = await realpath(await mkdtemp(path.join(tmpdir(), "tutorial-share-codec-")));
  try {
    const prepared = await prepareShareCodecInputs(path.resolve(upstream), lock, stage);
    const originalRegistry = await readFile(path.join(stage, registryFile), "utf8");
    const selectedRegistry = selectTutorialCodecRegistry(originalRegistry);
    const result = await build({ ...buildOptions, absWorkingDir: stage, entryPoints: [lock.entry],
      outfile: "dist/web-share.js", write: false, metafile: true,
      alias: Object.fromEntries(Object.entries(browserAliases).map(([name, target]) => [name, path.join(stage, target)])),
      plugins: [{ name: "tutorial-share-codec-subset", setup(builder) {
        builder.onLoad({ filter: /[/\\]src[/\\]main[/\\]codecs[/\\]index\.ts$/ }, ({ path: filename }) => {
          if (filename !== path.join(stage, registryFile)) throw new Error("Unexpected codec registry path.");
          return { contents: selectedRegistry, loader: "ts", resolveDir: path.dirname(filename) };
        });
      } }],
    });
    if (result.outputFiles.length !== 1 || Object.values(result.metafile.outputs).some((output) => output.imports.length)) throw new Error("The sharing distribution must remain one self-contained browser ESM file.");
    const inputs = {};
    for (const filename of Object.keys(result.metafile.inputs).sort()) {
      if (/(^|\/)node_modules\/(?:node-lzw|lzma)\//.test(filename)) throw new Error(`An excluded codec dependency was bundled: ${filename}`);
      inputs[filename] = shareCodecSha256(filename === registryFile ? selectedRegistry : await readFile(inside(stage, filename)));
    }
    const code = result.outputFiles[0].contents;
    const provenance = {
      repository: lock.repository, revision: lock.revision, version: lock.version, entry: lock.entry,
      codecs: TUTORIAL_SHARE_CODECS,
      build: "esbuild browser ESM; ES2022; minified; node:* external; pinned browser aliases; six-codec registry selection",
      compiler: lock.compiler, buildOptions, browserAliases,
      modifications: [{ file: registryFile, operation: "Keep only the six tutorial codec loader registrations; selected algorithms and web-share entry are unchanged.", sha256: inputs[registryFile] }],
      sourceNormalization: lock.sourceNormalization, sourceFiles: lock.sourceFiles,
      lockSha256: shareCodecSha256(lockBytes), builderSha256: shareCodecSha256(await readFile(fileURLToPath(import.meta.url))),
      sha256: shareCodecSha256(code), dependencies: prepared.dependencies, inputs,
      notices: { LICENSE: shareCodecSha256(prepared.license), "THIRD_PARTY_NOTICES.txt": shareCodecSha256(prepared.notices) },
    };
    const files = { "web-share.js": code, LICENSE: prepared.license, "THIRD_PARTY_NOTICES.txt": prepared.notices, "provenance.json": JSON.stringify(provenance, null, 2) + "\n" };
    const output = path.resolve(outputDirectory);
    if (check) {
      for (const [name, bytes] of Object.entries(files)) {
        let existing;
        try { existing = await readFile(path.join(output, name)); } catch { throw new Error(`Rebuild check failed: ${name} is missing from ${output}.`); }
        if (!Buffer.from(bytes).equals(existing)) throw new Error(`Rebuild check failed: ${name} differs in ${output}. Review the inputs and regenerate deliberately.`);
      }
    } else {
      await mkdir(output, { recursive: true });
      for (const [name, bytes] of Object.entries(files)) await writeFile(path.join(output, name), bytes);
    }
    return { output, provenance, bytes: code.length, check };
  } finally { await rm(stage, { recursive: true, force: true }); }
}

export async function runShareCodecBuild(args = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    "out-dir": { type: "string" }, check: { type: "boolean", default: false }, help: { type: "boolean", default: false },
  } });
  if (values.help) {
    console.log("Usage: node tooling/build-share-codec.mjs <upstream-checkout> [--check] [--out-dir <directory>]\nRequires the pinned source and exact refresh dependencies in share-codec.lock.json. --check rebuilds in a temporary tree and compares all generated files without writing the distribution. Normal kit build/install never invokes this maintainer tool.");
    return;
  }
  if (positionals.length !== 1) throw new Error("Supply exactly one explicit upstream json-url checkout or source snapshot path. Use --help for usage.");
  const result = await buildShareCodec(positionals[0], { outputDirectory: values["out-dir"], check: values.check });
  console.log(`${result.check ? "Verified" : "Built"} six tutorial share codecs (${result.bytes} bytes, SHA-256 ${result.provenance.sha256}) in ${result.output}.`);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runShareCodecBuild().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
