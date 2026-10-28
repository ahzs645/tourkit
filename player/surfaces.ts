import { useEffect } from "react";

import type { TutorialValue } from "../core/schema";

/**
 * Modal and panel surfaces the workspace reports to the tutorial layer.
 *
 * The builder document and the ribbon reach the check snapshot through
 * TutorialRuntime's props, but modal surfaces (the patient browser, the chart
 * analyzer) own their state locally and mount anywhere in the tree. Rather
 * than lifting that state, each surface reports a tiny structural summary
 * here and the runtime merges the registry into the snapshot as `surfaces.*`
 * — so checks can grade outcomes ("the analyzer is open on Clinical") instead
 * of steps merely reacting to clicks.
 *
 * Values follow the same privacy boundary as the action bus: booleans and
 * slugs only. Never report labels, entered values, or patient data.
 */
export type TutorialSurfaceState = Readonly<Record<string, TutorialValue>>;

type Listener = () => void;

function shallowEqual(a: TutorialSurfaceState, b: TutorialSurfaceState): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => Object.is(a[key], b[key]));
}

export class TutorialSurfaceRegistry {
  private surfaces = new Map<string, TutorialSurfaceState>();
  private listeners = new Set<Listener>();
  /** Cached so useSyncExternalStore sees a stable reference between changes. */
  private cachedSnapshot: Record<string, TutorialSurfaceState> | null = null;

  /** Report a surface's current state; null removes it (surface closed). */
  report(id: string, state: TutorialSurfaceState | null): void {
    if (state === null) {
      if (!this.surfaces.delete(id)) return;
    } else {
      const previous = this.surfaces.get(id);
      if (previous && shallowEqual(previous, state)) return;
      this.surfaces.set(id, state);
    }
    this.cachedSnapshot = null;
    for (const listener of this.listeners) listener();
  }

  snapshot(): Record<string, TutorialSurfaceState> {
    if (!this.cachedSnapshot) {
      this.cachedSnapshot = Object.fromEntries(this.surfaces);
    }
    return this.cachedSnapshot;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const createTutorialSurfaceRegistry = () => new TutorialSurfaceRegistry();
export const tutorialSurfaces = createTutorialSurfaceRegistry();

/** Stable function references for useSyncExternalStore. */
export const subscribeTutorialSurfaces = (listener: Listener): (() => void) =>
  tutorialSurfaces.subscribe(listener);
export const readTutorialSurfacesSnapshot = (): Record<string, TutorialSurfaceState> =>
  tutorialSurfaces.snapshot();

/**
 * Report a surface for the lifetime of the calling component. Pass null while
 * the surface is closed; unmounting always withdraws the report. Call before
 * any early return so the cleanup is registered.
 *
 * A null *id* reports nothing at all, for a component that owns the surface on
 * some mounts and not others — the field inspector reports from the builder's
 * own rail and stays silent in the subform designer's nested copy. Passing
 * null as the state from such a mount would instead withdraw the report the
 * other mount is making.
 */
export function useReportTutorialSurface(
  id: string | null,
  state: TutorialSurfaceState | null,
  registry: TutorialSurfaceRegistry = tutorialSurfaces,
): void {
  // Dependency is the serialized state: surfaces report slugs and booleans,
  // so the string stays tiny and object identity churn does not re-notify.
  const serialized = state === null ? null : JSON.stringify(state);
  useEffect(() => {
    if (!id) return;
    registry.report(id, serialized === null ? null : JSON.parse(serialized));
    return () => registry.report(id, null);
  }, [id, serialized, registry]);
}


