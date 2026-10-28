// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";

import { readTutorialNarrationMode, writeTutorialNarrationMode } from "./narration-mode";

describe("tutorial narration mode setting", () => {
  beforeEach(() => window.localStorage.clear());

  it("defaults to voice and remembers actions-only per browser", () => {
    expect(readTutorialNarrationMode()).toBe("voice");
    writeTutorialNarrationMode("actions-only");
    expect(readTutorialNarrationMode()).toBe("actions-only");
    expect(window.localStorage.getItem("tourkit:narration")).toBe("actions-only");
    writeTutorialNarrationMode("voice");
    expect(readTutorialNarrationMode()).toBe("voice");
    expect(window.localStorage.getItem("tourkit:narration")).toBeNull();
  });

  it("treats an unknown stored value as voice", () => {
    window.localStorage.setItem("tourkit:narration", "whatever");
    expect(readTutorialNarrationMode()).toBe("voice");
  });
});

