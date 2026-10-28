import { describe, expect, it } from "vitest";
import { TutorialManifestSchema } from "./core/schema";
import { createTutorialShareCodec } from "./share";
import legacy from "./testing/fixtures/legacy-share-tokens.json";

const screenshot = { dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=", width: 1, height: 1, alt: "Synthetic screen" };
const manifest = TutorialManifestSchema.parse({
  schemaVersion: 1, id: "projects", title: "Projects", defaultMode: "practice", docs: "/guides/projects/",
  launch: { fixture: "demo", path: "/projects", hash: { board: "review", unsafe: "ignored" } },
  chapters: [{ id: "start", title: "Start", steps: [
    { id: "local", completion: "continue", overlay: { title: "Read", body: "Review the board." }, screenshot, narration: { src: "/audio/projects.webm", startMs: 0, endMs: 1000 } },
    { id: "recorded", completion: "continue", overlay: { title: "Read again", body: "Continue." }, narration: { src: "data:audio/webm;base64,YQ==", startMs: 0, endMs: 1000 } },
  ] }],
});

describe("application-scoped tutorial sharing policy", () => {
  it.each(Object.entries(legacy.tokens))("reads the fixed upstream t1 %s token without a vendor checkout", async (_name, token) => {
    const codec = createTutorialShareCodec({ allowedLaunchPaths: () => new Set(["/projects/"]) });
    expect(await codec.decodeTutorialShare(token)).toEqual(TutorialManifestSchema.parse(legacy.manifest));
    await expect(codec.decodeTutorialShare(token.slice(0, -2) + "xx")).rejects.toThrow("damaged or incomplete");
  });

  it("round-trips an explicitly allowed static file route at a non-root base path", async () => {
    const input = { ...manifest, launch: { ...manifest.launch, path: "/training/project/stage.html" } };
    const codec = createTutorialShareCodec({ allowedLaunchPaths: () => new Set([input.launch.path]) });
    expect((await codec.decodeTutorialShare(await codec.encodeTutorialShare(input))).launch.path).toBe(input.launch.path);
    expect(() => codec.shareableTutorialManifest({ ...input, launch: { ...input.launch, path: "/other/stage.html" } })).toThrow("page");
  });

  it("keeps route validation when a consumer supplies a transport", async () => {
    const codec = createTutorialShareCodec({ allowedLaunchPaths: () => new Set(["/projects/"]) }, {
      compress: async (value) => JSON.stringify(value), decompress: async (token) => JSON.parse(token),
    });
    expect((await codec.decodeTutorialShare(await codec.encodeTutorialShare(manifest))).id).toBe(manifest.id);
    await expect(codec.decodeTutorialShare(JSON.stringify({ ...manifest, launch: { ...manifest.launch, path: "/unapproved/" } }))).rejects.toThrow("page");
  });
  it("round-trips through the real codec while enforcing route, hash and media policy", async () => {
    const codec = createTutorialShareCodec({ allowedLaunchPaths: () => new Set(["/projects/"]), allowedHashKeys: ["board"] });
    const token = await codec.encodeTutorialShare(manifest);
    const decoded = await codec.decodeTutorialShare(token);
    expect(decoded.launch).toEqual({ fixture: "demo", path: "/projects/", hash: { board: "review" } });
    expect(decoded.chapters[0].steps[0].screenshot).toBeUndefined();
    expect(decoded.chapters[0].steps[0].narration?.src).toBe("/audio/projects.webm");
    expect(decoded.chapters[0].steps[1].narration).toBeUndefined();
    expect(manifest.chapters[0].steps[0].screenshot).toEqual(screenshot);
    expect(manifest.launch.hash.unsafe).toBe("ignored");
  });

  it("does not allow one host's token to authorize a route in another host", async () => {
    const projects = createTutorialShareCodec({ allowedLaunchPaths: () => new Set(["/projects/"]) });
    const map = createTutorialShareCodec({ allowedLaunchPaths: () => new Set(["/map/"]) });
    const token = await projects.encodeTutorialShare(manifest);
    await expect(map.decodeTutorialShare(token)).rejects.toThrow("page that tutorials do not run on");
    expect(projects.shareableTutorialManifest(manifest).launch.hash).toEqual({});
  });
});

