import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { tourkitBoundaryIssues } from "./boundaries.mjs";

async function fixture(t, files) {
  const root = await mkdtemp(path.join(os.tmpdir(), "tourkit-boundary-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(root, "modules/tourkit", name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
  }
  return tourkitBoundaryIssues(path.join(root, "modules/tourkit"));
}

test("accepts internal dependencies and the existing external runtime dependencies", async (t) => {
  assert.deepEqual(await fixture(t, {
    "core/schema.ts": 'import { z } from "zod"; export const schema = z.string();',
    "player/index.ts": 'import React from "react"; export { schema } from "../core/schema";',
  }), []);
});

test("rejects application aliases, workspace packages, escaped re-exports and dynamic imports", async (t) => {
  const issues = await fixture(t, {
    "studio/bad.ts": [
      'import { catalog } from "@/lib/tutorials/catalog";',
      'export * from "../../../lib/tutorials/catalog";',
      'import type { Host } from "@webforms/mois-classic-host";',
      'const host = import("next/navigation");',
      'const types: import("@/lib/host-emulators/registry").Host = null;',
      'const dynamic = import(hostName);',
    ].join("\n"),
  });
  assert.equal(issues.length, 6);
  assert.ok(issues.some((issue) => issue.includes("outside tourkit")));
  assert.ok(issues.some((issue) => issue.includes("computed module import")));
});

test("keeps core independent of higher layers and reports broken relative imports", async (t) => {
  const issues = await fixture(t, {
    "core/bad.ts": 'import React from "react"; export * from "../player"; export * from "./missing";',
    "player/index.ts": 'export const player = true;',
  });
  assert.equal(issues.length, 3);
  assert.ok(issues.some((issue) => issue.includes("core must not depend")));
  assert.ok(issues.some((issue) => issue.includes("missing module")));
});

test("keeps stylesheet imports and Tailwind source scanning inside the module", async (t) => {
  const issues = await fixture(t, {
    "styles.css": '@import "tailwindcss"; @import "../../app/tailwind.css"; @source "../../components/**/*.tsx";',
  });
  assert.equal(issues.length, 2);
  assert.ok(issues.every((issue) => issue.includes("outside tourkit")));
});

