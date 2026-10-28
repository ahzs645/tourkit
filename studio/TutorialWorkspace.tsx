"use client";

import { useMemo, type ReactNode } from "react";
import clsx from "clsx";
import { MyTutorials } from "./my-tutorials";
import { TutorialStudio, type TutorialStudioProps } from "./tutorial-studio";
import { useTutorialStudioEnvironment } from "./environment";

export interface TutorialWorkspaceProps extends Pick<TutorialStudioProps, "draftStore" | "sourceUrl" | "onDraftChange" | "toolbarStart" | "toolbarEnd"> {
  /** A draft ID opens its editor; null shows My tutorials; undefined is a loading route. */
  openDraftId: string | null | undefined;
  /** The host owns history/router behavior. Omitted keeps the library's ordinary links. */
  onOpenDraft?: (id: string) => void;
  header?: ReactNode;
  loadingContent?: ReactNode;
  className?: string;
}

/** Controlled library/editor composition without a router or URL policy of its own. */
export function TutorialWorkspace({ openDraftId, onOpenDraft, header, loadingContent = null, className, ...studioProps }: TutorialWorkspaceProps) {
  const environment = useTutorialStudioEnvironment();
  const initialDraft = useMemo(() => openDraftId ? { ...environment.createDraft(environment.readPreferredStage()), id: openDraftId } : undefined, [environment, openDraftId]);
  return <main className={clsx("flex min-h-screen flex-col bg-slate-50 dark:bg-slate-950 lg:h-screen lg:overflow-hidden", className)}>
    {openDraftId === null ? header : null}
    {initialDraft ? <TutorialStudio key={openDraftId} {...studioProps} initialDraft={initialDraft} openDraftId={openDraftId} className="min-h-0 flex-1" />
      : openDraftId === null ? <div className="min-h-0 flex-1 overflow-y-auto"><MyTutorials draftStore={studioProps.draftStore} onOpenDraft={onOpenDraft} /></div>
        : loadingContent}
  </main>;
}
