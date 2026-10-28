"use client";

import { tutorialViewState, tutorialActionChangesView, type TutorialViewState } from "../core/view-context";
import { TutorialViewContextSchema } from "../core/schema";
import { replayTutorialSeek, TutorialSeekEntriesSchema } from "../core/stage-seek";
import { useLatestRef } from "../shared/use-latest-ref";

import { useEffect, useRef, useState } from "react";

import { TUTORIAL_IFRAME_PROTOCOL } from "../player/iframe-protocol";
import { tutorialActionBus, type TutorialActionEvent } from "../core/actions";
import type { TutorialSemanticAction, TutorialManifest, TutorialMode, TutorialSpotlightStyle, TutorialViewContext } from "../core/schema";

/**
 * The part of a tutorial session every stage shares: which tutorial the URL
 * names and how to play it, the studio's authoring bridge, and local studio
 * drafts compiled into manifests. Application workspaces and embedded stages
 * both build on these; what
 * differs between them — the state snapshot and the action executor — stays
 * in each runtime.
 */
/** The host decides how views navigate and where local drafts/share links live. */
export interface TutorialSessionIntegration {
  /** Optional action bus for this instrumented application stage. */
  actionBus?: Pick<import("../core/actions").TutorialActionBus, "subscribe">;
  viewContext: (state: TutorialViewState) => TutorialViewContext | undefined;
  resolveContextActions: (context: TutorialViewContext) => readonly TutorialSemanticAction[];
  actionChangesView: (action: Pick<TutorialSemanticAction, "id">) => boolean;
  createDraftStore: () => TutorialDraftStore;
  decodeTutorialShare: (token: string) => Promise<TutorialManifest>;
}

import { createDefaultTutorialDraftStore, type TutorialDraftStore } from "../recording/draft-store";
import { createTutorialShareCodec } from "../share";

export const DEFAULT_TUTORIAL_SESSION_INTEGRATION: TutorialSessionIntegration = {
  viewContext: () => undefined,
  resolveContextActions: () => [],
  actionChangesView: tutorialActionChangesView,
  createDraftStore: createDefaultTutorialDraftStore,
  decodeTutorialShare: createTutorialShareCodec({ allowedLaunchPaths: () => new Set(["/"]) }).decodeTutorialShare,
};

export type TutorialLocationState = {
  tutorialId: string | null;
  mode: TutorialMode | undefined;
  spotlightStyle: TutorialSpotlightStyle | undefined;
  authoring: boolean;
  /** Opaque restart token: a new value relaunches the same tutorial. */
  run: string | null;
  /** Step id to start at (studio "play from here"); earlier steps are caught up first. */
  startStep: string | null;
  /** Private nonce for the export dialog's isolated screenshot replay. */
  capture: string | null;
  /** The capture parent also wants each step before its action (audit sweeps). */
  captureBefore: boolean;
  /** Fixture named in the URL; host stages start on it, the workspace loads it itself. */
  fixture: string | null;
};

export const TUTORIAL_DRAFT_PREFIX = "draft:";
/** Kept in step with share.ts, which is loaded only when a link is opened. */
export const TUTORIAL_SHARE_PREFIX = "link:";

export function readTutorialLocationState(): TutorialLocationState {
  if (typeof window === "undefined") {
    return { tutorialId: null, mode: undefined, spotlightStyle: undefined, authoring: false, run: null, startStep: null, fixture: null, capture: null, captureBefore: false };
  }
  const search = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const read = (key: string) => search.get(key) ?? hash.get(key);
  const requestedMode = read("tutorialMode");
  const requestedSpotlight = read("tutorialSpotlight");
  return {
    tutorialId: read("tutorial"),
    mode: requestedMode === "autoplay" || requestedMode === "practice" ? requestedMode : undefined,
    spotlightStyle:
      requestedSpotlight === "dim" || requestedSpotlight === "glow"
        ? requestedSpotlight
        : undefined,
    authoring: read("tutorialAuthor") === "1" || read("tutorialAuthor") === "true",
    run: read("tutorialRun"),
    startStep: read("tutorialStep"),
    capture: read("tutorialCapture"),
    captureBefore: read("tutorialCaptureBefore") === "1",
    fixture: read("fixture"),
  };
}

export function sameTutorialLocation(a: TutorialLocationState, b: TutorialLocationState): boolean {
  return a.tutorialId === b.tutorialId
    && a.mode === b.mode
    && a.spotlightStyle === b.spotlightStyle
    && a.authoring === b.authoring
    && a.run === b.run
    && a.startStep === b.startStep
    && a.capture === b.capture
    && a.captureBefore === b.captureBefore
    && a.fixture === b.fixture;
}

