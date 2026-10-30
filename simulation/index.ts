/** A deterministic service adapter for a frontend you control. It never calls the network. */
export type SimulationValue = string | number | boolean | null | SimulationValue[] | { [key: string]: SimulationValue };
export type SimulationRecord = { [key: string]: SimulationValue };

export interface TutorialResponseFixture {
  id: string;
  request: { method: string; url: string; body?: SimulationValue };
  response: { status?: number; headers?: Record<string, string>; body?: SimulationValue };
  /** Limit a fixture to this many matches, then try the next fixture for that request. */
  times?: number;
}

export interface TutorialSimulatedCollection {
  name: string;
  /** Same-origin absolute path, for example /api/projects. */
  path: string;
  records: SimulationRecord[];
  idField?: string;
  required?: string[];
  searchFields?: string[];
}

export interface TutorialServiceSimulationOptions {
  origin: string;
  fixtures?: TutorialResponseFixture[];
  collections?: TutorialSimulatedCollection[];
  onUnhandled?: (request: { method: string; url: string }) => void;
}

export interface TutorialServiceSimulator {
  fetch: typeof globalThis.fetch;
  reset(): void;
  snapshot(): Readonly<Record<string, readonly SimulationRecord[]>>;
  fixtureUses(): Readonly<Record<string, number>>;
}

const MAX_BODY_BYTES = 1_048_576;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const SAFE_HEADERS = new Set(["content-type", "content-language", "cache-control", "etag", "last-modified"]);
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

function assertValue(value: unknown, depth = 0): asserts value is SimulationValue {
  if (depth > 32) throw new Error("Simulation data is nested too deeply.");
  if (value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return;
  if (Array.isArray(value)) { for (const child of value) assertValue(child, depth + 1); return; }
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key)) throw new Error("Unsafe simulation data key.");
      assertValue(child, depth + 1);
    }
    return;
  }
  throw new Error("Simulation data must be finite JSON values.");
}

function stable(value: SimulationValue): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function normalizedUrl(input: string, origin: string): string {
  const url = new URL(input, `${origin}/`);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error("Simulation URLs must be HTTP(S) without credentials.");
  url.hash = "";
  url.searchParams.sort();
  return url.href;
}

function response(body: SimulationValue | undefined, status = 200, headers?: Record<string, string>): Response {
  const filtered = new Headers({ "content-type": "application/json; charset=utf-8" });
  for (const [name, value] of Object.entries(headers ?? {})) if (SAFE_HEADERS.has(name.toLowerCase())) filtered.set(name, value);
  const noBody = status === 204 || status === 205 || status === 304;
  return new Response(noBody || body === undefined ? null : JSON.stringify(body), { status, headers: filtered });
}

/**
 * Exact request fixtures plus explicitly authored CRUD collections. Assign its
 * fetch to an owned demo frontend's API client before startup. It deliberately
 * does not monkey-patch a production page, guess validation rules, intercept
 * arbitrary workers/XHR, or fall through to global fetch.
 */
