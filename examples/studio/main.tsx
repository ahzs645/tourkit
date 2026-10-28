"use client";

import { useCallback, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { buildTutorialLaunchUrl } from "../../core/schema";
import type { TutorialRecordingDraft } from "../../recording";
import { TutorialStudioEnvironmentProvider, TutorialWorkspace } from "../../studio";
import { Button } from "../../ui";
import { createProjectStudioEnvironment } from "./environment";

const environment = createProjectStudioEnvironment(window.location.href);
const subscribe = (notify: () => void) => { window.addEventListener("popstate", notify); return () => window.removeEventListener("popstate", notify); };
const readOpenId = () => new URLSearchParams(window.location.search).get("open");
function navigate(id: string | null) {
  const target = new URL(environment.studioPath, window.location.origin);
  if (id) target.searchParams.set("open", id);
  window.history.pushState(null, "", target);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
function syncDraft(draft: TutorialRecordingDraft) {
  const url = new URL(window.location.href);
  if (url.searchParams.get("open") === draft.id) return;
  url.searchParams.set("open", draft.id);
  // Replacing the address does not remount an editor while its ID is being edited.
  window.history.replaceState(window.history.state, "", url);
}

export function ProjectStudio() {
  const openId = useSyncExternalStore(subscribe, readOpenId, () => undefined);
  const openDraft = useCallback((id: string) => navigate(id), []);
  return <TutorialStudioEnvironmentProvider environment={environment}>
    <TutorialWorkspace openDraftId={openId} onOpenDraft={openDraft} onDraftChange={syncDraft}
      sourceUrl={(draft) => buildTutorialLaunchUrl(draft.launch)}
      toolbarStart={<Button variant="ghost" onClick={() => navigate(null)}>My tutorials</Button>}
      header={<header className="border-b border-slate-200 bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-white">Project Tutorial Studio</h1>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600 dark:text-slate-400">Create a tutorial, choose Record actions only, then create a project called Launch plan with High priority. Stop recording to edit the steps, preview Watch or Try it, capture screenshots and export a guide. Drafts stay in this browser until you share them.</p>
      </header>} />
  </TutorialStudioEnvironmentProvider>;
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<ProjectStudio />);
