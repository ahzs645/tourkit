import { tutorialValuesMatch } from "./actions";
import { resolveTutorialReferences, TutorialAliasStore } from "./references";
import type { TutorialCheck, TutorialCheckClause, TutorialValue } from "./schema";

export interface TutorialCheckEvaluation {
  satisfied: boolean;
  /** Aliases captured by satisfied clauses, applied by the caller on success. */
  captures: Record<string, TutorialValue>;
  /** Snapshot paths or aliases a clause could not resolve, for authoring diagnostics. */
  unresolved: string[];
}

const FORBIDDEN_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

/** Reads a dotted snapshot path, returning undefined instead of throwing. */
export function readTutorialStatePath(state: unknown, path: string): unknown {
  let current = state;
  for (const segment of path.split(".")) {
    if (FORBIDDEN_SEGMENTS.has(segment)) return undefined;
    if (current === null || typeof current !== "object") return undefined;
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(segment)) return undefined;
      current = current[Number(segment)];
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function itemId(item: unknown): string | null {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const id = (item as { id?: unknown }).id;
  return typeof id === "string" ? id : null;
}

function toCapture(value: unknown): TutorialValue {
  return value as TutorialValue;
}

interface ClauseEvaluation {
  satisfied: boolean;
  capture?: TutorialValue;
  unresolved?: string;
}

function evaluateClause(
  clause: TutorialCheckClause,
  state: unknown,
  baseline: unknown,
  aliases: TutorialAliasStore,
): ClauseEvaluation {
  let where: unknown;
  let equals: unknown;
  try {
    where = clause.where ? resolveTutorialReferences(clause.where as TutorialValue, aliases) : undefined;
    equals = clause.equals !== undefined
      ? resolveTutorialReferences(clause.equals, aliases)
      : undefined;
  } catch {
    // An alias the learner has not produced yet (for example after jumping
    // steps) simply means the outcome cannot be satisfied yet.
    return { satisfied: false, unresolved: clause.path };
  }

  const value = readTutorialStatePath(state, clause.path);
  if (value === undefined) return { satisfied: false, unresolved: clause.path };
  const baselineValue = clause.mode === "delta" ? readTutorialStatePath(baseline, clause.path) : undefined;

  if (Array.isArray(value)) {
    const matching = where === undefined
      ? value
      : value.filter((item) => tutorialValuesMatch(where, item));
    const baselineMatching = Array.isArray(baselineValue)
      ? (where === undefined ? baselineValue : baselineValue.filter((item) => tutorialValuesMatch(where, item)))
      : [];
    const min = clause.count?.min ?? 1;
    const max = clause.count?.max;
    const gained = matching.length - baselineMatching.length;
    // In delta mode both bounds constrain the change since the baseline.
    const counted = clause.mode === "delta" ? gained : matching.length;
    const satisfied = counted >= min && (max === undefined || counted <= max);
    const baselineIds = new Set(baselineMatching.map(itemId).filter((id): id is string => id !== null));
    const capture = matching.find((item) => {
      const id = itemId(item);
      return id === null ? false : !baselineIds.has(id);
    }) ?? matching[matching.length - 1];
    return { satisfied, capture: satisfied ? toCapture(capture) : undefined };
  }

  const matches = (candidate: unknown) => {
    if (equals !== undefined) return tutorialValuesMatch(equals, candidate, true);
    if (where !== undefined) return tutorialValuesMatch(where, candidate);
    return candidate !== undefined && candidate !== null && candidate !== false;
  };
  const satisfied = matches(value) && !(clause.mode === "delta" && matches(baselineValue));
  return { satisfied, capture: satisfied ? toCapture(value) : undefined };
}

/**
 * Evaluates every clause against the current snapshot. Evaluation is total:
 * unresolved paths and aliases report `satisfied: false` rather than throwing,
 * so a mistyped check never breaks a running tutorial.
 */
export function evaluateTutorialCheck(
  check: TutorialCheck,
  state: unknown,
  baseline?: unknown,
  aliases: TutorialAliasStore = new TutorialAliasStore(),
): TutorialCheckEvaluation {
  const captures: Record<string, TutorialValue> = {};
  const unresolved: string[] = [];
  let satisfied = true;

  for (const clause of check.all) {
    const result = evaluateClause(clause, state, baseline, aliases);
    if (result.unresolved) unresolved.push(result.unresolved);
    if (!result.satisfied) {
      satisfied = false;
      continue;
    }
    if (clause.captureAlias && result.capture !== undefined) {
      captures[clause.captureAlias] = result.capture;
    }
  }

  return { satisfied, captures: satisfied ? captures : {}, unresolved };
}

/**
 * Whether a step's outcome is already in the workspace when a run catches up
 * to a later step (Continue, or starting from a step). A catch-up has no
 * "before" for a step it never showed, so a delta clause ("one more Yes/No
 * field than before") would degrade to "any Yes/No field" — and the first
 * step's field would satisfy the second step's check, skipping it. A delta
 * clause therefore holds here only when the item it captured last time (a
 * restored alias) is still in the state; otherwise the step is rebuilt.
 */
export function evaluateTutorialCheckForCatchUp(
  check: TutorialCheck,
  state: unknown,
  aliases: TutorialAliasStore = new TutorialAliasStore(),
): TutorialCheckEvaluation {
  const unproven = check.all.some((clause) => clause.mode === "delta" && !capturedItemPresent(clause, state, aliases));
  if (unproven) return { satisfied: false, captures: {}, unresolved: [] };
  return evaluateTutorialCheck(check, state, undefined, aliases);
}

function capturedItemPresent(clause: TutorialCheckClause, state: unknown, aliases: TutorialAliasStore): boolean {
  if (!clause.captureAlias || !aliases.has(clause.captureAlias)) return false;
  const captured = aliases.get(clause.captureAlias);
  const id = typeof captured === "string" ? captured : itemId(captured);
  const value = readTutorialStatePath(state, clause.path);
  return id !== null && Array.isArray(value) && value.some((item) => itemId(item) === id);
}

