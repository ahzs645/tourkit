import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

// The dependency list is explicit so adding an application/workspace package
// cannot silently couple the kit to a host application. Keep it in step with
// package.json.
const EXTERNAL_PACKAGES = new Set([
  "@floating-ui/dom", "@radix-ui/react-tooltip", "@rrweb/record", "@rrweb/replay",
  "clsx", "docx", "driver.js", "gifenc", "html2canvas-pro", "jszip",
  "lucide-react", "pdfmake", "pptxgenjs", "react", "react-dom",
  "tailwind-merge", "zod",
]);

function within(directory, file) {
  const relative = path.relative(directory, file);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function filesIn(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory() && !["node_modules", "dist", ".git", "dist-capture-studio", "dist-extension", "dist-extension-advanced", "site", ".artifacts"].includes(entry.name) && !entry.name.startsWith(".tmp-")) files.push(...await filesIn(file));
    else if (entry.isFile() && /(?:\.[cm]?[jt]sx?|\.css)$/.test(entry.name)) files.push(file);
  }
  return files;
}

async function resolves(base) {
  for (const suffix of ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".json", "/index.ts", "/index.tsx"]) {
    try { if ((await stat(base + suffix)).isFile()) return true; }
    catch (error) { if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error; }
  }
  return false;
}

export async function tourkitBoundaryIssues(directory) {
  const issues = [];
  for (const file of await filesIn(directory)) {
    const relative = path.relative(directory, file).split(path.sep).join("/");
    if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(relative) || /^(?:testing|__tests__)\//.test(relative) || relative.endsWith(".d.ts")) continue;
    const content = await readFile(file, "utf8");
    if (file.endsWith(".css")) {
      for (const match of content.matchAll(/@(import|source)\s+["']([^"']+)["']/g)) {
        const [, directive, name] = match;
        if (directive === "import" && name === "tailwindcss") continue;
        if (!name.startsWith(".") || !within(directory, path.resolve(path.dirname(file), name))) issues.push(`${relative} references ${name} outside tourkit; supply styles inside the module.`);
        else if (directive === "import" && !(await resolves(path.resolve(path.dirname(file), name)))) issues.push(`${relative} imports missing stylesheet ${name}.`);
      }
      continue;
    }
    const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
    const imports = [];
    function visit(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) imports.push(node.moduleSpecifier);
      if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) imports.push(node.argument.literal);
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
        if (node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0])) imports.push(node.arguments[0]);
        else issues.push(`${relative} uses a computed module import; keep the reusable module's dependencies inspectable.`);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    for (const node of imports) {
      if (!ts.isStringLiteralLike(node)) continue;
      const name = node.text;
      if (name.startsWith(".")) {
        const target = path.resolve(path.dirname(file), name);
        if (!within(directory, target)) issues.push(`${relative} imports ${name} outside tourkit; inject an application adapter instead.`);
        else if (!(await resolves(target))) issues.push(`${relative} imports missing module ${name}.`);
        else if (relative.startsWith("core/") && !within(path.join(directory, "core"), target)) issues.push(`${relative} imports ${name}; core must not depend on player, recording, export or UI layers.`);
      } else {
        if ((relative.startsWith("tooling/") || relative === "vitest.config.ts") && (name.startsWith("node:") || ["esbuild", "typescript", "vite", "vitest", "jiti", "@tailwindcss/node", "@tailwindcss/oxide", "@playwright/test"].some((dependency) => name === dependency || name.startsWith(`${dependency}/`)))) continue;
        if (relative === "vendor/json-url/web-share.js" && name === "node:zlib") continue;
        if (relative === "vitest.config.ts" && name === "vitest/config") continue;
        const packageName = name.startsWith("@") ? name.split("/").slice(0, 2).join("/") : name.split("/")[0];
        if (!EXTERNAL_PACKAGES.has(packageName)) issues.push(`${relative} imports ${name}; it is not an approved tourkit dependency.`);
        else if (relative.startsWith("core/") && packageName !== "zod") issues.push(`${relative} imports ${name}; core must remain independent of React and rendering libraries.`);
      }
    }
  }
  return issues;
}

