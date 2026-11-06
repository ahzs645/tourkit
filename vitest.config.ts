import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL(".", import.meta.url));
export default defineConfig({ root, test: { environment: "node", include: ["**/*.test.{ts,tsx}"], exclude: ["**/node_modules/**", "**/dist/**", "tooling/dist-smoke/**"], setupFiles: ["./testing/setup.ts"] }, css: { postcss: { plugins: [] } } });
