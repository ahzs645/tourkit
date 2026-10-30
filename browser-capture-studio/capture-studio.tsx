"use client";

import { useEffect, useRef, useState, type ChangeEvent, type ReactElement } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, ChevronDown, CircleHelp, FileDown, FileText, Image, LayoutTemplate, MousePointer2, PanelLeft, Play, RotateCcw, Scan, SquarePen, Trash2, Upload, X } from "lucide-react";
import { exportBrowserCaptureZip, importBrowserCapture, parseBrowserCapture } from "../browser-capture";
import type { BrowserCapturePackage, BrowserCaptureStep } from "../browser-capture/types";
import type { TutorialScreenshot } from "../core/screenshot";
import { captureFileName, captureTargetLabel, downloadCaptureFile, moveCaptureStep, removeCaptureStep, replaceCaptureTargetText, updateCaptureStep } from "./model";
import { captureReadingHtml, captureReadingMarkdown } from "./reading-export";
import { createCaptureStudioSample } from "./sample";
import { CaptureReplaySurface, type CaptureReplaySurfaceHandle } from "./replay-surface";
import { BrowserCapturePlayer } from "./player";
import { readCaptureStudioDraft, saveCaptureStudioDraft } from "./storage";
import "./capture-studio.css";

export interface CaptureStudioProps {
  initialCapture?: BrowserCapturePackage;
  onCaptureChange?: (capture: BrowserCapturePackage) => void;
  exportInteractive?: (capture: BrowserCapturePackage) => Promise<Blob>;
  className?: string;
}

