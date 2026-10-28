import path from "node:path";
import { fileURLToPath } from "node:url";
import { tourkitBoundaryIssues } from "./boundaries.mjs";
import { verifyTutorialVendor } from "./verify-vendor.mjs";
const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const issues = await tourkitBoundaryIssues(directory);
try { await verifyTutorialVendor(directory); } catch (error) { issues.push(error.message); }
if (issues.length) { console.error("Tourkit boundary check failed:\n" + issues.map((issue) => `- ${issue}`).join("\n")); process.exitCode = 1; }
else console.log("Tourkit boundaries OK: no application imports; core independent of React; pinned codec verified.");
