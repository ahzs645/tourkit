"use client";

import { useMemo, useState } from "react";
import { Download, FolderOpen, UserRound, X } from "lucide-react";
import clsx from "clsx";

import { Button } from "../ui/button";
import { CONTROL_FOCUS } from "../ui/control-styles";
import {
  currentRound,
  orderedReviewItems,
  personLabel,
  reviewItemState,
  startNextRound,
  type ReviewFeedbackBundle,
  type ReviewItem,
  type ReviewPerson,
  type ReviewableField,
} from "./model";

import { useReviewEnvironment } from "./environment";

type Filter = "all" | "open" | "round";


/**
 * The reviewer's list of feedback, by page, with the round controls and the
 * files the review leaves as: HTML and ZIP open again; PDF is for reading.
 */
export function ReviewFeedbackPanel({
  bundle,
  numbers,
  me,
  error,
  fields,
  onSelect,
  onBundleChange,
  onEditIdentity,
  onOpenFile,
  onBeforeExport,
  onClose,
}: {
  bundle: ReviewFeedbackBundle;
  numbers: ReadonlyMap<string, string>;
  me: ReviewPerson;
  error: string | null;
  fields: ReadonlyMap<string, ReviewableField>;
  onSelect: (item: ReviewItem) => void;
  onBundleChange: (bundle: ReviewFeedbackBundle) => void;
  onEditIdentity: () => void;
  onOpenFile: () => void;
  onBeforeExport: () => Promise<ReviewFeedbackBundle>;
  onClose: () => void;
}) {
  const environment = useReviewEnvironment();
  const [filter, setFilter] = useState<Filter>("all");
  const [confirmRound, setConfirmRound] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const round = currentRound(bundle);
  const items = useMemo(() => orderedReviewItems(bundle).filter((item) =>
    filter === "all" ? true : filter === "open" ? item.status === "open" : item.round === round.number), [bundle, filter, round.number]);
  const byPage = useMemo(() => {
    const pages = new Map<string, ReviewItem[]>();
    for (const item of items) pages.set(item.page, [...(pages.get(item.page) ?? []), item]);
    return [...pages.entries()];
  }, [items]);

  const download = async (kind: "html" | "pdf" | "zip") => {
    setBusy(kind);
    setExportError(null);
    try {
      const files = await import("./files");
      const next = await onBeforeExport();
      const base = files.reviewFileBaseName(next);
      if (kind === "html") files.downloadReviewBlob(files.reviewFeedbackHtmlBlob(next), `${base}.html`);
      if (kind === "zip") files.downloadReviewBlob(await files.reviewFeedbackZip(next), `${base}.zip`);
      if (kind === "pdf") files.downloadReviewBlob(await files.reviewFeedbackPdf(next), `${base}.pdf`);
    } catch (downloadError) {
      setExportError(downloadError instanceof Error ? downloadError.message : "The file could not be made.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <aside
      data-review-overlay=""
      aria-label="Feedback"
      className="pointer-events-auto absolute inset-y-0 right-0 z-[75] flex w-[340px] max-w-full flex-col border-l border-slate-200 bg-white text-sm text-slate-800 shadow-2xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      data-testid="review-panel"
    >
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2 dark:border-slate-700">
        <h2 className="font-semibold">Feedback</h2>
        <Button size="sm" variant="ghost" iconOnly aria-label="Close feedback list" leftIcon={<X className="h-4 w-4" />} onClick={onClose} />
      </div>

      <div className="space-y-2 border-b border-slate-200 px-3 py-2 dark:border-slate-700">
        <button type="button" onClick={onEditIdentity} className={clsx("flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left hover:bg-slate-50 dark:hover:bg-slate-800", CONTROL_FOCUS)}>
          <UserRound className="h-4 w-4 text-slate-500" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">You: <b>{personLabel(me)}</b></span>
          <span className="text-xs text-sky-700 dark:text-sky-300">Edit</span>
        </button>
        <div className="flex items-center justify-between gap-2">
          <span>Round <b>{round.number}</b>{round.reviewer ? ` · ${personLabel(round.reviewer)}` : ""}</span>
          {confirmRound ? (
            <span className="flex gap-1">
              <Button size="sm" variant="primary" onClick={() => { onBundleChange(startNextRound(bundle, me)); setConfirmRound(false); }}>Start round {round.number + 1}</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmRound(false)}>Cancel</Button>
            </span>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => setConfirmRound(true)}>New round</Button>
          )}
        </div>
        <div className="inline-flex rounded-md border border-slate-200 p-0.5 dark:border-slate-700" role="group" aria-label="Show">
          {(["all", "open", "round"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
              className={clsx("rounded px-2 py-1 text-xs", filter === value ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : "text-slate-600 dark:text-slate-300", CONTROL_FOCUS)}
            >
              {value === "all" ? "All" : value === "open" ? "Open" : `Round ${round.number}`}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {byPage.length === 0 ? (
          <p className="py-6 text-center text-slate-500 dark:text-slate-400">No feedback yet. Choose Comment, Note or Draw below, then click the page.</p>
        ) : byPage.map(([page, entries]) => (
          <section key={page} className="mb-3">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{page}</h3>
            <ul className="space-y-1.5">
              {entries.map((item) => {
                const state = reviewItemState(item, fields);
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(item)}
                      className={clsx("w-full rounded-lg border border-slate-200 px-2 py-1.5 text-left hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800", item.status === "resolved" && "opacity-60", CONTROL_FOCUS)}
                    >
                      <span className="flex items-center gap-1.5">
                        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white" style={{ background: item.color }}>{numbers.get(item.id)}</span>
                        <span className="min-w-0 flex-1 truncate font-medium">{item.anchor.fieldLabel || item.kind}</span>
                        {item.status === "resolved" ? <span className="text-[10px] text-emerald-700 dark:text-emerald-300">Resolved</span> : null}
                      </span>
                      {item.text ? <span className="mt-0.5 line-clamp-2 block text-slate-600 dark:text-slate-300">{item.text}</span> : null}
                      <span className="mt-0.5 block text-[11px] text-slate-500 dark:text-slate-400">
                        {personLabel(item.author)}{item.replies.length ? ` · ${item.replies.length} repl${item.replies.length === 1 ? "y" : "ies"}` : ""}
                        {state === "changed" || state === "removed" ? ` · ${environment.labels(bundle.form.kind)[state]}` : ""}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      <div className="space-y-2 border-t border-slate-200 px-3 py-2 dark:border-slate-700">
        <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-400">
          {environment.snapshotNotice}
        </p>
        {error || exportError ? <p role="alert" className="text-xs text-rose-700 dark:text-rose-300">{error ?? exportError}</p> : null}
        <div className="grid grid-cols-2 gap-1.5">
          <Button size="sm" variant="secondary" leftIcon={<FolderOpen className="h-3.5 w-3.5" />} onClick={onOpenFile}>Open file</Button>
          <Button size="sm" variant="primary" leftIcon={<Download className="h-3.5 w-3.5" />} loading={busy === "html"} disabled={busy !== null} onClick={() => void download("html")}>HTML</Button>
          <Button size="sm" variant="secondary" leftIcon={<Download className="h-3.5 w-3.5" />} loading={busy === "zip"} disabled={busy !== null} onClick={() => void download("zip")}>ZIP</Button>
          <Button size="sm" variant="secondary" leftIcon={<Download className="h-3.5 w-3.5" />} loading={busy === "pdf"} disabled={busy !== null} onClick={() => void download("pdf")}>PDF</Button>
        </div>
        <p className="text-[11px] text-slate-500 dark:text-slate-400">{environment.exportReturnHint}</p>
      </div>
    </aside>
  );
}

