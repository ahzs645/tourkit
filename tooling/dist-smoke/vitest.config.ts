import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL("../..", import.meta.url));
export default defineConfig({
  root,
  test: { environment: "node", include: ["tooling/dist-smoke/*.test.tsx"], setupFiles: ["./testing/setup.ts"] },
  css: { postcss: { plugins: [] } },
});
