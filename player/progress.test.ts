// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";

import {
  clearTutorialProgress,
  readTutorialProgress,
  saveTutorialProgress,
} from "./progress";

describe("tutorial progress persistence", () => {
  afterEach(() => sessionStorage.clear());

  it("round-trips progress and matches on mode and step range", () => {
    saveTutorialProgress("demo", {
      stepIndex: 3,
      mode: "practice",
      aliases: { textField: { id: "field-1" } },
      savedAt: Date.now(),
    });

    expect(readTutorialProgress("demo", "practice", 10)).toMatchObject({
      stepIndex: 3,
      aliases: { textField: { id: "field-1" } },
    });
    expect(readTutorialProgress("demo", "autoplay", 10)).toBeNull();
    expect(readTutorialProgress("demo", "practice", 3)).toBeNull();
  });

  it("ignores malformed records instead of throwing", () => {
    sessionStorage.setItem("tourkit:progress:demo", "{not json");
    expect(readTutorialProgress("demo", "practice", 10)).toBeNull();
    sessionStorage.setItem("tourkit:progress:demo", JSON.stringify({ stepIndex: "x" }));
    expect(readTutorialProgress("demo", "practice", 10)).toBeNull();
  });

  it("clears explicitly", () => {
    saveTutorialProgress("demo", { stepIndex: 1, mode: "practice", aliases: {}, savedAt: Date.now() });
    clearTutorialProgress("demo");
    expect(readTutorialProgress("demo", "practice", 12)).toBeNull();
  });
});

