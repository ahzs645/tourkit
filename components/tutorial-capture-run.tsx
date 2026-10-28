"use client";

import { useEffect } from "react";
import { useLatestRef } from "../shared/use-latest-ref";
import { TutorialAliasStore, resolveTutorialReferences } from "../core/references";
import { evaluateTutorialCheck } from "../core/checks";
import { tutorialContextMatches, tutorialViewState, type TutorialContextActionResolver } from "../core/view-context";
import { TutorialValueSchema, type TutorialManifest, type TutorialStep } from "../core/schema";
import { TUTORIAL_CAPTURE_PROTOCOL, isCaptureMessage } from "../recording/capture-protocol";
import { findTutorialAnchor, waitForTutorialAnchor } from "../player/anchor";
import { DEFAULT_TUTORIAL_DOM_POLICY, type TutorialDomPolicy } from "../player/dom-policy";
import type { TutorialPlayerActionExecutor } from "../player/types";

/** Uses the normal stage executor, without learner UI, narration, or completion/progress writes. */
export function TutorialCaptureRun({ manifest, token, execute, state, before = false, resolveContextActions, domPolicy = DEFAULT_TUTORIAL_DOM_POLICY }: {
  manifest: TutorialManifest; token: string; execute: TutorialPlayerActionExecutor; state: unknown;
  /** also hand the parent each step before its action runs, once its anchor is up —
      what a learner sees in Practice, where nothing has been done for them */
  before?: boolean;
  resolveContextActions?: TutorialContextActionResolver;
  /** Use the same foreground-window policy as the learner player. */
  domPolicy?: TutorialDomPolicy;
}) {
  const latest = useLatestRef({ execute, state, resolveContextActions, domPolicy });
  useEffect(() => {
    if (window.parent === window) return;
    const controller = new AbortController();
    const { signal } = controller;
    const send = (type: "before" | "step" | "complete" | "error", stepId?: string, error?: string) => {
      window.parent.postMessage({ protocol: TUTORIAL_CAPTURE_PROTOCOL, token, type, stepId, error, view: tutorialViewState(latest.current.state) }, window.location.origin);
    };
    const capture = (step: TutorialStep, phase: "before" | "step" = "step") => new Promise<void>((resolve, reject) => {
      const cleanup = () => { clearTimeout(timeout); window.removeEventListener("message", receive); signal.removeEventListener("abort", abort); };
      const abort = () => { cleanup(); reject(new DOMException("Capture cancelled", "AbortError")); };
      const receive = (event: MessageEvent) => {
        if (event.source !== window.parent || event.origin !== window.location.origin || !isCaptureMessage(event.data, token)) return;
        if (event.data.type !== "captured" || event.data.stepId !== step.id) return;
        cleanup(); resolve();
      };
      const timeout = setTimeout(() => { cleanup(); reject(new Error("Screenshot capture did not finish.")); }, 30_000);
      window.addEventListener("message", receive);
      signal.addEventListener("abort", abort, { once: true });
      send(phase, step.id);
    });
    // Deferring also prevents React StrictMode's abandoned effect from performing an action.
    const timer = setTimeout(() => void (async () => {
      const aliases = new TutorialAliasStore();
      const steps = manifest.chapters.flatMap((chapter) => chapter.steps);
      let step: TutorialStep | undefined;
      try {
        for (const [index, entry] of steps.entries()) {
          step = entry;
          signal.throwIfAborted();
          if (step.context && !tutorialContextMatches(step.context, latest.current.state)) {
            for (const action of latest.current.resolveContextActions?.(step.context) ?? []) {
              signal.throwIfAborted();
              await latest.current.execute(action, { manifest, step, stepIndex: index, signal });
            }
            const deadline = Date.now() + 2000;
            while (!signal.aborted && !tutorialContextMatches(step.context, latest.current.state) && Date.now() < deadline) {
              await new Promise((resolve) => setTimeout(resolve, 30));
            }
            signal.throwIfAborted();
            if (!tutorialContextMatches(step.context, latest.current.state)) throw new Error(`Open ${step.context.label} before capturing this step.`);
          }
          if (before) {
            /* Practice waits for the anchor before the learner acts; a short
               wait here, and the parent is told either way — a missing anchor
               is exactly what an audit wants to see */
            if (step.anchor) {
              await waitForTutorialAnchor(document, step.anchor.id, { signal, timeoutMs: Math.min(step.anchor.waitMs, 1500), domPolicy: latest.current.domPolicy }).catch(() => {
                if (signal.aborted) throw new DOMException("Capture cancelled", "AbortError");
              });
            }
            await capture(step, "before");
          }
          if (step.action) {
            const args = step.action.args ? TutorialValueSchema.parse(resolveTutorialReferences(step.action.args, aliases)) : undefined;
            if (args !== undefined && (!args || typeof args !== "object" || Array.isArray(args))) throw new Error("Action arguments must be an object.");
            const result = await latest.current.execute({ ...step.action, args }, { manifest, step, stepIndex: index, signal });
            if (step.action.resultAlias) aliases.set(step.action.resultAlias, result);
          } else if (step.check) {
            const checked = evaluateTutorialCheck(step.check, latest.current.state, undefined, aliases);
            if (!checked.satisfied) throw new Error("This step requires a manual action. Capture its interface in Studio.");
            for (const [alias, value] of Object.entries(checked.captures)) aliases.set(alias, value);
          }
          // Let action-driven React updates and opened surfaces settle before positioning the image.
          await new Promise((resolve) => setTimeout(resolve, 350));
          signal.throwIfAborted();
          if (step.anchor) {
            try {
              const anchor = await waitForTutorialAnchor(document, step.anchor.id, { signal, timeoutMs: step.action ? 1000 : step.anchor.waitMs, domPolicy: latest.current.domPolicy });
              const target = step.target ? findTutorialAnchor(document, step.target.id, latest.current.domPolicy) : null;
              (target ?? anchor).scrollIntoView({ block: "nearest", inline: "nearest" });
            } catch (error) {
              // An action can close its own menu. Its resulting interface is still a valid capture.
              if (!step.action || signal.aborted) throw error;
            }
          }
          await capture(step);
        }
        send("complete");
      } catch (error) {
        if (!signal.aborted) send("error", step?.id, error instanceof Error ? error.message : "Replay failed.");
      }
    })(), 500);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [before, latest, manifest, token]);
  return null;
}


