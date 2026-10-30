"use client";

import { useEffect, useRef, useState, type ReactElement } from "react";
import { ArrowLeft, ArrowRight, Check, Pause, Play, RotateCcw } from "lucide-react";
import type { BrowserCapturePackage } from "../browser-capture/types";
import { CaptureReplaySurface, type CaptureReplaySurfaceHandle } from "./replay-surface";
import "./capture-studio.css";

export interface BrowserCapturePlayerProps {
  capture: BrowserCapturePackage;
  className?: string;
}

/** A standalone learner view. No authoring controls or application scripts. */
export function BrowserCapturePlayer({ capture, className = "" }: BrowserCapturePlayerProps): ReactElement {
  const active = capture.steps.map((step, index) => step.disabled ? -1 : index).filter((index) => index >= 0);
  const [stepIndex, setStepIndex] = useState(active[0] ?? 0);
  const [watch, setWatch] = useState(false);
  const [complete, setComplete] = useState(false);
  const [notice, setNotice] = useState("");
  const replay = useRef<CaptureReplaySurfaceHandle>(null);
  const position = Math.max(0, active.indexOf(stepIndex));
  const step = capture.steps[stepIndex];
  const last = position === active.length - 1;
  const next = () => {
    if (last) { replay.current?.next(); setComplete(true); setWatch(false); return; }
    setStepIndex(active[position + 1]!);
  };
  useEffect(() => {
    if (!watch || complete) return;
    const timer = setTimeout(() => {
      if (last) { replay.current?.next(); setComplete(true); setWatch(false); }
      else setStepIndex(active[position + 1]!);
    }, 3500);
    return () => clearTimeout(timer);
  }, [watch, complete, stepIndex, last, position, capture.steps]);
  const reset = () => {
    setComplete(false); setWatch(false); setStepIndex(active[0] ?? 0); setNotice(""); replay.current?.reset();
  };

  if (!active.length) return <div className={`tk-capture tk-capture-player ${className}`}><section className="tk-capture-lesson-card"><div className="tk-capture-lesson-copy"><h2>No published steps</h2><p>Open this recording in Capture Studio and include at least one step in the tutorial.</p></div></section></div>;

  return <div className={`tk-capture tk-capture-player ${className}`}>
    <header className="tk-capture-player-header"><div><span className="tk-capture-eyebrow">TourKit · Interactive tutorial</span><h1>{capture.title}</h1></div><button className="tk-capture-button" onClick={reset}><RotateCcw size={15} /> Reset</button></header>
    {step && <CaptureReplaySurface ref={replay} capture={capture} stepIndex={stepIndex} autoAdvance={!watch && !complete} onStepChange={setStepIndex} onWarning={setNotice} onComplete={() => { setComplete(true); setWatch(false); }} />}
    <section className="tk-capture-lesson-card" aria-live="polite">
      {complete ? <><span className="tk-capture-complete-icon"><Check size={22} /></span><div className="tk-capture-lesson-copy"><span className="tk-capture-eyebrow">Walkthrough complete</span><h2>You have reached the end.</h2><p>You can reset the tutorial to practice again.</p></div><button className="tk-capture-button is-primary" onClick={reset}>Practice again</button></> : <>
        <div className="tk-capture-step-number">{position + 1}</div>
        <div className="tk-capture-lesson-copy"><span className="tk-capture-eyebrow">Step {position + 1} of {active.length}</span><h2>{step?.title}</h2><p>{step?.instruction}</p>{notice && <span className="tk-capture-player-notice">{notice}</span>}</div>
        <div className="tk-capture-lesson-actions"><button className="tk-capture-button" aria-label={watch ? "Pause demonstration" : "Watch demonstration"} onClick={() => setWatch((value) => !value)}>{watch ? <Pause size={15} /> : <Play size={15} />}{watch ? "Pause" : "Watch"}</button><button className="tk-capture-button is-icon" aria-label="Previous step" disabled={position === 0} onClick={() => setStepIndex(active[position - 1]!)}><ArrowLeft size={17} /></button><button className="tk-capture-button is-primary" onClick={next}>{last ? "Finish" : "Next"}<ArrowRight size={16} /></button></div>
      </>}
    </section>
    <footer className="tk-capture-player-footer">Captured interface · Interactions follow the recorded workflow</footer>
  </div>;
}
