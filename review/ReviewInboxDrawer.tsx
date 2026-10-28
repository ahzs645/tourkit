"use client";

import { useId, useState, useSyncExternalStore, type ReactNode } from "react";
import clsx from "clsx";
import { Download, FileCheck2, FolderOpen, X } from "lucide-react";

import { Button } from "../ui/button";
import { CONTROL_FOCUS } from "../ui/control-styles";
import { Drawer } from "../ui/drawer";
import { Input } from "../ui/input";
import { useReviewEnvironment } from "./environment";
import {
  addReviewReply,
  currentRound,
  orderedReviewItems,
  personLabel,
  reviewItemNumbers,
  reviewItemState,
  updateReviewItem,
  type ReviewFeedbackBundle,
  type ReviewItem,
  type ReviewSubjectKind,
  type ReviewableField,
} from "./model";
import { ReviewAttachments } from "./attachments";


export interface ReviewInboxProps {
  /** The kinds this inbox works through (the builder: forms; Tutorial Studio: tutorials and emulators). */
  kinds: readonly ReviewSubjectKind[];
  /** Where to drop or open a file, in words ("drop it on the builder"). */
  dropHint: string;
  /** The parts as they are now, to say what changed since the review (fields, steps). */
  partsFor?: (bundle: ReviewFeedbackBundle) => ReadonlyMap<string, ReviewableField>;
  /** Surface-specific actions on an item (show the field, go to the step, add to a note). */
  itemActions?: (item: ReviewItem, bundle: ReviewFeedbackBundle, close: () => void) => ReactNode;
}

/**
 * The author's side of a review: everything reviewers sent back, by round,
 * against the subject as it is now. Items can be answered and resolved, and
 * each surface adds its own actions. The review goes back out as HTML or ZIP
 * (with replies and, optionally, a link to the updated version) for the
 * reviewer's next round, or as a checklist to work through.
 */
export function ReviewInboxHost(props: ReviewInboxProps) {
  const { inbox: store } = useReviewEnvironment();
  const inbox = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  if (!inbox.open || !props.kinds.some((kind) => inbox.open?.includes(kind))) return null;
  return <ReviewInboxDrawer {...props} bundles={inbox.bundles} />;
}

function ReviewInboxDrawer({ kinds, dropHint, partsFor, itemActions, bundles }: ReviewInboxProps & { bundles: Partial<Record<ReviewSubjectKind, ReviewFeedbackBundle>> }) {
  const environment = useReviewEnvironment();
  const { inbox: store, labels } = environment;
  const titleId = useId();
  const available = kinds.filter((kind) => bundles[kind]);
  const [chosen, setChosen] = useState<ReviewSubjectKind | null>(null);
  const kind = chosen && available.includes(chosen) ? chosen : available[0] ?? kinds[0];
  const bundle = bundles[kind] ?? null;
  const [error, setError] = useState<string | null>(null);
  const close = () => store.open(null);

  const openFile = () => {
    const input = Object.assign(window.document.createElement("input"), { type: "file", accept: ".html,.htm,.zip,.json" });
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const { readReviewFeedbackFile } = await import("./files");
        const incoming = await readReviewFeedbackFile(file);
        if (!kinds.includes(incoming.form.kind)) {
          setError(`This is a review of a ${labels(incoming.form.kind).title.toLowerCase()}. Open it in an inbox that accepts this kind of review.`);
          return;
        }
        store.import(incoming);
        setChosen(incoming.form.kind);
        setError(null);
      } catch (openError) {
        setError(openError instanceof Error ? openError.message : "The file could not be opened.");
      }
    };
    input.click();
  };

  return (
    <Drawer open onClose={close} side="right" titleId={titleId} className="w-[420px] max-w-full">
      <div className="flex h-full flex-col text-sm text-slate-800 dark:text-slate-100" data-testid="review-inbox">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <div className="min-w-0">
            <h2 id={titleId} className="font-semibold">Review feedback</h2>
            {bundle ? <p className="truncate text-xs text-slate-500 dark:text-slate-400">{labels(kind).title} · {bundle.form.name} · {bundle.rounds.length} round{bundle.rounds.length === 1 ? "" : "s"}</p> : null}
          </div>
          <Button size="sm" variant="ghost" iconOnly aria-label="Close" leftIcon={<X className="h-4 w-4" />} onClick={close} />
        </div>
        {available.length > 1 ? (
          <div className="flex gap-1 border-b border-slate-200 px-4 py-2 dark:border-slate-700" role="tablist" aria-label="Reviews">
            {available.map((entry) => (
              <button key={entry} type="button" role="tab" aria-selected={entry === kind} onClick={() => setChosen(entry)}
                className={clsx("rounded-md px-2 py-1 text-xs", entry === kind ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : "text-slate-600 dark:text-slate-300", CONTROL_FOCUS)}>
                {labels(entry).title}
              </button>
            ))}
          </div>
        ) : null}
        {!bundle ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-slate-600 dark:text-slate-300">
            <p>Open the HTML, ZIP or JSON a reviewer sent back, or {dropHint}.</p>
            <Button variant="primary" leftIcon={<FolderOpen className="h-4 w-4" />} onClick={openFile}>Open review file</Button>
            {error ? <p role="alert" className="text-xs text-rose-700 dark:text-rose-300">{error}</p> : null}
          </div>
        ) : (
          <ReviewList key={kind} bundle={bundle} parts={partsFor?.(bundle) ?? new Map()} itemActions={itemActions} onOpenFile={openFile} error={error} close={close} />
        )}
      </div>
    </Drawer>
  );
}

