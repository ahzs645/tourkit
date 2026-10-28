import { describe, expect, it, vi } from "vitest";

import {
  actionMatches,
  TutorialActionBus,
  TutorialActionRegistry,
} from "./actions";
import { TutorialAliasStore } from "./references";
import type { TutorialSemanticAction } from "./schema";

const expectation: TutorialSemanticAction = {
  id: "builder.addField",
  args: { type: "section" },
  match: "subset",
};

describe("tutorial semantic actions", () => {
  it("publishes serializable, timestamped events and matches payload subsets", () => {
    const bus = new TutorialActionBus();
    const event = bus.emit({
      action: "builder.addField",
      payload: { type: "section", label: "History" },
    });

    expect(event.source).toBe("user");
    expect(event.sequence).toBe(1);
    expect(event.timestamp).toEqual(expect.any(Number));
    expect(actionMatches(event, expectation)).toBe(true);
    expect(() => JSON.stringify(event)).not.toThrow();
  });

  it("publishes what a gesture caused as derived, then the gesture itself", () => {
    const bus = new TutorialActionBus();
    const events: { action: string; source: string }[] = [];
    bus.subscribe((event) => events.push({ action: event.action, source: event.source }));
    bus.gesture("gallery.addComponent", () => {
      bus.observe("builder.addField", { type: "component" });
    });
    bus.observe("builder.addField", { type: "text" });
    expect(events).toEqual([
      { action: "builder.addField", source: "derived" },
      { action: "gallery.addComponent", source: "user" },
      { action: "builder.addField", source: "user" },
    ]);
  });

  it("waits for the expected learner action and ignores unrelated actions", async () => {
    const bus = new TutorialActionBus();
    const waiting = bus.waitFor(expectation, { timeoutMs: 1_000 });
    bus.observe("workspace.openTab", { tab: "preview" });
    bus.observe("builder.addField", { type: "section", label: "History" }, { id: "section-1" });

    await expect(waiting).resolves.toMatchObject({ action: "builder.addField" });
  });

  it("resolves aliases for autoplay and captures executor results", async () => {
    const bus = new TutorialActionBus();
    const aliases = new TutorialAliasStore({ section: { id: "section-1" } });
    const registry = new TutorialActionRegistry(bus, aliases);
    const executor = vi.fn(() => ({ id: "field-1" }));
    registry.register("builder.addField", executor);

    const event = await registry.execute({
      id: "builder.addField",
      args: { type: "text", parentId: { $ref: "section.id" } },
      resultAlias: "question",
      match: "subset",
    });

    expect(executor).toHaveBeenCalledWith(
      { type: "text", parentId: "section-1" },
      expect.objectContaining({ aliases }),
    );
    expect(event).toMatchObject({ action: "builder.addField", source: "autoplay" });
    expect(aliases.get("question")).toEqual({ id: "field-1" });
  });

  it("supports cancellation while waiting", async () => {
    const bus = new TutorialActionBus();
    const controller = new AbortController();
    const waiting = bus.waitFor(expectation, { signal: controller.signal });
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects inherited and prototype-traversing alias paths", () => {
    const aliases = new TutorialAliasStore({
      item: { id: "safe" },
      "created.section": { id: "section-1" },
    });

    expect(() => aliases.resolveReference({ $ref: "item.constructor.name" })).toThrow(
      "forbidden path segment",
    );
    expect(() => aliases.resolveReference({ $ref: "item.toString" })).toThrow(
      'could not resolve "toString"',
    );
    expect(aliases.resolveReference({ $ref: "created.section.id" })).toBe("section-1");
  });
});