function imageFromFile(file: File): Promise<TutorialScreenshot> {
  return new Promise((resolve, reject) => {
    if (file.type !== "image/png" || file.size > 5_999_970) { reject(new Error("Choose a PNG under 6 MB.")); return; }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The screenshot could not be read."));
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const image = new window.Image();
      image.onerror = () => reject(new Error("This file is not a readable PNG."));
      image.onload = () => {
        if (image.naturalWidth > 4096 || image.naturalHeight > 4096) { reject(new Error("Screenshots can be up to 4096 pixels in each direction.")); return; }
        resolve({ dataUrl, width: image.naturalWidth, height: image.naturalHeight, alt: file.name, provenance: { engine: "import", capturedAt: new Date().toISOString() } });
      };
      image.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

function ActionGlyph({ action }: { action: BrowserCaptureStep["action"] }): ReactElement {
  return action === "input" || action === "change" ? <SquarePen size={13} /> : action === "continue" ? <FileText size={13} /> : <MousePointer2 size={13} />;
}

export function CaptureStudio({ initialCapture, onCaptureChange, exportInteractive, className = "" }: CaptureStudioProps): ReactElement {
  const [capture, setCapture] = useState<BrowserCapturePackage | null>(initialCapture ?? null);
  const [selectedId, setSelectedId] = useState(initialCapture?.steps[0]?.id ?? "");
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [view, setView] = useState<"interface" | "screenshot">("interface");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [picking, setPicking] = useState(false);
  const [targetText, setTargetText] = useState("");
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [showExport, setShowExport] = useState(false);
  const [showWarnings, setShowWarnings] = useState(false);
  const [recovery, setRecovery] = useState<BrowserCapturePackage | null>(null);
  const [storageStatus, setStorageStatus] = useState("Changes are kept in this browser.");
  const [storageReady, setStorageReady] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const screenshotInput = useRef<HTMLInputElement>(null);
  const replay = useRef<CaptureReplaySurfaceHandle>(null);
  const selectedIndex = Math.max(0, capture?.steps.findIndex((step) => step.id === selectedId) ?? 0);
  const selected = capture?.steps[selectedIndex];
  const captureRef = useRef(capture);
  captureRef.current = capture;
  const change = (next: BrowserCapturePackage) => { setCapture(next); onCaptureChange?.(next); };
  const replace = (next: BrowserCapturePackage) => { change(next); setSelectedId(next.steps[0]?.id ?? ""); setMode("edit"); setView("interface"); setVariables({}); setRecovery(null); setMessage(`Opened ${next.steps.length} captured steps.`); setError(""); };
  useEffect(() => { if (initialCapture) replace(parseBrowserCapture(initialCapture)); }, [initialCapture]);
  useEffect(() => {
    let active = true;
    void readCaptureStudioDraft(initialCapture?.id).then((saved) => {
      if (active && saved && (!initialCapture || saved.updatedAt > initialCapture.updatedAt)) setRecovery(saved);
    }).catch(() => {}).finally(() => { if (active) setStorageReady(true); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!capture || !storageReady || recovery?.id === capture.id) return;
    if (!capture.title.trim() || capture.steps.some((step) => !step.title.trim() || step.screenshot && !step.screenshot.alt.trim())) {
      setStorageStatus("Add the required titles and image descriptions to save these edits.");
      return;
    }
    let active = true;
    setStorageStatus("Saving edits locally…");
    const timer = setTimeout(() => {
      void saveCaptureStudioDraft(capture).then(() => { if (active) setStorageStatus("Saved in this browser"); }).catch(() => { if (active) setStorageStatus("Local storage is unavailable. Save a package to keep your edits."); });
    }, 350);
    return () => { active = false; clearTimeout(timer); };
  }, [capture, storageReady, recovery]);
  useEffect(() => { setPicking(false); replay.current?.cancelPick(); setTargetText(""); }, [selectedId]);

  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setError(""); setShowExport(false);
    try { await operation(); } catch (caught) { setError(caught instanceof Error ? caught.message : "The operation could not be completed."); }
    finally { setBusy(false); }
  };
  const openFile = (file?: File) => { if (file) void run(async () => replace(await importBrowserCapture(file))); };
  const patch = (partial: Partial<BrowserCaptureStep>) => { if (capture && selected) change(updateCaptureStep(capture, selected.id, partial)); };
  const savePackage = () => { if (capture) void run(async () => { const saved = parseBrowserCapture(capture); downloadCaptureFile(await exportBrowserCaptureZip(saved), captureFileName(saved.title, ".tourkit")); setMessage("Editable package saved. Import it to continue editing."); }); };
  const selectStep = (index: number) => { if (capture?.steps[index]) setSelectedId(capture.steps[index]!.id); };
  const pick = () => {
    if (picking) { replay.current?.cancelPick(); setPicking(false); return; }
    setView("interface"); setPicking(true); setMessage("Select the element this step should point to.");
    replay.current?.pick((target) => {
      const current = captureRef.current;
      if (current && selected) change(updateCaptureStep(current, selected.id, { target }));
      replay.current?.cancelPick();
      setPicking(false); setMessage(`Target set to ${captureTargetLabel(target)}.`);
    });
  };
  const editTargetText = () => {
    if (!capture || !selected) return;
    try { change(replaceCaptureTargetText(capture, selected.id, targetText)); setMessage("Captured interface text updated. Review screenshots separately."); setError(""); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "This text could not be edited."); }
  };
  const snapshotUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
    if (file && capture && selected) void run(async () => {
      const screenshot = await imageFromFile(file);
      change({ ...updateCaptureStep(capture, selected.id, { screenshot }), privacy: { ...capture.privacy, mode: "unreviewed" } });
      setMessage("Screenshot replaced. Review the new image before sharing.");
    });
  };

  return <div className={`tk-capture tk-capture-studio ${className}`} onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }} onDrop={(event) => { if (event.dataTransfer.files.length) { event.preventDefault(); openFile(event.dataTransfer.files[0]); } }}>
    <input ref={fileInput} type="file" accept=".tourkit,.zip,.json,application/zip,application/json" className="tk-capture-visually-hidden" aria-label="Import capture package" onChange={(event) => { openFile(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} />
    <input ref={screenshotInput} type="file" accept="image/png" className="tk-capture-visually-hidden" aria-label="Replace screenshot" onChange={snapshotUpload} />
    <header className="tk-capture-header">
      <div className="tk-capture-brand"><span className="tk-capture-logo"><MousePointer2 size={20} /></span><div><strong>TourKit <span>Capture Studio</span></strong><span className="tk-capture-subtitle">{capture ? `${capture.steps.length} steps · Editable capture` : "Turn a recorded interface into a tutorial"}</span></div></div>
      <div className="tk-capture-header-actions"><button className="tk-capture-button" disabled={busy} onClick={() => fileInput.current?.click()}><Upload size={15} /> Import</button>{capture && <><button className={`tk-capture-button${mode === "preview" ? " is-active" : ""}`} onClick={() => setMode(mode === "edit" ? "preview" : "edit")}>{mode === "edit" ? <Play size={15} /> : <SquarePen size={15} />}{mode === "edit" ? "Preview" : "Edit"}</button><button className="tk-capture-button is-primary" disabled={busy} onClick={savePackage}><FileDown size={15} />Save package</button><div className="tk-capture-export-wrap"><button className="tk-capture-button is-icon" aria-label="More export options" aria-expanded={showExport} onClick={() => setShowExport(!showExport)}><ChevronDown size={17} /></button>{showExport && <div className="tk-capture-menu"><button onClick={() => { downloadCaptureFile(new Blob([captureReadingHtml(capture)], { type: "text/html" }), captureFileName(capture.title, "-guide.html")); setShowExport(false); }}>HTML reading guide</button><button onClick={() => { downloadCaptureFile(new Blob([captureReadingMarkdown(capture)], { type: "text/markdown" }), captureFileName(capture.title, "-guide.md")); setShowExport(false); }}>Markdown guide</button><button disabled={!exportInteractive} onClick={() => { if (exportInteractive) void run(async () => { downloadCaptureFile(await exportInteractive(capture), captureFileName(capture.title, ".html")); setMessage("Standalone interactive tutorial exported."); }); }}>Interactive HTML{!exportInteractive ? " (not configured)" : ""}</button></div>}</div></>}</div>
    </header>
    {error && <div className="tk-capture-alert is-error" role="alert"><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError("")}><X size={15} /></button></div>}
    {recovery && <div className="tk-capture-recovery"><div><strong>Saved edits are available</strong><span>{recovery.title} · {recovery.steps.length} steps</span></div><button className="tk-capture-button" onClick={() => replace(recovery)}>Resume saved edits</button><button className="tk-capture-text-button" onClick={() => setRecovery(null)}>Dismiss</button></div>}
    {!capture ? <div className="tk-capture-welcome"><div className="tk-capture-welcome-art"><LayoutTemplate size={50} /><span><MousePointer2 size={24} /></span></div><span className="tk-capture-eyebrow">Real interfaces. Your story.</span><h1>Make the next click<br />a little clearer.</h1><p>Import a captured website, shape the steps, and share a tutorial people can explore.</p><div className="tk-capture-welcome-actions"><button className="tk-capture-button is-primary is-large" disabled={busy} onClick={() => fileInput.current?.click()}><Upload size={17} />Import a recording</button><button className="tk-capture-button is-large" onClick={() => replace(createCaptureStudioSample())}>Try a sample</button></div><span className="tk-capture-drop-hint">Drop a .tourkit, ZIP or JSON recording anywhere</span><div className="tk-capture-welcome-features"><span><Scan size={17} />Element-based targets</span><span><Image size={17} />Screenshots included</span><span><FileDown size={17} />Portable output</span></div></div>
      : mode === "preview" ? <div className="tk-capture-preview"><button className="tk-capture-button tk-capture-back-edit" onClick={() => setMode("edit")}><ArrowLeft size={15} />Back to editing</button><BrowserCapturePlayer key={`${capture.id}:${capture.updatedAt}`} capture={capture} /></div>
      : <>
        <div className="tk-capture-project-bar"><div className="tk-capture-title-wrap"><label htmlFor="tk-capture-title">Tutorial title</label><input id="tk-capture-title" value={capture.title} maxLength={200} onChange={(event) => change({ ...capture, title: event.target.value, updatedAt: new Date().toISOString() })} /></div><div className="tk-capture-project-meta"><span className={`tk-capture-badge ${capture.privacy.mode === "reviewed" ? "is-reviewed" : ""}`}>{capture.privacy.mode === "reviewed" ? <Check size={12} /> : <CircleHelp size={12} />}{capture.privacy.mode === "reviewed" ? "Data reviewed" : capture.privacy.mode === "masked" ? "Masked capture · review needed" : "Data review needed"}</span><button className="tk-capture-text-button" onClick={() => setShowWarnings(!showWarnings)}>{capture.warnings.length} capture notes</button></div></div>
        {showWarnings && <div className="tk-capture-notes"><strong>Capture notes</strong>{capture.warnings.length ? <ul>{capture.warnings.map((warning, index) => <li key={`${warning.code}:${index}`}>{warning.message}</li>)}</ul> : <p>No capture warnings were reported. Preview the tutorial to check its appearance and behavior.</p>}{capture.privacy.notes && <p>{capture.privacy.notes}</p>}</div>}
        <div className="tk-capture-workspace">
          <aside className="tk-capture-step-rail"><div className="tk-capture-panel-heading"><span><PanelLeft size={14} />Steps</span><span>{capture.steps.length}</span></div><ol>{capture.steps.map((step, index) => <li key={step.id}><button className={`tk-capture-step-tile${step.id === selected?.id ? " is-selected" : ""}${step.disabled ? " is-disabled" : ""}`} onClick={() => selectStep(index)} aria-current={step.id === selected?.id ? "step" : undefined}><div className="tk-capture-step-thumbnail">{step.screenshot ? <img src={step.screenshot.dataUrl} alt="" /> : <div className="tk-capture-thumb-placeholder"><div /><div /><div /></div>}<span>{index + 1}</span></div><div className="tk-capture-step-tile-copy"><strong>{step.title || "Untitled step"}</strong><span><ActionGlyph action={step.action} />{step.disabled ? "Hidden" : step.action === "continue" ? "Continue" : captureTargetLabel(step.target)}</span></div></button></li>)}</ol></aside>
          <section className="tk-capture-main-stage"><div className="tk-capture-stage-toolbar"><div className="tk-capture-segment"><button className={view === "interface" ? "is-selected" : ""} onClick={() => setView("interface")}><LayoutTemplate size={14} />Interface</button><button className={view === "screenshot" ? "is-selected" : ""} onClick={() => setView("screenshot")}><Image size={14} />Screenshot</button></div><span className="tk-capture-dimensions">{capture.viewport.width} × {capture.viewport.height}</span><button className="tk-capture-button is-icon is-quiet" aria-label="Reset practice values" onClick={() => { replay.current?.reset(); setVariables({}); setMessage("Practice values reset."); }}><RotateCcw size={15} /></button></div>
            <div className={view === "interface" ? "tk-capture-live-stage" : "tk-capture-live-stage is-hidden"}><CaptureReplaySurface ref={replay} capture={capture} stepIndex={selectedIndex} picking={picking} onStepChange={selectStep} onVariablesChange={setVariables} onWarning={(notice) => setMessage(notice)} /></div>
            {view === "screenshot" && <div className="tk-capture-screenshot-stage">{selected?.screenshot ? <img src={selected.screenshot.dataUrl} alt={selected.screenshot.alt} /> : <div className="tk-capture-no-screenshot"><Image size={32} /><h3>No screenshot for this step</h3><p>The captured interface is still available. You can attach a PNG for reading guides.</p><button className="tk-capture-button" onClick={() => screenshotInput.current?.click()}>Attach screenshot</button></div>}</div>}
            {selected && <div className="tk-capture-stage-step-card"><div className="tk-capture-step-number">{selectedIndex + 1}</div><div><span className="tk-capture-eyebrow">{selected.action === "continue" ? "Reading step" : "Captured action"}</span><h2>{selected.title}</h2><p>{selected.instruction || "Add an instruction in the panel on the right."}</p></div><div className="tk-capture-stage-step-nav"><button className="tk-capture-button is-icon" aria-label="Previous captured step" disabled={selectedIndex === 0} onClick={() => selectStep(selectedIndex - 1)}><ArrowLeft size={16} /></button><button className="tk-capture-button is-icon" aria-label="Next captured step" disabled={selectedIndex >= capture.steps.length - 1} onClick={() => selectStep(selectedIndex + 1)}><ArrowRight size={16} /></button></div></div>}
            {Object.keys(variables).length > 0 && <div className="tk-capture-variable-note">{Object.keys(variables).length} practice input{Object.keys(variables).length === 1 ? "" : "s"} kept in this session. Reset clears them.</div>}
          </section>
          {selected && <aside className="tk-capture-inspector"><div className="tk-capture-panel-heading"><span><SquarePen size={14} />Step {selectedIndex + 1}</span><div className="tk-capture-order-buttons"><button aria-label="Move step earlier" disabled={selectedIndex === 0} onClick={() => change(moveCaptureStep(capture, selected.id, -1))}><ArrowUp size={14} /></button><button aria-label="Move step later" disabled={selectedIndex === capture.steps.length - 1} onClick={() => change(moveCaptureStep(capture, selected.id, 1))}><ArrowDown size={14} /></button><button aria-label="Delete step" disabled={capture.steps.length === 1} onClick={() => { const next = removeCaptureStep(capture, selected.id); change(next); setSelectedId(next.steps[Math.min(selectedIndex, next.steps.length - 1)]!.id); }}><Trash2 size={14} /></button></div></div>
            <div className="tk-capture-inspector-section"><label htmlFor="tk-step-title">Step title</label><input id="tk-step-title" value={selected.title} maxLength={200} onChange={(event) => patch({ title: event.target.value })} /><label htmlFor="tk-step-instruction">What should the learner do?</label><textarea id="tk-step-instruction" rows={5} value={selected.instruction} maxLength={4000} placeholder="Describe the next action in a sentence or two." onChange={(event) => patch({ instruction: event.target.value })} /><label htmlFor="tk-step-action">Advance after</label><select id="tk-step-action" value={selected.action} onChange={(event) => patch({ action: event.target.value as BrowserCaptureStep["action"] })}><option value="click">Clicking the target</option><option value="input">Entering a value</option><option value="change">Changing the target</option><option value="scroll">Scrolling</option><option value="navigate">Recorded navigation</option><option value="continue">Selecting Next</option></select><label className="tk-capture-checkbox-label"><input type="checkbox" checked={!selected.disabled} disabled={!selected.disabled && capture.steps.filter((step) => !step.disabled).length === 1} onChange={(event) => patch({ disabled: !event.target.checked })} />Include in published tutorial</label></div>
            <div className="tk-capture-inspector-section"><div className="tk-capture-section-title">Element target</div><div className="tk-capture-target-label"><MousePointer2 size={14} /><span>{captureTargetLabel(selected.target)}</span></div><button className={`tk-capture-button is-full${picking ? " is-active" : ""}`} onClick={pick}>{picking ? <X size={14} /> : <Scan size={14} />}{picking ? "Cancel selection" : selected.target ? "Change target" : "Choose target"}</button><p className="tk-capture-help">The highlight follows the actual element as the captured page scrolls.</p><details className="tk-capture-detail"><summary>Edit captured text</summary><label htmlFor="tk-target-text">Replacement text</label><textarea id="tk-target-text" value={targetText} rows={2} onChange={(event) => setTargetText(event.target.value)} placeholder="Select a text-only element or input" /><button className="tk-capture-button is-full" disabled={!selected.target} onClick={editTargetText}>Apply to captured interface</button><p className="tk-capture-help">Updates the recorded DOM for this document. Screenshots and other copies of the text need separate review.</p></details></div>
            <div className="tk-capture-inspector-section"><div className="tk-capture-section-title">Screenshot</div>{selected.screenshot ? <><button className="tk-capture-screenshot-thumbnail" onClick={() => setView("screenshot")}><img src={selected.screenshot.dataUrl} alt={selected.screenshot.alt} /></button><div className="tk-capture-screenshot-meta"><span>{selected.screenshot.width} × {selected.screenshot.height}</span><span>{selected.screenshot.provenance?.reviewedAt ? "Reviewed" : "Needs review"}</span></div><label htmlFor="tk-screenshot-alt">Image description</label><input id="tk-screenshot-alt" value={selected.screenshot.alt} maxLength={500} onChange={(event) => patch({ screenshot: { ...selected.screenshot!, alt: event.target.value } })} /><div className="tk-capture-inline-actions"><button className="tk-capture-button" onClick={() => screenshotInput.current?.click()}>Replace</button><button className="tk-capture-button" onClick={() => patch({ screenshot: { ...selected.screenshot!, provenance: { engine: selected.screenshot!.provenance?.engine ?? "import", capturedAt: selected.screenshot!.provenance?.capturedAt ?? capture.createdAt, ...selected.screenshot!.provenance, reviewedAt: new Date().toISOString() } } })}><Check size={13} />Reviewed</button></div></> : <><p className="tk-capture-help">Attach a PNG for the reading guide, or keep this step as an interface-only capture.</p><button className="tk-capture-button is-full" onClick={() => screenshotInput.current?.click()}><Upload size={14} />Attach screenshot</button></>}</div>
          </aside>}
        </div>
      </>}
    <footer className="tk-capture-status" role="status"><span className="tk-capture-status-dot" />{busy ? "Working…" : message || "Import a recording to begin."}<span className="tk-capture-status-end">{capture ? storageStatus : "TourKit Capture"}</span></footer>
  </div>;
}
