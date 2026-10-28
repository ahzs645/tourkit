import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { version } from "esbuild";
import { buildShareCodec, normalizeShareCodecSource, selectTutorialCodecRegistry, shareCodecSha256, TUTORIAL_SHARE_CODECS } from "./build-share-codec.mjs";
import { verifyTutorialVendor } from "./verify-vendor.mjs";

const algorithms = ["lzma", "lzstring", "lzw", "pack", "raw", "gz", "hgz", "df", "zl", "br", "hbr", "pbr", "pdf", "lz"];
const registry = `const ALGORITHMS = {\n${algorithms.map((name) => `\t${name}: async () => (await import('./${name}.js')).default,`).join("\n")}\n};\nexport default ALGORITHMS;\n`;

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "tutorial-codec-build-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const upstream = path.join(directory, "source");
  const outputDirectory = path.join(directory, "distribution");
  const lockFile = path.join(directory, "codec.lock.json");
  const source = {
    "package.json": JSON.stringify({ name: "codec-test-source", version: "1.0.0", type: "module" }),
    LICENSE: "MIT fixture source license\n",
    "src/main/web-share.ts": "import algorithms from './codecs/index.js'; import support from 'codec-test-support'; export default async () => ({ support, codecs: Object.fromEntries(await Promise.all(Object.entries(algorithms).map(async ([id, load]) => [id, (await load()).value]))) });\n",
    "src/main/codecs/index.ts": registry,
    ...Object.fromEntries(algorithms.map((name) => [`src/main/codecs/${name}.ts`, TUTORIAL_SHARE_CODECS.includes(name) ? `export default { value: ${JSON.stringify(name)} };\n` : `throw new Error('Excluded algorithm ran: ${name}'); export default {value: 'invalid'};\n`])),
  };
  for (const [name, bytes] of Object.entries(source)) {
    await mkdir(path.dirname(path.join(upstream, name)), { recursive: true });
    await writeFile(path.join(upstream, name), bytes);
  }
  const support = {
    "package.json": JSON.stringify({ name: "codec-test-support", version: "1.0.0", type: "module", main: "index.js", license: "MIT" }),
    "index.js": "export default 'original dependency';\n",
    LICENSE: "MIT fixture dependency license\n",
  };
  const supportLocation = "node_modules/codec-test-support";
  await mkdir(path.join(upstream, supportLocation), { recursive: true });
  for (const [name, bytes] of Object.entries(support)) await writeFile(path.join(upstream, supportLocation, name), bytes);
  const lock = {
    schemaVersion: 1, repository: "https://example.invalid/test-source", revision: "0".repeat(40), name: "codec-test-source", version: "1.0.0",
    entry: "src/main/web-share.ts", compiler: { name: "esbuild", version }, codecs: TUTORIAL_SHARE_CODECS,
    sourceNormalization: "UTF-8; remove terminal LF characters; stage with one LF.",
    sourceFiles: Object.fromEntries(Object.entries(source).map(([name, bytes]) => [name, shareCodecSha256(normalizeShareCodecSource(bytes))])),
    dependencies: { "codec-test-support@1.0.0": { name: "codec-test-support", version: "1.0.0", license: "MIT", notices: ["LICENSE"],
      files: Object.fromEntries(Object.entries(support).map(([name, bytes]) => [name, shareCodecSha256(bytes)])) } },
    dependencyLocations: { [supportLocation]: "codec-test-support@1.0.0" },
  };
  await writeFile(lockFile, JSON.stringify(lock));
  return { upstream, lock, outputDirectory, lockFile, supportLocation };
}

test("registry selection preserves the six upstream loaders and rejects registry drift", () => {
  const selected = selectTutorialCodecRegistry(registry);
  for (const name of algorithms) assert.equal(selected.includes(`import('./${name}.js')`), TUTORIAL_SHARE_CODECS.includes(name));
  assert.throws(() => selectTutorialCodecRegistry(registry.replace("import('./gz.js')", "import('./other.js')")), /registry changed/);
});

