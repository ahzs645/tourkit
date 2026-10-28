"use client";

import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Copy,
  Download,
  Ellipsis,
  FileJson,
  GraduationCap,
  Link2,
  Mic,
  PencilLine,
  Play,
  Plus,
  Share2,
  Trash2,
  Upload,
} from "lucide-react";

import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { ContextMenu, type ContextMenuItem } from "../ui/context-menu";
import { EmptyState } from "../ui/empty-state";
import { IconButton } from "../ui/icon-button";
import { Modal } from "../ui/modal";
import { SearchInput } from "../ui/search-input";
import { Spinner } from "../ui/spinner";
import { TutorialExportDialog } from "../components/tutorial-export-dialog";
import { TutorialShareDialog } from "../components/tutorial-share-dialog";
import {
  normalizeTutorialRecordingDraft,
  serializeTutorialRecordingDraft,
  tutorialManifestToRecordingDraft,
  type TutorialDraftStore,
  type TutorialDraftSummary,
  type TutorialRecordingDraft,
} from "../recording";
import type { TutorialMode } from "../core/schema";
import { TUTORIAL_SHARE_IMPORT_PARAM } from "../share";

import {
  copyOfDraft,
  createBlankStudioDraft,
  downloadStudioFile,
  draftPlayHref,
  isStudioVersionId,
  readSharedTutorialFile,
  safeTutorialFilename,
  STUDIO_VERSION_PREFIX,
  studioHref,
} from "./studio-drafts";

import { useTutorialStudioEnvironment } from "./environment";