/**
 * Leaves the current tutorial for another URL in the app. Tutorial launch
 * links differ from the current location only in the hash, and the workspace
 * loads its fixture once per page load — a plain hash navigation would start
 * the next tutorial on top of whatever the last one built (the preset from
 * "Insert a form preset" showing up in "Make a field conditional"). A full
 * reload gives every tutorial the fresh fixture it was written against.
 */
export function leaveTutorialFor(url: string): void {
  const target = new URL(url, window.location.href);
  const samePage = target.origin === window.location.origin
    && target.pathname === window.location.pathname
    && target.search === window.location.search;
  window.location.assign(url);
  if (samePage) window.location.reload();
}

/** The params that name a run; the fixture and workspace params outlive it. */
const TUTORIAL_RUN_PARAMS = ["tutorial", "tutorialMode", "tutorialSpotlight", "tutorialRun", "tutorialStep", "tutorialCapture", "tutorialCaptureBefore"] as const;

/**
 * Drops the tutorial params from the URL in place, so a learner who waves the
 * celebration card away and keeps working does not replay the finished
 * tutorial on the next reload. replaceState deliberately fires no hashchange:
 * the workspace stays exactly as they left it, fixture and all.
 */
export function forgetTutorialRun(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  let changed = false;
  let hashChanged = false;
  for (const key of TUTORIAL_RUN_PARAMS) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
    if (hash.has(key)) {
      hash.delete(key);
      changed = true;
      hashChanged = true;
    }
  }
  if (!changed) return;
  // Query parameters can coexist with a hash router or a document fragment.
  // Preserve that fragment unless a run parameter was actually removed from it.
  if (hashChanged) url.hash = hash.toString();
  window.history.replaceState(window.history.state, "", url.toString());
}

function actionEventToParentAction(event: TutorialActionEvent) {
  return {
    id: event.action,
    args: event.payload,
  };
}

/**
 * The tutorial the location names, plus a run key that changes whenever a
 * tutorial-relevant param does. Stages route through the hash constantly
 * (tab, fixture, edit, …), so only those params may restart a running
 * tutorial.
 */