function ReviewList({ bundle, parts, itemActions, onOpenFile, error, close }: {
  bundle: ReviewFeedbackBundle;
  parts: ReadonlyMap<string, ReviewableField>;
  itemActions?: ReviewInboxProps["itemActions"];
  onOpenFile: () => void;
  error: string | null;
  close: () => void;
}) {
  const environment = useReviewEnvironment();
  const { inbox: store, labels } = environment;
  const kind = bundle.form.kind;
  const save = (next: ReviewFeedbackBundle) => store.set(kind, next);
  const [filter, setFilter] = useState<"open" | "all">("open");
  const numbers = reviewItemNumbers(bundle);
  const items = orderedReviewItems(bundle).filter((item) => filter === "all" || item.status === "open");
  const [replyFor, setReplyFor] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [shareUrl, setShareUrl] = useState(bundle.form.shareUrl ?? "");
  const [busy, setBusy] = useState(false);
  const me = environment.storage.readStoredPerson();

  const download = async (format: "html" | "zip" | "md") => {
    setBusy(true);
    try {
      const files = await import("./files");
      const next = { ...bundle, form: { ...bundle.form, shareUrl: shareUrl.trim() || bundle.form.shareUrl } };
      save(next);
      const base = files.reviewFileBaseName(next);
      const blob = format === "html" ? files.reviewFeedbackHtmlBlob(next)
        : format === "zip" ? await files.reviewFeedbackZip(next)
        : new Blob([files.reviewChecklistMarkdown(next)], { type: "text/markdown;charset=utf-8" });
      files.downloadReviewBlob(blob, `${base}.${format === "md" ? "checklist.md" : format}`);
    } finally {
      setBusy(false);
    }
  };

  const byRound = new Map<number, ReviewItem[]>();
  for (const item of items) byRound.set(item.round, [...(byRound.get(item.round) ?? []), item]);

  return (
    <>
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-2 dark:border-slate-700">
        <div className="inline-flex rounded-md border border-slate-200 p-0.5 dark:border-slate-700" role="group" aria-label="Show">
          {(["open", "all"] as const).map((value) => (
            <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}
              className={clsx("rounded px-2 py-1 text-xs", filter === value ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : "text-slate-600 dark:text-slate-300", CONTROL_FOCUS)}>
              {value === "open" ? "Open" : "All"}
            </button>
          ))}
        </div>
        <Button size="sm" variant="secondary" leftIcon={<FolderOpen className="h-3.5 w-3.5" />} onClick={onOpenFile}>Open another</Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {items.length === 0 ? <p className="py-6 text-center text-slate-500 dark:text-slate-400">Nothing {filter === "open" ? "open" : "here"}.</p> : null}
        {[...byRound.entries()].map(([round, entries]) => (
          <section key={round} className="mb-4">
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Round {round} · {personLabel(bundle.rounds.find((entry) => entry.number === round)?.reviewer)}
            </h3>
            <ul className="space-y-2">
              {entries.map((item) => {
                const state = parts.size ? reviewItemState(item, parts) : "current";
                const note = state === "changed" || state === "removed" ? labels(kind)[state] : null;
                return (
                  <li key={item.id} className={clsx("rounded-lg border border-slate-200 p-2.5 dark:border-slate-700", item.status === "resolved" && "opacity-60")} data-testid="review-inbox-item">
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white" style={{ background: item.color }}>{numbers.get(item.id)}</span>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{item.anchor.fieldLabel || item.page}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{item.page} · {personLabel(item.author)}{note ? ` · ${note}` : ""}</p>
                      </div>
                    </div>
                    {item.text ? <p className="mt-1.5 whitespace-pre-wrap">{item.text}</p> : item.kind === "drawing" ? <p className="mt-1.5 italic text-slate-500">A drawing on the page.</p> : null}
                    {item.attachments.length ? <div className="mt-1.5"><ReviewAttachments attachments={item.attachments} editable={false} onChange={() => undefined} /></div> : null}
                    {item.replies.map((entry) => (
                      <div key={entry.id} className="mt-1.5 border-l-2 border-slate-200 pl-2 dark:border-slate-700">
                        <p className="text-xs text-slate-500 dark:text-slate-400">{personLabel(entry.author)} · round {entry.round}</p>
                        <p className="whitespace-pre-wrap">{entry.text}</p>
                      </div>
                    ))}
                    {replyFor === item.id ? (
                      <div className="mt-2 flex gap-1.5">
                        <Input autoFocus value={reply} aria-label="Reply" placeholder="Reply to the reviewer" onChange={(event) => setReply(event.target.value)} />
                        <Button size="sm" variant="primary" disabled={!reply.trim()} onClick={() => {
                          save(addReviewReply(bundle, item.id, reply.trim(), me));
                          setReply("");
                          setReplyFor(null);
                        }}>Send</Button>
                      </div>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {state !== "removed" ? itemActions?.(item, bundle, close) : null}
                      <Button size="sm" variant="secondary" onClick={() => setReplyFor(replyFor === item.id ? null : item.id)}>Reply</Button>
                      <Button size="sm" variant={item.status === "resolved" ? "secondary" : "success"} onClick={() => save(updateReviewItem(bundle, item.id, { status: item.status === "resolved" ? "open" : "resolved" }))}>
                        {item.status === "resolved" ? "Reopen" : "Resolve"}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      <div className="space-y-2 border-t border-slate-200 px-4 py-3 dark:border-slate-700">
        <label className="block text-xs">
          <span className="mb-1 block font-medium">Link to the updated version (for round {currentRound(bundle).number + 1})</span>
          <Input value={shareUrl} onChange={(event) => setShareUrl(event.target.value)} placeholder="Paste a new link, or keep the old one" />
        </label>
        {error ? <p role="alert" className="text-xs text-rose-700 dark:text-rose-300">{error}</p> : null}
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="primary" leftIcon={<Download className="h-3.5 w-3.5" />} disabled={busy} onClick={() => void download("html")}>Send back as HTML</Button>
          <Button size="sm" variant="secondary" leftIcon={<Download className="h-3.5 w-3.5" />} disabled={busy} onClick={() => void download("zip")}>ZIP</Button>
          <Button size="sm" variant="secondary" leftIcon={<FileCheck2 className="h-3.5 w-3.5" />} disabled={busy} onClick={() => void download("md")}>Checklist</Button>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => store.set(kind, null)}>Clear</Button>
        </div>
      </div>
    </>
  );
}

