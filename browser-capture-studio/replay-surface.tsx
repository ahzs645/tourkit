"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Replayer } from "@rrweb/replay";
import { createBrowserCaptureReplay } from "../browser-capture/replay";
import type { BrowserCapturePackage, BrowserCaptureTarget } from "../browser-capture/types";

type ReplayController = ReturnType<typeof createBrowserCaptureReplay>;

export interface CaptureReplaySurfaceHandle {
  next: () => void;
  back: () => void;
  reset: () => void;
  seek: (index: number) => void;
  pick: (callback: (target: BrowserCaptureTarget) => void) => void;
  cancelPick: () => void;
  getTargetElement: () => Element | null;
}

export interface CaptureReplaySurfaceProps {
  capture: BrowserCapturePackage;
  stepIndex: number;
  autoAdvance?: boolean;
  picking?: boolean;
  onStepChange?: (index: number) => void;
  onVariablesChange?: (variables: Record<string, string>) => void;
  onWarning?: (message: string) => void;
  onReady?: () => void;
  onComplete?: () => void;
}

/** The instructions stay outside rrweb's script-disabled replay document. */
export const CaptureReplaySurface = forwardRef<CaptureReplaySurfaceHandle, CaptureReplaySurfaceProps>(function CaptureReplaySurface(
  { capture, stepIndex, autoAdvance = false, picking, onStepChange, onVariablesChange, onWarning, onReady, onComplete }, ref,
) {
  const rootRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<ReplayController | null>(null);
  const callbacks = useRef({ onStepChange, onVariablesChange, onWarning, onReady, onComplete });
  callbacks.current = { onStepChange, onVariablesChange, onWarning, onReady, onComplete };
  const selectedRef = useRef(stepIndex);
  selectedRef.current = stepIndex;
  const [scale, setScale] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rect, setRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  // Copy edits need not recreate the replay engine; structural edits must.
  const replayKey = JSON.stringify(capture.steps.map((step) => ({ id: step.id, atMs: step.atMs, afterMs: step.afterMs, action: step.action, target: step.target, value: step.value, disabled: step.disabled })));

  useImperativeHandle(ref, () => ({
    next: () => { controllerRef.current?.next(); },
    back: () => { controllerRef.current?.back(); },
    reset: () => { controllerRef.current?.reset(); },
    seek: (index) => { controllerRef.current?.seekStep(index); },
    pick: (callback) => { controllerRef.current?.beginTargetPicking(callback); },
    cancelPick: () => { controllerRef.current?.endTargetPicking(); },
    getTargetElement: () => controllerRef.current?.getTargetElement() ?? null,
  }), []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const update = () => setScale(Math.min(1, Math.max(0.15, (viewport.clientWidth - 32) / capture.viewport.width)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [capture.viewport.width]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let active = true;
    let readyForChanges = false;
    setLoading(true);
    setError(null);
    setRect(null);
    let controller: ReplayController;
    try {
      controller = createBrowserCaptureReplay({
        capture, root, autoAdvance,
        createReplayer: (events, options) => new Replayer(events as ConstructorParameters<typeof Replayer>[0], options as ConstructorParameters<typeof Replayer>[1]),
        onStepChange: (index) => { if (active && readyForChanges) callbacks.current.onStepChange?.(index); },
        onAction: () => {
          if (active) callbacks.current.onVariablesChange?.(controller.getVariables());
        },
        onWarning: (warning) => { if (active) callbacks.current.onWarning?.(warning); },
        onComplete: () => { if (active) callbacks.current.onComplete?.(); },
      });
      controllerRef.current = controller;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "This recording could not be reconstructed.");
      setLoading(false);
      return;
    }
    void controller.ready.then(() => {
      if (!active) return;
      readyForChanges = true;
      controller.seekStep(selectedRef.current);
      setLoading(false);
      callbacks.current.onReady?.();
    }).catch((caught: unknown) => {
      if (!active) return;
      setError(caught instanceof Error ? caught.message : "The captured page did not load.");
      setLoading(false);
    });
    const draw = () => {
      if (!active) return;
      const box = controller.getTargetRect();
      setRect(box ? { left: box.left, top: box.top, width: box.width, height: box.height } : null);
    };
    const timer = setInterval(draw, 160);
    return () => {
      active = false;
      clearInterval(timer);
      controller.destroy();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [capture.id, capture.events, capture.assets, capture.viewport.width, capture.viewport.height, replayKey]);

  useEffect(() => { controllerRef.current?.setAutoAdvance(autoAdvance); }, [autoAdvance]);

  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    let active = true;
    void controller.ready.then(() => { if (active) controller.seekStep(stepIndex); }).catch(() => {});
    return () => { active = false; };
  }, [stepIndex]);

  return <div className={`tk-capture-replay-viewport${picking ? " is-picking" : ""}`} ref={viewportRef}>
    <div className="tk-capture-replay-canvas" style={{ width: capture.viewport.width * scale, height: capture.viewport.height * scale }}>
      <div ref={rootRef} className="tk-capture-replay-root" style={{ width: "100%", height: capture.viewport.height * scale }} />
      {rect && !loading && !error && <div className="tk-capture-target-ring" aria-hidden="true" style={{ left: rect.left - 4, top: rect.top - 4, width: rect.width + 8, height: rect.height + 8 }} />}
    </div>
    {loading && <div className="tk-capture-stage-message" role="status">Reconstructing the captured interface…</div>}
    {error && <div className="tk-capture-stage-message tk-capture-stage-error" role="alert"><strong>We could not open this screen</strong><p>{error}</p></div>}
    {picking && <div className="tk-capture-picking-hint">Select an element on the captured page</div>}
  </div>;
});
