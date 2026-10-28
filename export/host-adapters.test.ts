import { describe, expect, it, vi } from "vitest";
import { TutorialManifestSchema } from "../core/schema";
import { exportTutorial } from "./index";
import { interactiveTutorialHtml, interactiveTutorialUnavailable } from "./interactive";
import type { TutorialExportRuntime } from "./runtime";
import { tutorialDocument } from "./document";
import { DEFAULT_TUTORIAL_EXPORT_OPTIONS } from "./options";
import { tutorialPdfDefinition } from "./pdf";
import JSZip from "jszip";

const manifest = TutorialManifestSchema.parse({
  schemaVersion: 1, id: "project-tour", title: "Project tour", defaultMode: "practice",
  launch: { fixture: "projects-demo", path: "/projects/", hash: {} },
  chapters: [{ id: "start", title: "Start", steps: [{ id: "intro", completion: "continue", overlay: { title: "Welcome", body: "Open the review board." } }] }],
});

describe("host-provided tutorial export capabilities", () => {
  it("uses neutral document metadata by default and scopes branding to each export", async () => {
    const doc = tutorialDocument({ manifest }, { includeScreenshots: false });
    expect(DEFAULT_TUTORIAL_EXPORT_OPTIONS.branding.author).toBe("");
    expect(tutorialPdfDefinition(doc).info).toMatchObject({ author: "", creator: "Tutorial Studio" });
    const metadata = { defaultAuthor: "Project Academy", creator: "Project Academy" };
    const branded = tutorialPdfDefinition({ ...doc, branding: undefined }, undefined, metadata);
    expect(branded.info).toMatchObject({ author: "Project Academy", creator: "Project Academy" });
    expect(JSON.stringify(branded.content)).not.toContain("Project Academy");
    for (const format of ["docx", "pptx"] as const) {
      const { blob } = await exportTutorial({ manifest }, format, undefined, { includeScreenshots: false }, { metadata });
      const archive = await JSZip.loadAsync(await blob.arrayBuffer());
      expect(await archive.file("docProps/core.xml")!.async("string")).toContain("<dc:creator>Project Academy</dc:creator>");
    }
    expect(tutorialPdfDefinition(doc).info?.creator).toBe("Tutorial Studio");
  });

  it("exports reading guides without loading an application host", async () => {
    const output = await exportTutorial({ manifest }, "markdown", undefined, { includeScreenshots: false });
    expect(output.filename).toBe("Project-tour.md");
    expect(await output.blob.text()).toContain("Open the review board.");
  });

  it("requires an explicit offline implementation and respects its availability checks", async () => {
    const source = { manifest };
    expect(interactiveTutorialUnavailable(source)).toContain("has not supplied");
    await expect(exportTutorial(source, "interactive-html")).rejects.toThrow("has not supplied");
    const exporter = vi.fn(async () => new Blob(["unused"]));
    const runtime: TutorialExportRuntime = { interactive: { unavailable: () => "This fixture is online only.", export: exporter } };
    await expect(exportTutorial(source, "interactive-html", undefined, {}, runtime)).rejects.toThrow("online only");
    expect(exporter).not.toHaveBeenCalled();
  });

  it("uses each application's supplied offline exporter without a global registration", async () => {
    const first: TutorialExportRuntime = { interactive: { unavailable: () => null, export: async () => new Blob(["first host"]) } };
    const second: TutorialExportRuntime = { interactive: { unavailable: () => null, export: async () => new Blob(["second host"]) } };
    expect(await (await exportTutorial({ manifest }, "interactive-html", undefined, {}, first)).blob.text()).toBe("first host");
    expect(await (await exportTutorial({ manifest }, "interactive-html", undefined, {}, second)).blob.text()).toBe("second host");
    await expect(exportTutorial({ manifest }, "interactive-html")).rejects.toThrow("has not supplied");
  });

  it("embeds arbitrary host bootstrap data while keeping lesson data and scripts safely separated", () => {
    const html = interactiveTutorialHtml({ ...manifest, title: "</script><img src=x>" }, {
      version: 1, javascript: 'window.example="</script>";', css: "body{margin:0}",
      data: { boards: [{ id: "review" }], manifest: "untrusted override", highlightStyle: "untrusted override" },
    }, { highlightStyle: "arrow" });
    const data = JSON.parse(html.match(/<script id="tutorial-data" type="application\/json">(.*?)<\/script>/s)![1]);
    expect(data.boards).toEqual([{ id: "review" }]);
    expect(data.manifest.id).toBe("project-tour");
    expect(data.highlightStyle).toBe("arrow");
    expect(html).not.toContain("<img src=x>");
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain('window.example="<\\/script>";');
  });
});
