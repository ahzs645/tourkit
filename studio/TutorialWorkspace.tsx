"use client";

import { lazy, Suspense, useMemo, useState, type ReactNode } from "react";
import clsx from "clsx";
import { MyTutorials } from "./my-tutorials";
import { TutorialStudio, type TutorialStudioProps } from "./tutorial-studio";
import { useTutorialStudioEnvironment } from "./environment";
import { Button } from "../ui/button";
import type { BrowserCapturePackage } from "../browser-capture/types";

const CapturedWebsiteStudio = lazy(() => import("../browser-capture-studio").then((module) => ({ default: module.CaptureStudio })));

export interface TutorialWorkspaceProps extends Pick<TutorialStudioProps, "draftStore" | "sourceUrl" | "onDraftChange" | "toolbarStart" | "toolbarEnd"> {
  /** A draft ID opens its editor; null shows My tutorials; undefined is a loading route. */
  openDraftId: string | null | undefined;
  /** The host owns history/router behavior. Omitted keeps the library's ordinary links. */
  onOpenDraft?: (id: string) => void;
  header?: ReactNode;
  loadingContent?: ReactNode;
  className?: string;
  /** Offer the optional captured-website editor alongside semantic lessons. */
  browserCapture?: boolean;
  /** Hosts can supply the prebuilt runtime used by standalone interactive export. */
  exportCapturedInteractive?: (capture: BrowserCapturePackage) => Promise<Blob>;
}

/** Controlled library/editor composition without a router or URL policy of its own. */
export function TutorialWorkspace({ openDraftId, onOpenDraft, header, loadingContent = null, className, browserCapture = true, exportCapturedInteractive, ...studioProps }: TutorialWorkspaceProps) {
  const environment = useTutorialStudioEnvironment();
  const [capturedWebsiteOpen, setCapturedWebsiteOpen] = useState(false);
  const initialDraft = useMemo(() => openDraftId ? { ...environment.createDraft(environment.readPreferredStage()), id: openDraftId } : undefined, [environment, openDraftId]);
  return <main className={clsx("flex min-h-screen flex-col bg-slate-50 dark:bg-slate-950 lg:h-screen lg:overflow-hidden", className)}>
    {browserCapture && openDraftId !== undefined && <div className="flex shrink-0 items-center justify-end gap-3 border-b border-slate-200 bg-white px-4 py-2 dark:border-slate-800 dark:bg-slate-900">
      {capturedWebsiteOpen && <span className="mr-auto text-xs text-slate-500">Captured website editor</span>}
      <Button size="sm" onClick={() => setCapturedWebsiteOpen((open) => !open)}>{capturedWebsiteOpen ? "Back to application tutorials" : "Import captured website"}</Button>
    </div>}
    {capturedWebsiteOpen ? <Suspense fallback={<p className="p-6 text-sm text-slate-500">Opening Capture Studio…</p>}><CapturedWebsiteStudio exportInteractive={exportCapturedInteractive} className="tk-capture-embedded" /></Suspense> : <>
    {openDraftId === null ? header : null}
    {initialDraft ? <TutorialStudio key={openDraftId} {...studioProps} initialDraft={initialDraft} openDraftId={openDraftId} className="min-h-0 flex-1" />
      : openDraftId === null ? <div className="min-h-0 flex-1 overflow-y-auto"><MyTutorials draftStore={studioProps.draftStore} onOpenDraft={onOpenDraft} /></div>
        : loadingContent}
    </>}
  </main>;
}
