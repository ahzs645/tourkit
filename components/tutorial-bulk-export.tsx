"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { SearchInput } from "../ui/search-input";
import { downloadTutorialFile, tutorialExportFormat, type TutorialExportFormat } from "../export";
import { tutorialFilename } from "../export/document";
import { interactiveTutorialUnavailable } from "../export/interactive";
import { DEFAULT_TUTORIAL_EXPORT_OPTIONS, readTutorialExportOptions, saveTutorialExportOptions, type TutorialExportOptions } from "../export/options";
import type { TutorialManifest } from "../core/schema";
import { useTutorialStudioEnvironment } from "../studio/environment";
import { TutorialExportSettings } from "./tutorial-export-settings";
import { runTutorialExport, stepsNeedingScreenshots, type TutorialScreenshotCache } from "./tutorial-export-runner";

export interface TutorialExportGroup { id: string; title: string; tutorials: readonly TutorialManifest[] }

const stepCount = (tutorial: TutorialManifest) => tutorial.chapters.reduce((count, chapter) => count + chapter.steps.length, 0);

/**
 * The Export view: pick tutorials by section, choose one format, and get one
 * file (a single tutorial) or a ZIP with a folder per section. Screenshots are
 * taken on demand, one tutorial at a time; a failure skips that tutorial only.
 */
