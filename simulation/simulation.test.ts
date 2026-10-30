import { describe, expect, it, vi } from "vitest";
import { createTutorialServiceSimulator } from "./index";

describe("local service simulation", () => {
  it("persists a learner's values through create, read, edit, search and reset", async () => {
    const simulator = createTutorialServiceSimulator({ origin: "https://demo.example", collections: [{ name: "projects", path: "/api/projects", records: [], required: ["name"], searchFields: ["name"] }] });
    const invalid = await simulator.fetch("/api/projects", { method: "POST", body: "{}" });
    expect(invalid.status).toBe(422);
    const created = await (await simulator.fetch("/api/projects", { method: "POST", body: JSON.stringify({ name: "My own project", priority: "high" }) })).json();
    expect(created).toMatchObject({ id: "demo-1", name: "My own project" });
    expect(await (await simulator.fetch(`/api/projects/${created.id}`)).json()).toEqual(created);
    await simulator.fetch(`/api/projects/${created.id}`, { method: "PATCH", body: JSON.stringify({ name: "Changed" }) });
    expect(await (await simulator.fetch("/api/projects?q=changed")).json()).toEqual([{ ...created, name: "Changed" }]);
    const snapshot = simulator.snapshot();
    (snapshot.projects[0] as { name: string }).name = "external mutation";
    expect(simulator.snapshot().projects[0].name).toBe("Changed");
    simulator.reset();
    expect(await (await simulator.fetch("/api/projects")).json()).toEqual([]);
  });

  it("matches URL, method, body and fixture occurrence without contacting the network", async () => {
    const nativeFetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network must not be used"));
    try {
      const simulator = createTutorialServiceSimulator({ origin: "https://demo.example", fixtures: [
        { id: "first", times: 1, request: { method: "POST", url: "/graphql", body: { operationName: "Get", variables: { id: 1 } } }, response: { body: { phase: "first" }, headers: { "set-cookie": "secret", "location": "https://production.example" } } },
        { id: "second", request: { method: "POST", url: "/graphql", body: { operationName: "Get", variables: { id: 1 } } }, response: { body: { phase: "second" } } },
      ] });
      const request = () => simulator.fetch("/graphql", { method: "POST", body: JSON.stringify({ variables: { id: 1 }, operationName: "Get" }) });
      const first = await request();
      expect(await first.json()).toEqual({ phase: "first" });
      expect(first.headers.has("set-cookie")).toBe(false);
      expect(first.headers.has("location")).toBe(false);
      expect(await (await request()).json()).toEqual({ phase: "second" });
      expect((await simulator.fetch("https://production.example/api/projects")).status).toBe(501);
      expect((await simulator.fetch("/graphql", { method: "POST", body: JSON.stringify({ operationName: "Get", variables: { id: 2 } }) })).status).toBe(501);
      expect(nativeFetch).not.toHaveBeenCalled();
      simulator.reset();
      expect(await (await request()).json()).toEqual({ phase: "first" });
    } finally { nativeFetch.mockRestore(); }
  });

  it("rejects unsafe input and prevents identity changes", async () => {
    const simulator = createTutorialServiceSimulator({ origin: "https://demo.example", collections: [{ name: "items", path: "/api/items", records: [{ id: "a", name: "A" }] }] });
    expect((await simulator.fetch("/api/items", { method: "POST", body: '{"__proto__":{"admin":true}}' })).status).toBe(400);
    expect((await simulator.fetch("/api/items/a", { method: "PATCH", body: '{"id":"b"}' })).status).toBe(400);
    expect(simulator.snapshot().items[0].id).toBe("a");
    expect(() => createTutorialServiceSimulator({ origin: "https://demo.example/path" })).toThrow(/origin/);
    expect((await simulator.fetch("/api/items/missing")).status).toBe(404);
    expect((await simulator.fetch("/api/items/a", { method: "DELETE" })).status).toBe(204);
    expect(simulator.snapshot().items).toEqual([]);
  });

  it("routes nested collections before parent record paths independently of declaration order", async () => {
    const simulator = createTutorialServiceSimulator({ origin: "https://demo.example", collections: [
      { name: "items", path: "/api/items", records: [{ id: "a", name: "Current" }] },
      { name: "archive", path: "/api/items/archive", records: [{ id: "b", name: "Archived" }] },
    ] });
    expect(await (await simulator.fetch("/api/items/archive")).json()).toEqual([{ id: "b", name: "Archived" }]);
    expect(await (await simulator.fetch("/api/items/archive/b")).json()).toEqual({ id: "b", name: "Archived" });
    await simulator.fetch("/api/items/archive/b", { method: "PATCH", body: '{"name":"Updated archive"}' });
    expect(simulator.snapshot().archive[0].name).toBe("Updated archive");
    expect(simulator.snapshot().items[0].name).toBe("Current");
  });
});