test("rebuild executes the selected code, records exact notices and checks all generated files without writing", async (t) => {
  const state = await fixture(t);
  const result = await buildShareCodec(state.upstream, state);
  const bytes = await readFile(path.join(state.outputDirectory, "web-share.js"));
  const { default: run } = await import(`data:text/javascript;base64,${bytes.toString("base64")}`);
  assert.deepEqual(await run(), { support: "original dependency", codecs: Object.fromEntries(TUTORIAL_SHARE_CODECS.map((name) => [name, name])) });
  assert.equal(result.provenance.sha256, shareCodecSha256(bytes));
  assert.match(await readFile(path.join(state.outputDirectory, "THIRD_PARTY_NOTICES.txt"), "utf8"), /MIT fixture dependency license/);
  assert.deepEqual(Object.keys(result.provenance.dependencies), ["codec-test-support@1.0.0"]);
  await buildShareCodec(state.upstream, { ...state, check: true });
  const changed = Buffer.from("// changed distribution\n");
  await writeFile(path.join(state.outputDirectory, "web-share.js"), changed);
  await assert.rejects(buildShareCodec(state.upstream, { ...state, check: true }), /web-share\.js differs/);
  assert.deepEqual(await readFile(path.join(state.outputDirectory, "web-share.js")), changed);
});

test("refresh is byte reproducible across installed dependency layouts and terminal-LF source snapshots", async (t) => {
  const state = await fixture(t);
  await buildShareCodec(state.upstream, state);
  const holder = path.join(state.upstream, "node_modules/container/node_modules");
  await mkdir(holder, { recursive: true });
  await rename(path.join(state.upstream, state.supportLocation), path.join(holder, "codec-test-support"));
  const filename = path.join(state.upstream, "src/main/codecs/index.ts");
  await writeFile(filename, (await readFile(filename, "utf8")) + "\n");
  await buildShareCodec(state.upstream, { ...state, check: true });
});

test("changed source, dependency content and incomplete license notices fail before release output is written", async (t) => {
  const state = await fixture(t);
  const source = path.join(state.upstream, "src/main/codecs/gz.ts");
  const original = await readFile(source);
  await writeFile(source, "export default { value: 'changed algorithm' };\n");
  await assert.rejects(buildShareCodec(state.upstream, state), /source identity differs: src\/main\/codecs\/gz\.ts/);
  await writeFile(source, original);
  const dependency = path.join(state.upstream, state.supportLocation, "index.js");
  await writeFile(dependency, "export default 'changed dependency';\n");
  await assert.rejects(buildShareCodec(state.upstream, state), /dependency input differs/);
  state.lock.dependencies["codec-test-support@1.0.0"].license = "GPL";
  state.lock.dependencies["codec-test-support@1.0.0"].notices = [];
  await writeFile(state.lockFile, JSON.stringify(state.lock));
  await assert.rejects(buildShareCodec(state.upstream, state), /No complete license\/notice text.*GPL/);
  await assert.rejects(readFile(path.join(state.outputDirectory, "web-share.js")), { code: "ENOENT" });
});

test("normal offline verification detects bundle, notice, build-lock and builder changes without upstream access", async (t) => {
  const state = await fixture(t);
  const kit = path.join(path.dirname(state.outputDirectory), "offline-kit");
  const outputDirectory = path.join(kit, "vendor/json-url");
  await mkdir(path.join(kit, "tooling"), { recursive: true });
  await writeFile(path.join(kit, "tooling/build-share-codec.mjs"), await readFile(fileURLToPath(new URL("./build-share-codec.mjs", import.meta.url))));
  await writeFile(path.join(kit, "tooling/share-codec.lock.json"), await readFile(state.lockFile));
  await buildShareCodec(state.upstream, { ...state, outputDirectory });
  await rm(state.upstream, { recursive: true });
  await verifyTutorialVendor(kit);
  for (const name of ["vendor/json-url/web-share.js", "vendor/json-url/LICENSE", "vendor/json-url/THIRD_PARTY_NOTICES.txt", "tooling/share-codec.lock.json", "tooling/build-share-codec.mjs"]) {
    const filename = path.join(kit, name);
    const original = await readFile(filename);
    await writeFile(filename, Buffer.concat([original, Buffer.from("\nchanged\n")]));
    await assert.rejects(verifyTutorialVendor(kit), (error) => error.message.includes("changed without matching provenance") && error.message.endsWith(name));
    await writeFile(filename, original);
  }
  await verifyTutorialVendor(kit);
});