export function useTutorialLocation(): { locationState: TutorialLocationState; runKey: number } {
  const [locationState, setLocationState] = useState<TutorialLocationState>(() => readTutorialLocationState());
  const [runKey, setRunKey] = useState(0);
  const locationRef = useRef(locationState);

  useEffect(() => {
    const sync = () => {
      const next = readTutorialLocationState();
      if (sameTutorialLocation(locationRef.current, next)) return;
      locationRef.current = next;
      setLocationState(next);
      setRunKey((value) => value + 1);
    };
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, []);

  return { locationState, runKey };
}

/**
 * A tutorial-author iframe reports the same semantic stream used by practice
 * mode to the studio that embeds it. No DOM text or input values cross the
 * frame boundary.
 */
export function useTutorialAuthoringBridge(
  authoring: boolean,
  state?: unknown,
  execute?: (action: TutorialSemanticAction) => void | Promise<unknown>,
  ready = true,
  /** Puts the stage back on its launch fixture, resolving once it is ready
      again. A stage that offers it lets the studio seek to any step by
      replaying the earlier ones; omit it where actions touch real work. */
  reset?: () => Promise<void>,
  integration: TutorialSessionIntegration = DEFAULT_TUTORIAL_SESSION_INTEGRATION,
): void {
  // A seek outlives the renders its own actions cause; read the newest.
  const latest = useLatestRef({ state, execute });
  useEffect(() => {
    if (!authoring || window.parent === window) return;
    return (integration.actionBus ?? tutorialActionBus).subscribe((event) => {
      // The recording keeps the gesture; actions it caused replay with it.
      if (event.source === "derived") return;
      const action = actionEventToParentAction(event);
      window.parent.postMessage(
        { protocol: TUTORIAL_IFRAME_PROTOCOL, type: "tutorial:action", action, context: integration.actionChangesView(action) ? undefined : integration.viewContext(tutorialViewState(state)) },
        window.location.origin,
      );
    });
  }, [authoring, state, integration]);
  useEffect(() => {
    if (window.parent === window) return;
    const sendView = () => window.parent.postMessage({ protocol: TUTORIAL_IFRAME_PROTOCOL, type: "tutorial:view", state: tutorialViewState(state), ready }, window.location.origin);
    const receive = async (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== window.location.origin || event.data?.protocol !== TUTORIAL_IFRAME_PROTOCOL) return;
      if (event.data.type === "tutorial:view-request") sendView();
      if (event.data.type === "tutorial:seek" && typeof event.data.id === "string") {
        const id = event.data.id;
        try {
          if (!authoring) throw new Error("Return to authoring before changing the stage view.");
          if (!reset) throw new Error("This stage cannot replay earlier steps; open the view manually.");
          const entries = TutorialSeekEntriesSchema.parse(event.data.entries);
          await reset();
          await replayTutorialSeek(entries, {
            execute: (action) => {
              const run = latest.current.execute;
              if (!run) throw new Error("This stage cannot replay actions.");
              return run(action);
            },
            readState: () => latest.current.state,
            resolveContextActions: integration.resolveContextActions,
          });
          window.parent.postMessage({ protocol: TUTORIAL_IFRAME_PROTOCOL, type: "tutorial:seeked", id }, window.location.origin);
        } catch (error) {
          window.parent.postMessage({ protocol: TUTORIAL_IFRAME_PROTOCOL, type: "tutorial:seeked", id, error: error instanceof Error ? error.message : "Unable to replay the earlier steps." }, window.location.origin);
        }
        return;
      }
      if (event.data.type !== "tutorial:view-restore" || typeof event.data.id !== "string") return;
      try {
        if (!authoring) throw new Error("Return to authoring before changing the stage view.");
        if (!ready) throw new Error("Wait for the stage to finish loading before restoring its view.");
        const context = TutorialViewContextSchema.parse(event.data.context);
        const actions = integration.resolveContextActions(context);
        if (!execute || !actions.length) throw new Error("Open this view manually; automatic navigation is unavailable for this surface.");
        for (const action of actions) await execute(action);
        window.parent.postMessage({ protocol: TUTORIAL_IFRAME_PROTOCOL, type: "tutorial:view-restored", id: event.data.id }, window.location.origin);
      } catch (error) {
        window.parent.postMessage({ protocol: TUTORIAL_IFRAME_PROTOCOL, type: "tutorial:view-restored", id: event.data.id, error: error instanceof Error ? error.message : "Unable to restore this view." }, window.location.origin);
      }
    };
    sendView(); window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [authoring, execute, state, ready, reset, latest, integration]);
}

/**
 * Tutorials that are not in the catalog. tutorial=draft:<id> runs a Studio
 * draft on the live stage before publishing: the local draft compiles into a
 * regular manifest, with the recorded narration served from an object URL.
 * tutorial=link:<token> runs a tutorial someone shared as a link, decoded and
 * narrowed by the host's share codec (share.ts).
 */
export function useTutorialDraftManifest(tutorialId: string | null, runKey: number, integration: TutorialSessionIntegration = DEFAULT_TUTORIAL_SESSION_INTEGRATION): TutorialManifest | null {
  const [draftTutorial, setDraftTutorial] = useState<TutorialManifest | null>(null);

  useEffect(() => {
    if (tutorialId?.startsWith(TUTORIAL_SHARE_PREFIX)) {
      let active = true;
      void integration.decodeTutorialShare(tutorialId.slice(TUTORIAL_SHARE_PREFIX.length))
        .then((manifest) => { if (active) setDraftTutorial(manifest); })
        .catch((error: unknown) => { if (active) console.error("Unable to open the shared tutorial", error); });
      return () => {
        active = false;
        setDraftTutorial(null);
      };
    }
    if (!tutorialId?.startsWith(TUTORIAL_DRAFT_PREFIX)) {
      setDraftTutorial(null);
      return;
    }
    let active = true;
    let narrationUrl: string | null = null;
    void (async () => {
      try {
        const { tutorialRecordingDraftToManifest } = await import("../recording/draft");
        const draft = await integration.createDraftStore().get(tutorialId.slice(TUTORIAL_DRAFT_PREFIX.length));
        if (!active) return;
        if (!draft) throw new Error(`No local tutorial draft matches "${tutorialId}".`);
        narrationUrl = draft.audio ? URL.createObjectURL(draft.audio.blob) : null;
        setDraftTutorial(tutorialRecordingDraftToManifest(draft, {
          narrationAsset: narrationUrl ?? undefined,
        }));
      } catch (error) {
        if (active) console.error("Unable to load tutorial draft", error);
      }
    })();
    return () => {
      active = false;
      if (narrationUrl) URL.revokeObjectURL(narrationUrl);
      setDraftTutorial(null);
    };
  }, [tutorialId, runKey, integration]);

  return draftTutorial;
}

/**
 * True while the location carries a tutorial (or tutorial-author) session.
 * Hosts use this to keep tutorial practice forms out of durable stores — the
 * local run cache, preview answer persistence — so finishing a tutorial never
 * leaves autosaved artifacts behind.
 */
export function useTutorialSessionActive(): boolean {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const sync = () => {
      const state = readTutorialLocationState();
      setActive(state.tutorialId !== null || state.authoring);
    };
    sync();
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, []);
  return active;
}


