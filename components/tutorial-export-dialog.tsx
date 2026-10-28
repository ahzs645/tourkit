"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Eye } from "lucide-react";
import { Modal } from "../ui/modal";
import { Button } from "../ui/button";
import { DEFAULT_TUTORIAL_EXPORT_OPTIONS, readTutorialExportOptions, saveTutorialExportOptions, type TutorialExportOptions } from "../export/options";
import { downloadTutorialFile, tutorialExportFormat, type TutorialExportFormat, type TutorialExportSource } from "../export";
import { interactiveTutorialUnavailable } from "../export/interactive";
import { useTutorialStudioEnvironment } from "../studio/environment";
import { TutorialExportSettings } from "./tutorial-export-settings";
import { runTutorialExport, stepsNeedingScreenshots, tutorialScreenshotCacheKey, tutorialSourceSteps, tutorialSourceTitle, type TutorialScreenshotCache } from "./tutorial-export-runner";

/** Screenshots are taken while the file is built, then kept for this dialog so a second format reuses them. */
export function TutorialExportDialog({ source, onClose }: { source: TutorialExportSource; onClose: () => void }) {
  const environment = useTutorialStudioEnvironment();
  const sourceValue = "draft" in source ? source.draft : source.manifest;
  const [format, setFormat] = useState<TutorialExportFormat>("pdf");
  const [busy, setBusy] = useState(false);
  const [prepared, setPrepared] = useState<{ blob: Blob; filename: string; url: string; options: string; sourceValue: typeof sourceValue } | null>(null);
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);
  // Mutated by exports; the version re-renders the screenshot counts once a run ends.
  const [cache] = useState<TutorialScreenshotCache>(() => new Map());
  const [, setCacheVersion] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [options, setOptions] = useState(() => environment.exportPreferences?.defaults ?? DEFAULT_TUTORIAL_EXPORT_OPTIONS);
  useEffect(() => setOptions((environment.exportPreferences?.read ?? readTutorialExportOptions)()), [environment.exportPreferences]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controller.current?.abort(); };
  }, []);
  useEffect(() => () => { if (prepared) URL.revokeObjectURL(prepared.url); }, [prepared]);
  // A preview is the exact file for one source and set of options.
  useEffect(() => { controller.current?.abort(); setPrepared(null); }, [sourceValue]);
  const updateOptions = (patch: Partial<TutorialExportOptions>) => {
    controller.current?.abort();
    const next = { ...options, ...patch };
    setOptions(next); (environment.exportPreferences?.save ?? saveTutorialExportOptions)(next); setPrepared(null); setMessage(""); setError("");
  };
  const entry = tutorialExportFormat(format);
  const title = tutorialSourceTitle(source);
  const steps = tutorialSourceSteps(source);
  const saved = steps.filter((step) => step.screenshotMode !== "none" && step.screenshot).length;
  const textOnly = steps.filter((step) => step.screenshotMode === "none").length;
  const textOnlyNote = `${textOnly} ${textOnly === 1 ? "step is" : "steps are"} text only.`;
  const toTake = stepsNeedingScreenshots(source, cache.get(tutorialScreenshotCacheKey(source, options.screenshotFraming)));
  const unavailable = format === "interactive-html" ? interactiveTutorialUnavailable(source, environment.exportRuntime) : null;
  const screenshotNote = toTake === 0
    ? textOnly ? `All requested screenshots are ready. ${textOnlyNote}` : "Every step has a screenshot ready."
    : `${toTake} of ${steps.length} steps are photographed when you download, replaying the tutorial off-screen (about ${Math.max(5, Math.round(toTake * 1.3))} s).${saved ? ` ${saved} saved in Studio are used as they are.` : ""}${textOnly ? ` ${textOnlyNote}` : ""} Review the images before sharing.`;

  const build = async (previewOnly = false) => {
    if (format === "pdf" && prepared && prepared.sourceValue === sourceValue && prepared.options === JSON.stringify(options)) {
      if (!previewOnly) { downloadTutorialFile(prepared.blob, prepared.filename); setMessage(`Downloaded ${prepared.filename}`); }
      return;
    }
    if (inFlight.current) return;
    inFlight.current = true;
    const run = new AbortController();
    controller.current = run;
    setBusy(true); setError(""); setMessage(`Preparing ${entry.label}…`);
    try {
      const result = await runTutorialExport({ environment, source, format, options, cache: cache, signal: run.signal, onProgress: setMessage });
      run.signal.throwIfAborted();
      if (!mounted.current) return;
      if (format === "pdf") setPrepared({ ...result, url: URL.createObjectURL(result.blob), options: JSON.stringify(options), sourceValue });
      if (!previewOnly) { downloadTutorialFile(result.blob, result.filename); setMessage(`Downloaded ${result.filename}`); }
      else setMessage("PDF preview ready. Download saves this exact file.");
    } catch (cause) {
      if (!mounted.current) return;
      if (run.signal.aborted) setMessage("Export cancelled. Screenshots already taken are kept for the next try.");
      else { setError(cause instanceof Error ? cause.message : "The export could not be created. Try again."); setMessage(""); }
    } finally { controller.current = null; inFlight.current = false; if (mounted.current) { setBusy(false); setCacheVersion((version) => version + 1); } }
  };

  const previewVisible = format === "pdf" && prepared?.sourceValue === sourceValue && prepared.options === JSON.stringify(options);
  return <Modal open onClose={onClose} busy={busy} size={previewVisible ? "xl" : "md"}>
    <Modal.Header title="Export tutorial" description={title} />
    <Modal.Body className={previewVisible ? "grid gap-5 md:grid-cols-[minmax(260px,0.75fr)_minmax(0,1.25fr)]" : "space-y-5"}>
      <div className="space-y-5">
      <TutorialExportSettings format={format} options={options} disabled={busy} unavailable={unavailable} screenshotNote={screenshotNote}
        onFormatChange={(value) => { setFormat(value); setMessage(""); setError(""); }} onOptionsChange={updateOptions} />
      {message && <p role="status" className="text-sm text-slate-600 dark:text-slate-300">{message}</p>}
      {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
      </div>
      {previewVisible && prepared && <div className="min-w-0 space-y-2">
        <p className="text-xs text-slate-500">This is the generated PDF. Download uses the same file until you change a setting.</p>
        <iframe title="PDF export preview" src={prepared.url} className="h-[65vh] w-full rounded-lg border border-slate-200 bg-slate-100" />
        <a href={prepared.url} target="_blank" rel="noopener noreferrer" className="text-sm text-sky-700 underline">Open PDF preview in a new tab</a>
      </div>}
    </Modal.Body>
    <Modal.Footer>
      {busy ? <Button onClick={() => controller.current?.abort()}>Cancel</Button> : <Button onClick={onClose}>Close</Button>}
      {format === "pdf" && <Button onClick={() => void build(true)} disabled={busy} leftIcon={<Eye className="h-4 w-4" />}>Preview PDF</Button>}
      <Button variant="primary" onClick={() => void build()} loading={busy} disabled={Boolean(unavailable)} leftIcon={<Download className="h-4 w-4" />}>
        Download {entry.label}
      </Button>
    </Modal.Footer>
  </Modal>;
}