export function TutorialBulkExport({ area, groups }: { area: string; groups: readonly TutorialExportGroup[] }) {
  const environment = useTutorialStudioEnvironment();
  const [format, setFormat] = useState<TutorialExportFormat>("pdf");
  const [options, setOptions] = useState(() => environment.exportPreferences?.defaults ?? DEFAULT_TUTORIAL_EXPORT_OPTIONS);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failures, setFailures] = useState<{ title: string; error: string }[]>([]);
  const controller = useRef<AbortController | null>(null);
  // Mutated by exports; the version re-renders the screenshot counts once a run ends.
  const [cache] = useState<TutorialScreenshotCache>(() => new Map());
  const [, setCacheVersion] = useState(0);
  useEffect(() => setOptions((environment.exportPreferences?.read ?? readTutorialExportOptions)()), [environment.exportPreferences]);
  useEffect(() => () => controller.current?.abort(), []);

  const entry = tutorialExportFormat(format);
  const all = useMemo(() => groups.flatMap((group) => group.tutorials), [groups]);
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (tutorial: TutorialManifest) => {
    const haystack = `${tutorial.title} ${tutorial.description ?? ""}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  };
  const shown = groups.map((group) => ({ ...group, shown: group.tutorials.filter(matches) })).filter((group) => group.shown.length);
  const chosen = all.filter((tutorial) => selected.has(tutorial.id));
  const unsupported = format === "interactive-html" ? chosen.filter((tutorial) => interactiveTutorialUnavailable({ manifest: tutorial }, environment.exportRuntime)) : [];
  const screenshots = entry.reading && options.includeScreenshots
    ? chosen.reduce((count, tutorial) => count + stepsNeedingScreenshots({ manifest: tutorial }, cache.get(`${tutorial.id}:${options.screenshotFraming}`)), 0)
    : 0;
  const minutes = Math.max(1, Math.round((screenshots * 1.3 + chosen.length * 4) / 60));

  const updateOptions = (patch: Partial<TutorialExportOptions>) => {
    const next = { ...options, ...patch };
    setOptions(next); (environment.exportPreferences?.save ?? saveTutorialExportOptions)(next); setMessage("");
  };
  const toggle = (ids: readonly string[], on: boolean) => setSelected((current) => {
    const next = new Set(current);
    for (const id of ids) { if (on) next.add(id); else next.delete(id); }
    return next;
  });

  const run = async () => {
    if (busy || !chosen.length) return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true); setFailures([]);
    const files: { folder: string; blob: Blob; filename: string }[] = [];
    const failed: { title: string; error: string }[] = [];
    try {
      for (const [index, tutorial] of chosen.entries()) {
        abort.signal.throwIfAborted();
        const prefix = `${index + 1} of ${chosen.length} · ${tutorial.title}`;
        setMessage(prefix);
        try {
          const blocked = format === "interactive-html" ? interactiveTutorialUnavailable({ manifest: tutorial }, environment.exportRuntime) : null;
          if (blocked) throw new Error(blocked);
          const result = await runTutorialExport({ environment, source: { manifest: tutorial }, format, options, cache: cache, signal: abort.signal,
            onProgress: (text) => setMessage(`${prefix} — ${text}`) });
          const group = groups.find((candidate) => candidate.tutorials.includes(tutorial));
          files.push({ folder: tutorialFilename(group?.title ?? area), ...result });
        } catch (cause) {
          if (abort.signal.aborted) throw cause;
          failed.push({ title: tutorial.title, error: cause instanceof Error ? cause.message : "The export failed." });
        }
      }
      if (files.length === 1 && chosen.length === 1) {
        downloadTutorialFile(files[0].blob, files[0].filename);
        setMessage(`Downloaded ${files[0].filename}`);
      } else if (files.length) {
        setMessage(`Packing ${files.length} files…`);
        const { default: JSZip } = await import("jszip");
        const zip = new JSZip();
        const folders = new Set(files.map((file) => file.folder));
        for (const file of files) zip.file(folders.size > 1 ? `${file.folder}/${file.filename}` : file.filename, file.blob);
        const filename = `${tutorialFilename(area)}-tutorials-${format}.zip`;
        downloadTutorialFile(await zip.generateAsync({ type: "blob", compression: "DEFLATE" }), filename);
        setMessage(`Downloaded ${filename} with ${files.length} tutorial${files.length === 1 ? "" : "s"}.`);
      } else setMessage("Nothing was exported.");
    } catch {
      setMessage(`Export cancelled after ${files.length} of ${chosen.length}. Screenshots already taken are kept for the next try.`);
    } finally {
      setFailures(failed);
      controller.current = null; setBusy(false); setCacheVersion((version) => version + 1);
    }
  };

  return <div className="grid gap-8 md:grid-cols-[22rem_minmax(0,1fr)]">
    <aside className="md:sticky md:top-6 md:self-start">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-base font-semibold">Format and options</h2>
        <div className="mt-4">
          <TutorialExportSettings format={format} options={options} disabled={busy} onOptionsChange={updateOptions}
            onFormatChange={(value) => { setFormat(value); setMessage(""); }}
            unavailable={unsupported.length ? `${unsupported.length} selected tutorial${unsupported.length === 1 ? "" : "s"} can’t be exported as Interactive HTML and will be skipped.` : null}
            screenshotNote={screenshots
              ? `${screenshots} screenshots are taken during the export by replaying each tutorial off-screen — about ${minutes} min. Review the images before sharing.`
              : "Screenshots are taken during the export, by replaying each tutorial off-screen."} />
        </div>
      </div>
    </aside>

    <section aria-label="Tutorials to export" className="min-w-0">
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput aria-label="Search tutorials to export" placeholder="Search tutorials" value={query} className="w-full sm:w-72"
          onChange={(event) => setQuery(event.target.value)} onClear={() => setQuery("")} />
        <Button size="sm" disabled={busy} onClick={() => toggle(shown.flatMap((group) => group.shown.map((tutorial) => tutorial.id)), true)}>
          Select {words.length ? "matches" : "all"}
        </Button>
        <Button size="sm" disabled={busy || !selected.size} onClick={() => setSelected(new Set())}>Clear</Button>
      </div>

      <div className="sticky top-0 z-10 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {chosen.length ? <><strong className="text-slate-900 dark:text-white">{chosen.length}</strong> selected · {chosen.length === 1 ? `one ${entry.extension} file` : `a ZIP of ${entry.label} files`}</> : "Select the tutorials to export."}
        </p>
        <div className="flex gap-2">
          {busy ? <Button size="sm" onClick={() => controller.current?.abort()}>Cancel</Button> : null}
          <Button size="sm" variant="primary" loading={busy} disabled={!chosen.length} leftIcon={<Download className="h-3.5 w-3.5" />} onClick={() => void run()}>
            Export {chosen.length || ""} {chosen.length === 1 ? "tutorial" : "tutorials"}
          </Button>
        </div>
        {message ? <p role="status" className="w-full text-sm text-slate-600 dark:text-slate-300">{message}</p> : null}
        {failures.length ? <div role="alert" className="w-full text-sm text-red-700 dark:text-red-300">
          <p>{failures.length} tutorial{failures.length === 1 ? " was" : "s were"} skipped:</p>
          <ul className="mt-1 list-disc pl-5">{failures.map((failure) => <li key={failure.title}>{failure.title}: {failure.error}</li>)}</ul>
        </div> : null}
      </div>

      {shown.length === 0 ? <p className="mt-6 text-sm text-slate-500">No tutorials match.</p> : null}
      {shown.map((group) => {
        const ids = group.shown.map((tutorial) => tutorial.id);
        const count = ids.filter((id) => selected.has(id)).length;
        return <fieldset key={group.id} className="mt-6">
          <legend className="flex w-full items-center gap-3">
            <label className="inline-flex items-center gap-2.5 text-sm font-semibold">
              <Checkbox checked={count === ids.length} indeterminate={count > 0 && count < ids.length} disabled={busy}
                onChange={(event) => toggle(ids, event.target.checked)} aria-label={`Select every tutorial in ${group.title}`} />
              {group.title}
            </label>
            <span className="text-xs text-slate-500">{count ? `${count} of ${ids.length}` : ids.length}</span>
          </legend>
          <ul className="mt-2 divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
            {group.shown.map((tutorial) => <li key={tutorial.id}>
              <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/60">
                <Checkbox checked={selected.has(tutorial.id)} disabled={busy} onChange={(event) => toggle([tutorial.id], event.target.checked)} />
                <span className="min-w-0 flex-1 truncate text-sm">{tutorial.title}</span>
                <span className="shrink-0 text-xs text-slate-500">{stepCount(tutorial)} steps</span>
              </label>
            </li>)}
          </ul>
        </fieldset>;
      })}
    </section>
  </div>;
}