export function createTutorialServiceSimulator(options: TutorialServiceSimulationOptions): TutorialServiceSimulator {
  const base = new URL(options.origin);
  if (!/^https?:$/.test(base.protocol) || base.username || base.password || base.pathname !== "/" || base.search || base.hash) {
    throw new Error("Simulation origin must be an HTTP(S) origin without a path, query, or credentials.");
  }
  const origin = base.origin;
  const fixtures = (options.fixtures ?? []).map((fixture) => {
    if (!fixture.id || !fixture.request.method || !fixture.request.url) throw new Error("A fixture needs an id, method, and URL.");
    if (fixture.times !== undefined && (!Number.isSafeInteger(fixture.times) || fixture.times < 1)) throw new Error("Fixture times must be a positive integer.");
    const status = fixture.response.status ?? 200;
    if (!Number.isSafeInteger(status) || status < 200 || status > 599) throw new Error("Fixture response status is invalid.");
    if (fixture.request.body !== undefined) assertValue(fixture.request.body);
    if (fixture.response.body !== undefined) assertValue(fixture.response.body);
    return { ...clone(fixture), url: normalizedUrl(fixture.request.url, origin), method: fixture.request.method.toUpperCase() };
  });
  if (new Set(fixtures.map((item) => item.id)).size !== fixtures.length) throw new Error("Fixture ids must be unique.");
  const definitions = (options.collections ?? []).map((collection) => {
    if (!/^[a-z][a-z0-9_-]*$/i.test(collection.name) || FORBIDDEN_KEYS.has(collection.name)) throw new Error("Invalid collection name.");
    if (!/^\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]+$/i.test(collection.path)) throw new Error("Collection paths must be absolute paths without query parameters.");
    const idField = collection.idField ?? "id";
    for (const key of [idField, ...(collection.required ?? []), ...(collection.searchFields ?? [])]) {
      if (!key || FORBIDDEN_KEYS.has(key)) throw new Error("Invalid collection field.");
    }
    const ids = new Set<string>();
    for (const record of collection.records) {
      assertValue(record);
      const id = record[idField];
      if ((typeof id !== "string" && typeof id !== "number") || ids.has(String(id))) throw new Error("Seed records need unique string or number ids.");
      ids.add(String(id));
    }
    return { ...clone(collection), idField };
  });
  if (new Set(definitions.map((item) => item.name)).size !== definitions.length || new Set(definitions.map((item) => item.path)).size !== definitions.length) {
    throw new Error("Collection names and paths must be unique.");
  }
  // A nested collection must win over a parent's record-id prefix, regardless
  // of declaration order (for example /api/items/archive before /api/items).
  const routes = [...definitions].sort((left, right) => right.path.length - left.path.length);
  const rows = new Map<string, SimulationRecord[]>();
  const uses = new Map<string, number>();
  let sequence = 0;
  const reset = () => {
    rows.clear(); uses.clear(); sequence = 0;
    for (const definition of definitions) rows.set(definition.name, clone(definition.records));
  };
  reset();
  const simulatedFetch: typeof globalThis.fetch = async (input, init) => {
    const inputUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const request = new Request(normalizedUrl(inputUrl, origin), input instanceof Request ? { ...{ method: input.method, headers: input.headers, body: input.method === "GET" || input.method === "HEAD" ? undefined : await input.clone().text(), signal: input.signal }, ...init } : init);
    request.signal.throwIfAborted();
    const url = normalizedUrl(request.url, origin);
    const method = request.method.toUpperCase();
    let body: SimulationValue | undefined;
    if (method !== "GET" && method !== "HEAD") {
      const text = await request.text();
      if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return response({ error: "Demo request is too large." }, 413);
      if (text) {
        try { body = JSON.parse(text) as SimulationValue; assertValue(body); }
        catch { return response({ error: "Demo requests must contain safe JSON." }, 400); }
      }
    }
    const fixture = fixtures.find((candidate) => candidate.method === method && candidate.url === url
      && (candidate.times === undefined || (uses.get(candidate.id) ?? 0) < candidate.times)
      && (candidate.request.body === undefined ? body === undefined : body !== undefined && stable(candidate.request.body) === stable(body)));
    if (fixture) {
      uses.set(fixture.id, (uses.get(fixture.id) ?? 0) + 1);
      return response(fixture.response.body, fixture.response.status, fixture.response.headers);
    }
    const parsed = new URL(url);
    const definition = parsed.origin === origin ? routes.find((item) => parsed.pathname === item.path || parsed.pathname.startsWith(`${item.path}/`)) : undefined;
    if (!definition) {
      options.onUnhandled?.({ method, url });
      return response({ error: "This request is not implemented in the demo.", method, url }, 501);
    }
    const records = rows.get(definition.name)!;
    let id: string | undefined;
    try { id = parsed.pathname === definition.path ? undefined : decodeURIComponent(parsed.pathname.slice(definition.path.length + 1)); }
    catch { return response({ error: "Invalid demo record id." }, 400); }
    const index = id === undefined ? -1 : records.findIndex((record) => String(record[definition.idField]) === id);
    if (method === "GET") {
      if (id !== undefined) return index < 0 ? response({ error: "Demo record not found." }, 404) : response(clone(records[index]));
      const query = (parsed.searchParams.get("q") ?? "").toLocaleLowerCase();
      const filtered = query ? records.filter((record) => (definition.searchFields ?? []).some((field) => String(record[field] ?? "").toLocaleLowerCase().includes(query))) : records;
      return response(clone(filtered));
    }
    if (method === "DELETE" && id !== undefined) {
      if (index < 0) return response({ error: "Demo record not found." }, 404);
      records.splice(index, 1); return response(undefined, 204);
    }
    if ((method === "POST" && id === undefined) || ((method === "PUT" || method === "PATCH") && id !== undefined)) {
      if (!body || typeof body !== "object" || Array.isArray(body)) return response({ error: "A JSON object is required." }, 400);
      if (id !== undefined && index < 0) return response({ error: "Demo record not found." }, 404);
      const value: SimulationRecord = method === "PATCH" ? { ...clone(records[index]), ...body } : { ...body };
      const missing = (definition.required ?? []).filter((field) => value[field] === undefined || value[field] === null || value[field] === "");
      if (missing.length) return response({ error: "Complete the required fields.", fields: missing }, 422);
      if (id === undefined) {
        if (value[definition.idField] === undefined) {
          let next: string;
          do { next = `demo-${++sequence}`; } while (records.some((record) => String(record[definition.idField]) === next));
          value[definition.idField] = next;
        }
        const nextId = value[definition.idField];
        if (typeof nextId !== "string" && typeof nextId !== "number") return response({ error: "A record id must be text or a number." }, 400);
        if (records.some((record) => String(record[definition.idField]) === String(nextId))) return response({ error: "This demo record id already exists." }, 409);
        records.push(clone(value)); return response(clone(value), 201);
      }
      if (value[definition.idField] !== undefined && String(value[definition.idField]) !== id) return response({ error: "A demo record id cannot be changed." }, 400);
      value[definition.idField] = records[index][definition.idField];
      records[index] = clone(value); return response(clone(value));
    }
    return response({ error: "This operation is not implemented in the demo." }, 405);
  };
  return {
    fetch: simulatedFetch,
    reset,
    snapshot: () => clone(Object.fromEntries(rows)),
    fixtureUses: () => Object.fromEntries(uses),
  };
}
