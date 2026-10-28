import { TutorialValueSchema, type TutorialSemanticAction, type TutorialValue } from "./schema";
import { resolveTutorialReferences, TutorialAliasStore } from "./references";

/**
 * "derived" marks an action another gesture caused — the builder.addField a
 * gallery's Add to form performs. Practice and autoplay still see it; a
 * recording keeps only the gesture, so one click becomes one step.
 */
export type TutorialActionSource = "user" | "autoplay" | "system" | "derived";

export interface TutorialActionEvent {
  action: string;
  payload?: Readonly<Record<string, TutorialValue>>;
  result?: TutorialValue;
  source: TutorialActionSource;
  timestamp: number;
  sequence: number;
}

export interface TutorialActionInput {
  action: string;
  payload?: Readonly<Record<string, unknown>>;
  result?: unknown;
  source?: TutorialActionSource;
  timestamp?: number;
}

export type TutorialActionListener = (event: TutorialActionEvent) => void;

export interface TutorialActionWaitOptions {
  aliases?: TutorialAliasStore;
  signal?: AbortSignal;
  timeoutMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/**
 * Structural comparison shared by action matching and state checks. Subset
 * mode ignores extra keys and trailing array items in the observed value.
 */
export function tutorialValuesMatch(expected: unknown, actual: unknown, exact = false): boolean {
  return valuesMatch(expected, actual, exact);
}

function valuesMatch(expected: unknown, actual: unknown, exact: boolean): boolean {
  if (Object.is(expected, actual)) return true;
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || (exact && expected.length !== actual.length)) return false;
    if (expected.length > actual.length) return false;
    return expected.every((item, index) => valuesMatch(item, actual[index], exact));
  }
  if (isRecord(expected)) {
    if (!isRecord(actual)) return false;
    const expectedKeys = Object.keys(expected);
    if (exact && expectedKeys.length !== Object.keys(actual).length) return false;
    return expectedKeys.every((key) => key in actual && valuesMatch(expected[key], actual[key], exact));
  }
  return false;
}

export function actionMatches(
  event: TutorialActionEvent,
  expectation: TutorialSemanticAction,
  aliases = new TutorialAliasStore(),
): boolean {
  if (event.action !== expectation.id) return false;
  if (!expectation.args) return true;
  const expectedArgs = resolveTutorialReferences(expectation.args as TutorialValue, aliases);
  return valuesMatch(expectedArgs, event.payload, expectation.match === "exact");
}

function abortError(message: string): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

export class TutorialActionBus {
  readonly #listeners = new Set<TutorialActionListener>();
  #sequence = 0;
  #gestureDepth = 0;

  emit(input: TutorialActionInput): TutorialActionEvent {
    const payload = input.payload
      ? TutorialValueSchema.parse(input.payload) as Record<string, TutorialValue>
      : undefined;
    const result = input.result === undefined ? undefined : TutorialValueSchema.parse(input.result);
    const event: TutorialActionEvent = Object.freeze({
      action: input.action,
      ...(payload ? { payload: Object.freeze(payload) } : {}),
      ...(result !== undefined ? { result } : {}),
      source: input.source ?? "user",
      timestamp: input.timestamp ?? Date.now(),
      sequence: ++this.#sequence,
    });
    for (const listener of [...this.#listeners]) listener(event);
    return event;
  }

  /** Convenience entry point for UI handlers recording a learner action. */
  observe(
    action: string,
    payload?: Readonly<Record<string, TutorialValue>>,
    result?: TutorialValue,
  ): TutorialActionEvent {
    return this.emit({ action, payload, result, source: this.#gestureDepth > 0 ? "derived" : "user" });
  }

  /**
   * Runs a gesture's handler, then publishes the gesture itself. Actions the
   * handler publishes synchronously are marked "derived", so a recording of
   * Add to form is one gallery.addComponent step, not an extra
   * builder.addField pointing at a control the learner never touched.
   */
  gesture(
    action: string,
    run: () => void,
    payload?: Readonly<Record<string, TutorialValue>>,
    result?: TutorialValue,
  ): TutorialActionEvent {
    this.#gestureDepth += 1;
    try {
      run();
    } finally {
      this.#gestureDepth -= 1;
    }
    return this.observe(action, payload, result);
  }

  subscribe(listener: TutorialActionListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  waitFor(
    expectation: TutorialSemanticAction,
    options: TutorialActionWaitOptions = {},
  ): Promise<TutorialActionEvent> {
    const aliases = options.aliases ?? new TutorialAliasStore();
    return new Promise((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(abortError("Tutorial action wait was aborted."));
        return;
      }

      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        unsubscribe();
        if (timer) clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
      };
      const onAbort = () => {
        cleanup();
        reject(abortError("Tutorial action wait was aborted."));
      };
      const unsubscribe = this.subscribe((event) => {
        if (!actionMatches(event, expectation, aliases)) return;
        cleanup();
        if (expectation.resultAlias) aliases.set(expectation.resultAlias, event.result);
        resolve(event);
      });

      options.signal?.addEventListener("abort", onAbort, { once: true });
      if (options.timeoutMs !== undefined) {
        timer = setTimeout(() => {
          cleanup();
          reject(new Error(`Timed out waiting for tutorial action "${expectation.id}".`));
        }, options.timeoutMs);
      }
    });
  }
}

export interface TutorialActionExecutionContext {
  aliases: TutorialAliasStore;
  signal?: AbortSignal;
}

export type TutorialActionExecutor = (
  args: Readonly<Record<string, unknown>>,
  context: TutorialActionExecutionContext,
) => TutorialValue | void | Promise<TutorialValue | void>;

/** Maps durable semantic action ids to real application operations used during autoplay. */
export class TutorialActionRegistry {
  readonly #executors = new Map<string, TutorialActionExecutor>();

  constructor(
    readonly bus = new TutorialActionBus(),
    readonly aliases = new TutorialAliasStore(),
  ) {}

  register(id: string, executor: TutorialActionExecutor): () => void {
    if (this.#executors.has(id)) throw new Error(`Tutorial action "${id}" is already registered.`);
    this.#executors.set(id, executor);
    return () => {
      if (this.#executors.get(id) === executor) this.#executors.delete(id);
    };
  }

  has(id: string): boolean {
    return this.#executors.has(id);
  }

  async execute(action: TutorialSemanticAction, signal?: AbortSignal): Promise<TutorialActionEvent> {
    if (signal?.aborted) throw abortError("Tutorial action execution was aborted.");
    const executor = this.#executors.get(action.id);
    if (!executor) throw new Error(`No executor is registered for tutorial action "${action.id}".`);
    const resolved = action.args
      ? resolveTutorialReferences(action.args as TutorialValue, this.aliases)
      : {};
    const payload = TutorialValueSchema.parse(resolved);
    if (!isRecord(payload)) throw new Error(`Arguments for tutorial action "${action.id}" must be an object.`);
    const result = await executor(payload, { aliases: this.aliases, signal });
    if (action.resultAlias) this.aliases.set(action.resultAlias, result);
    return this.bus.emit({
      action: action.id,
      payload: payload as Record<string, TutorialValue>,
      ...(result !== undefined ? { result } : {}),
      source: "autoplay",
    });
  }
}

export function createTutorialActionBus(): TutorialActionBus {
  return new TutorialActionBus();
}

/** Shared browser-safe stream used by workspace controls and tutorial players. */
export const tutorialActionBus = createTutorialActionBus();

export function createTutorialActionRegistry(
  bus?: TutorialActionBus,
  aliases?: TutorialAliasStore,
): TutorialActionRegistry {
  return new TutorialActionRegistry(bus, aliases);
}

