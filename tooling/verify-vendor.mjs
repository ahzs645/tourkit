import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function verifyTutorialVendor(directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")) {
  const vendor = path.join(directory, "vendor/json-url");
  const manifest = JSON.parse(await readFile(path.join(vendor, "provenance.json"), "utf8"));
  // These checks need only the extracted kit. Do not import the maintainer
  // builder or resolve any upstream codec dependencies during normal builds.
  const identities = [
    ["vendor/json-url/web-share.js", manifest.sha256],
    ["vendor/json-url/LICENSE", manifest.notices?.LICENSE],
    ["vendor/json-url/THIRD_PARTY_NOTICES.txt", manifest.notices?.["THIRD_PARTY_NOTICES.txt"]],
    ["tooling/share-codec.lock.json", manifest.lockSha256],
    ["tooling/build-share-codec.mjs", manifest.builderSha256],
  ];
  for (const [name, expected] of identities) {
    if (typeof expected !== "string" || !/^[a-f0-9]{64}$/.test(expected)) throw new Error(`Missing pinned share-codec provenance hash: ${name}`);
    const bytes = await readFile(path.join(directory, name));
    if (!bytes.toString("utf8").trim()) throw new Error(`Empty pinned share-codec file: ${name}`);
    const checksum = createHash("sha256").update(bytes).digest("hex");
    if (checksum !== expected) throw new Error(`The pinned share-codec file changed without matching provenance: ${name}`);
  }
  return manifest;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const value = await verifyTutorialVendor();
  console.log(`Pinned share codec verified: ${value.version} at ${value.revision}.`);
}