function formatUpdated(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "" : at.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export interface MyTutorialsProps {
  draftStore?: TutorialDraftStore;
  /** Optional controlled navigation; ordinary links remain the default. */
  onOpenDraft?: (id: string) => void;
}

/**
 * The Tutorial Studio's front page: every tutorial this browser has authored,
 * kept in the local draft store (IndexedDB, so it works offline). From here a
 * tutorial is created, opened for editing, played, shared as a file or an
 * export (PDF, PowerPoint, HTML…), duplicated, deleted, or imported from a
 * file someone else shared.
 */
export function MyTutorials({ draftStore, onOpenDraft }: MyTutorialsProps) {
  const environment = useTutorialStudioEnvironment();
  const isBuiltInId = environment.isBuiltInTutorialId;
  const stageLabelOf = useCallback((summary: TutorialDraftSummary) => environment.getStage(environment.stageOfLaunch({ path: summary.launchPath ?? "/", fixture: "tutorial-fixture", hash: {} }))?.label ?? environment.defaultStageLabel, [environment]);
  const store = useMemo(() => draftStore ?? environment.createDraftStore(), [draftStore, environment]);
  const [drafts, setDrafts] = useState<TutorialDraftSummary[] | null>(null);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [exporting, setExporting] = useState<TutorialRecordingDraft | null>(null);
  const [sharing, setSharing] = useState<TutorialRecordingDraft | null>(null);
  const [deleting, setDeleting] = useState<TutorialDraftSummary | null>(null);
  // An import whose id is already in the library waits here for Replace / Keep both.
  const [conflict, setConflict] = useState<{ incoming: TutorialRecordingDraft; existingTitle: string } | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const openDraft = (id: string) => onOpenDraft ? onOpenDraft(id) : window.location.assign(studioHref(id, environment));

  const refresh = useCallback(async () => {
    try {
      const entries = await store.list();
      setDrafts(entries.filter((entry) => !isStudioVersionId(entry.id)));
    } catch (error) {
      setDrafts([]);
      setNotice(error instanceof Error ? error.message : "Your saved tutorials could not be read.");
    }
  }, [store]);

  useEffect(() => {
    void refresh();
    // The studio in another tab autosaves into the same store.
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const load = async (id: string): Promise<TutorialRecordingDraft> => {
    const saved = await store.get(id);
    if (!saved) throw new Error("That tutorial is no longer saved in this browser.");
    return normalizeTutorialRecordingDraft(saved);
  };

  const run = (task: () => Promise<void>) => {
    void task().catch((error: unknown) => {
      setNotice(error instanceof Error ? error.message : "Something went wrong.");
    });
  };

  const createNew = () =>
    run(async () => {
      const fresh = createBlankStudioDraft(undefined, environment);
      await store.put(fresh);
      openDraft(fresh.id);
    });

  const play = (id: string, mode: TutorialMode) =>
    run(async () => {
      window.location.assign(draftPlayHref(await load(id), mode, environment));
    });

  const openExport = (id: string) =>
    run(async () => {
      setExporting(await load(id));
    });

  const openShareLink = (id: string) =>
    run(async () => {
      setSharing(await load(id));
    });

  const shareDraftFile = (id: string) =>
    run(async () => {
      const draft = await load(id);
      downloadStudioFile(await serializeTutorialRecordingDraft(draft), `${safeTutorialFilename(draft.title)}.tutorial-draft.json`);
      setNotice(`Saved “${draft.title}” as a .tutorial-draft.json file. Anyone can import it here to edit or play it${draft.audio ? " — narration included" : ""}.`);
    });

  const duplicate = (id: string) =>
    run(async () => {
      const copy = copyOfDraft(await load(id));
      await store.put(copy);
      await refresh();
      setNotice(`Duplicated as “${copy.title}”.`);
    });

  const confirmDelete = (entry: TutorialDraftSummary) =>
    run(async () => {
      setDeleting(null);
      const prefix = `${STUDIO_VERSION_PREFIX}${entry.id}:`;
      const versions = (await store.list()).filter((candidate) => candidate.id.startsWith(prefix));
      await Promise.all([store.delete(entry.id), ...versions.map((version) => store.delete(version.id))]);
      await refresh();
      setNotice(`Deleted “${entry.title}” from this browser.`);
    });

  const finishImport = async (draft: TutorialRecordingDraft, note: string) => {
    await store.put(draft);
    await refresh();
    setNotice(note);
  };

  const importFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    run(async () => {
      const incoming = await readSharedTutorialFile(await file.text());
      const existing = await store.get(incoming.id);
      if (existing) {
        setConflict({ incoming, existingTitle: existing.title });
        return;
      }
      await finishImport(incoming, `Imported “${incoming.title}”.`);
    });
  };

  /* An "Edit a copy" link: /tutorial/studio/#share=<token>. The token leaves
     the address bar first, so a reload never imports the tutorial twice. */
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const token = hash.get(TUTORIAL_SHARE_IMPORT_PARAM);
    if (!token) return;
    hash.delete(TUTORIAL_SHARE_IMPORT_PARAM);
    const rest = hash.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}${rest ? `#${rest}` : ""}`);
    run(async () => {
      const { decodeTutorialShare } = environment.shareCodec;
      const incoming = tutorialManifestToRecordingDraft(await decodeTutorialShare(token));
      const existing = await store.get(incoming.id);
      if (existing) {
        setConflict({ incoming, existingTitle: existing.title });
        return;
      }
      await finishImport(incoming, `Saved “${incoming.title}” from a shared link. Edit it, or play it with Try it.`);
    });
    // Once, on arrival; store and helpers are stable for the page's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!drafts || !needle) return drafts ?? [];
    return drafts.filter((entry) =>
      [entry.title, entry.description ?? "", stageLabelOf(entry)].some((text) => text.toLowerCase().includes(needle)),
    );
  }, [drafts, query, stageLabelOf]);

  const menuEntry = menu ? drafts?.find((entry) => entry.id === menu.id) ?? null : null;
  const menuItems: ContextMenuItem[] = menuEntry
    ? [
        { id: "edit", label: "Edit", icon: <PencilLine className="h-3.5 w-3.5" />, onSelect: () => openDraft(menuEntry.id) },
        { id: "try", label: "Try it", icon: <Play className="h-3.5 w-3.5" />, onSelect: () => play(menuEntry.id, "practice"), disabled: !menuEntry.stepCount },
        { id: "watch", label: "Watch", icon: <Play className="h-3.5 w-3.5" />, onSelect: () => play(menuEntry.id, "autoplay"), disabled: !menuEntry.stepCount },
        { kind: "separator", id: "sep-share" },
        { id: "export", label: "Share as PDF, PowerPoint, HTML…", icon: <Share2 className="h-3.5 w-3.5" />, onSelect: () => openExport(menuEntry.id), disabled: !menuEntry.stepCount },
        { id: "share-link", label: "Share as link…", icon: <Link2 className="h-3.5 w-3.5" />, onSelect: () => openShareLink(menuEntry.id), disabled: !menuEntry.stepCount },
        { id: "share-json", label: "Share as editable file (.tutorial-draft.json)", icon: <FileJson className="h-3.5 w-3.5" />, onSelect: () => shareDraftFile(menuEntry.id) },
        { kind: "separator", id: "sep-manage" },
        { id: "duplicate", label: "Duplicate", icon: <Copy className="h-3.5 w-3.5" />, onSelect: () => duplicate(menuEntry.id) },
        { id: "delete", label: "Delete", icon: <Trash2 className="h-3.5 w-3.5" />, danger: true, onSelect: () => setDeleting(menuEntry) },
      ]
    : [];

  const importButton = (
    <Button onClick={() => importInputRef.current?.click()} leftIcon={<Upload className="h-4 w-4" />}>
      Import
    </Button>
  );

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-8" data-testid="my-tutorials">
      {sharing ? <TutorialShareDialog source={{ draft: sharing }} onClose={() => setSharing(null)} /> : null}
      {exporting ? (
        <TutorialExportDialog
          source={{ draft: exporting }}
          onClose={() => setExporting(null)}
        />
      ) : null}
      <ConfirmDialog
        open={deleting !== null}
        destructive
        title={`Delete “${deleting?.title ?? ""}”?`}
        description="The tutorial, its narration, and its saved versions are removed from this browser. Files you already shared are not affected."
        confirmLabel="Delete"
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && confirmDelete(deleting)}
      />
      <Modal open={conflict !== null} onClose={() => setConflict(null)} size="sm">
        <Modal.Header
          title="This tutorial is already in your library"
          description={
            conflict
              ? `“${conflict.incoming.title}” has the same id as your saved “${conflict.existingTitle}”. Replace it with the imported file, or keep both?`
              : undefined
          }
          hideClose
        />
        <Modal.Footer>
          <Button size="sm" variant="secondary" onClick={() => setConflict(null)}>Cancel</Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              const incoming = conflict?.incoming;
              setConflict(null);
              if (incoming) run(() => finishImport(copyOfDraft(incoming, incoming.title), `Imported “${incoming.title}” as a separate copy.`));
            }}
          >
            Keep both
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              const incoming = conflict?.incoming;
              setConflict(null);
              if (incoming) run(() => finishImport(incoming, `Replaced “${incoming.title}” with the imported file.`));
            }}
          >
            Replace
          </Button>
        </Modal.Footer>
      </Modal>
      <input ref={importInputRef} type="file" accept="application/json,.json" hidden onChange={importFile} />

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">My tutorials</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
            Tutorials you have recorded, saved in this browser and available offline. Open one to keep editing,
            play it, or share it — as an editable file others can import here, or as a PDF, PowerPoint, HTML page,
            or another export.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {importButton}
          <Button variant="primary" onClick={createNew} leftIcon={<Plus className="h-4 w-4" />}>
            New tutorial
          </Button>
        </div>
      </header>

      {notice ? (
        <p role="status" className="mt-4 text-sm text-slate-600 dark:text-slate-300">{notice}</p>
      ) : null}

      {drafts === null ? (
        <div className="mt-16 flex justify-center">
          <Spinner label="Loading your tutorials" />
        </div>
      ) : drafts.length === 0 ? (
        <EmptyState
          className="mt-8"
          icon={<GraduationCap className="h-8 w-8" />}
          title="You have not created a tutorial yet"
          description="Create one to record a workflow on a training fixture, or import a tutorial file someone shared with you."
          action={
            <div className="flex items-center gap-2">
              <Button variant="primary" onClick={createNew} leftIcon={<Plus className="h-4 w-4" />}>
                Create a new tutorial
              </Button>
              {importButton}
            </div>
          }
        />
      ) : (
        <>
          {drafts.length > 6 ? (
            <div className="mt-6 max-w-sm">
              <SearchInput
                aria-label="Search my tutorials"
                placeholder="Search by title, description, or stage"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onClear={() => setQuery("")}
              />
            </div>
          ) : null}
          {visible.length === 0 ? (
            <p className="mt-8 text-sm text-slate-500">No tutorials match “{query}”.</p>
          ) : null}
          <ul className="mt-6 grid gap-4 md:grid-cols-2">
            {visible.map((entry) => (
              <li
                key={entry.id}
                data-my-tutorial={entry.id}
                className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-base font-semibold leading-6 text-slate-900 dark:text-white">
                    <a href={studioHref(entry.id, environment)} className="hover:underline" onClick={(event) => {
                      if (!onOpenDraft || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                      event.preventDefault(); onOpenDraft(entry.id);
                    }}>
                      {entry.title || "Untitled tutorial"}
                    </a>
                  </h2>
                  <IconButton
                    icon={<Ellipsis className="h-4 w-4" />}
                    aria-label={`More actions for ${entry.title || "Untitled tutorial"}`}
                    aria-haspopup="menu"
                    aria-expanded={menu?.id === entry.id}
                    onClick={(event) => {
                      const rect = event.currentTarget.getBoundingClientRect();
                      setMenu({ id: entry.id, x: rect.right, y: rect.bottom + 4 });
                    }}
                  />
                </div>
                {entry.description ? (
                  <p className="mt-2 line-clamp-3 flex-1 text-sm leading-6 text-slate-600 dark:text-slate-300">{entry.description}</p>
                ) : (
                  <div className="flex-1" />
                )}
                <div className="mt-4 flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-slate-800">{stageLabelOf(entry)}</span>
                  <span>
                    {entry.stepCount ?? 0} step{entry.stepCount === 1 ? "" : "s"}
                  </span>
                  {entry.hasAudio ? (
                    <span className="inline-flex items-center gap-1">
                      <Mic className="h-3 w-3" aria-hidden="true" />
                      Narrated
                    </span>
                  ) : null}
                  {isBuiltInId(entry.id) ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">
                      Edited built-in
                    </span>
                  ) : null}
                  <span className="ml-auto">Updated {formatUpdated(entry.updatedAt)}</span>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    leftIcon={<PencilLine className="h-3.5 w-3.5" />}
                    onClick={() => openDraft(entry.id)}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    leftIcon={<Play className="h-3.5 w-3.5" />}
                    disabled={!entry.stepCount}
                    title={entry.stepCount ? "Play it as a learner would" : "Record some steps first"}
                    onClick={() => play(entry.id, "practice")}
                  >
                    Try it
                  </Button>
                  <Button
                    size="sm"
                    leftIcon={<Download className="h-3.5 w-3.5" />}
                    disabled={!entry.stepCount}
                    title={entry.stepCount ? "PDF, PowerPoint, Word, HTML, SCORM, GIF, Markdown, JSON" : "Record some steps first"}
                    onClick={() => openExport(entry.id)}
                  >
                    Share…
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      <ContextMenu
        open={menu !== null}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        ariaLabel={`Actions for ${menuEntry?.title ?? "tutorial"}`}
        onClose={() => setMenu(null)}
        items={menuItems}
      />
    </div>
  );
}


