import { describe, expect, it } from "vitest";

import {
  buildTutorialLaunchUrl,
  parseTutorialManifest,
  TutorialManifestSchema,
} from "./schema";

const manifestInput = {
  schemaVersion: 1,
  id: "first-form",
  title: "Build your first form",
  launch: {
    fixture: "abc-stamp-form",
    hash: { edit: 1, tutorial: "first-form" },
  },
  chapters: [
    {
      id: "structure",
      title: "Create the structure",
      steps: [
        {
          id: "add-section",
          anchor: { id: "builder.add-section" },
          action: {
            id: "builder.addField",
            args: { type: "section" },
            resultAlias: "section",
          },
          overlay: {
            title: "Add a section",
            body: "Sections group related questions.",
          },
          narration: { src: "/tutorials/first.webm", startMs: 100, endMs: 900 },
        },
      ],
    },
  ],
} as const;

describe("tutorial manifest", () => {
  it("parses defaults and builds builder-compatible hash URLs", () => {
    const manifest = parseTutorialManifest(manifestInput);
    expect(manifest.defaultMode).toBe("practice");
    expect(manifest.chapters[0].steps[0].anchor).toMatchObject({
      id: "builder.add-section",
      placement: "auto",
      waitMs: 5_000,
    });
    expect(buildTutorialLaunchUrl(manifest.launch, "https://webform.example")).toBe(
      "https://webform.example/#edit=1&tutorial=first-form&fixture=abc-stamp-form",
    );
  });

  it("accepts a state check in place of an action, except in autoplay", () => {
    const checked = structuredClone(manifestInput) as Record<string, any>;
    delete checked.chapters[0].steps[0].action;
    checked.chapters[0].steps[0].check = {
      description: "the form contains a new section.",
      all: [{ path: "builder.fields", where: { type: "section" }, mode: "delta" }],
    };
    const parsed = TutorialManifestSchema.parse(checked);
    expect(parsed.chapters[0].steps[0].check?.all[0]).toMatchObject({
      path: "builder.fields",
      mode: "delta",
    });

    const autoplay = structuredClone(checked);
    autoplay.defaultMode = "autoplay";
    expect(TutorialManifestSchema.safeParse(autoplay).success).toBe(false);

    const neither = structuredClone(manifestInput) as Record<string, any>;
    delete neither.chapters[0].steps[0].action;
    expect(TutorialManifestSchema.safeParse(neither).success).toBe(false);
  });

  it.each(["practice", "autoplay"] as const)("accepts explicit Continue explanations in %s without an action or check", (mode) => {
    const explanation = { id: "read-bottom-bar", completion: "continue", mode, overlay: { title: "Bottom Bar", body: "Read the status indicators." } };
    const input = { ...manifestInput, chapters: [{ ...manifestInput.chapters[0], steps: [explanation] }] };
    expect(parseTutorialManifest(input).chapters[0].steps[0]).toMatchObject({ completion: "continue", mode });
    expect(TutorialManifestSchema.safeParse({ ...input, chapters: [{ ...input.chapters[0], steps: [{ ...explanation, completion: "outcome" }] }] }).success).toBe(false);
    expect(TutorialManifestSchema.safeParse({ ...input, chapters: [{ ...input.chapters[0], steps: [{ ...explanation, completion: "invalid" }] }] }).success).toBe(false);
  });

  it("keeps the completion option absent on legacy outcome steps", () => {
    expect(parseTutorialManifest(manifestInput).chapters[0].steps[0]).not.toHaveProperty("completion");
  });

  it("rejects duplicate ids and invalid narration ranges", () => {
    const duplicate = structuredClone(manifestInput) as Record<string, any>;
    duplicate.chapters.push(structuredClone(duplicate.chapters[0]));
    expect(TutorialManifestSchema.safeParse(duplicate).success).toBe(false);

    const badRange = structuredClone(manifestInput) as Record<string, any>;
    badRange.chapters[0].steps[0].narration.endMs = 50;
    expect(TutorialManifestSchema.safeParse(badRange).success).toBe(false);
  });
});

