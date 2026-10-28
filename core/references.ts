import type { TutorialReference, TutorialValue } from "./schema";

function isReference(value: unknown): value is TutorialReference {
  return Boolean(
    value
      && typeof value === "object"
      && !Array.isArray(value)
      && Object.keys(value).length === 1
      && typeof (value as { $ref?: unknown }).$ref === "string",
  );
}

function readPath(root: unknown, path: string[], reference: string): unknown {
  let current = root;
  for (const segment of path) {
    if (segment === "__proto__" || segment === "prototype" || segment === "constructor") {
      throw new Error(`Tutorial reference "${reference}" contains a forbidden path segment.`);
    }
    if (current === null || current === undefined) {
      throw new Error(`Tutorial reference "${reference}" could not resolve "${segment}".`);
    }
    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      current = current[Number(segment)];
      continue;
    }
    if (typeof current !== "object" || !Object.prototype.hasOwnProperty.call(current, segment)) {
      throw new Error(`Tutorial reference "${reference}" could not resolve "${segment}".`);
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export class TutorialAliasStore {
  readonly #values = new Map<string, unknown>();

  constructor(initial?: Readonly<Record<string, unknown>>) {
    for (const [key, value] of Object.entries(initial ?? {})) this.set(key, value);
  }

  has(alias: string): boolean {
    return this.#values.has(alias);
  }

  get(alias: string): unknown {
    if (!this.#values.has(alias)) throw new Error(`Unknown tutorial alias "${alias}".`);
    return this.#values.get(alias);
  }

  set(alias: string, value: unknown): void {
    const containsForbiddenSegment = alias
      .split(".")
      .some((segment) => segment === "__proto__" || segment === "prototype" || segment === "constructor");
    if (!/^[a-z0-9][a-z0-9._:-]*$/i.test(alias) || containsForbiddenSegment) {
      throw new Error(`Invalid tutorial alias "${alias}".`);
    }
    this.#values.set(alias, value);
  }

  delete(alias: string): boolean {
    return this.#values.delete(alias);
  }

  clear(): void {
    this.#values.clear();
  }

  resolveReference(reference: TutorialReference): unknown {
    const segments = reference.$ref.split(".");
    for (let index = segments.length; index > 0; index -= 1) {
      const alias = segments.slice(0, index).join(".");
      if (!this.#values.has(alias)) continue;
      return readPath(this.get(alias), segments.slice(index), reference.$ref);
    }
    throw new Error(`Unknown tutorial alias "${segments[0]}".`);
  }

  snapshot(): Readonly<Record<string, unknown>> {
    return Object.fromEntries(this.#values);
  }
}

/** Resolve explicit {$ref: "alias.path"} values without treating ordinary strings as templates. */
export function resolveTutorialReferences(value: TutorialValue, aliases: TutorialAliasStore): unknown {
  if (isReference(value)) return aliases.resolveReference(value);
  if (Array.isArray(value)) return value.map((item) => resolveTutorialReferences(item, aliases));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, resolveTutorialReferences(item, aliases)]),
    );
  }
  return value;
}

