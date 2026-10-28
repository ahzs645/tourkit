"use client";

import { useState } from "react";
import { Copy, Download, Ellipsis, MessageSquarePlus, PencilLine, Play } from "lucide-react";
import { ContextMenu, type ContextMenuItem } from "../ui/context-menu";
import { IconButton } from "../ui/icon-button";
import { DEFAULT_TUTORIAL_STUDIO_ENVIRONMENT, useTutorialStudioEnvironment, type TutorialStudioEnvironment } from "../studio/environment";
import { buildTutorialAiEditingPrompt, tutorialManifestToRecordingDraft } from "../recording";
import type { TutorialManifest, TutorialMode } from "../core/schema";
import { TutorialExportDialog } from "./tutorial-export-dialog";

/**
 * Launcher only: tutorials run at their launch URL in the top window (the
 * workspace or a host stage). Stopping or finishing leaves the learner there.
 */
export function tutorialLaunchHref(tutorial: TutorialManifest, mode: TutorialMode, environment: TutorialStudioEnvironment = DEFAULT_TUTORIAL_STUDIO_ENVIRONMENT): string {
  return `${environment.resolvePath("/")}${environment.buildTutorialHref(tutorial, mode).replace(/^\//, "")}`;
}

/** The studio route, asked to open a given tutorial for editing. */
export function tutorialStudioHref(tutorial: TutorialManifest, environment: TutorialStudioEnvironment = DEFAULT_TUTORIAL_STUDIO_ENVIRONMENT): string {
  return `${environment.resolvePath(environment.studioPath)}?open=${encodeURIComponent(tutorial.id)}`;
}

/**
 * A tutorial's secondary actions. Every file it can become — guides, courses,
 * the Studio draft and the player manifest — is one Export dialog.
 */
export function TutorialCardMenu({ tutorial, onNotice }: { tutorial: TutorialManifest; onNotice: (text: string) => void }) {
  const environment = useTutorialStudioEnvironment();
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const items: ContextMenuItem[] = [
    { id: "edit", label: "Edit in Tutorial Studio", icon: <PencilLine className="h-3.5 w-3.5" />, onSelect: () => window.location.assign(tutorialStudioHref(tutorial, environment)) },
    { id: "preview", label: "Preview (Try it)", icon: <Play className="h-3.5 w-3.5" />, onSelect: () => window.location.assign(tutorialLaunchHref(tutorial, "practice", environment)) },
    { id: "watch", label: "Watch", icon: <Play className="h-3.5 w-3.5" />, onSelect: () => window.location.assign(tutorialLaunchHref(tutorial, "autoplay", environment)) },
    ...(environment.review ? [{
      id: "copy-review",
      label: "Copy review link",
      icon: <MessageSquarePlus className="h-3.5 w-3.5" />,
      onSelect: () => {
        // Reviewers run it as practice and comment on steps, cards and controls as they go.
        const link = environment.review!.startUrl(tutorialLaunchHref(tutorial, "practice", environment), window.location.origin);
        void navigator.clipboard.writeText(link).then(
          () => onNotice(`Review link for “${tutorial.title}” copied. Reviewers comment as they go and send the feedback back as a file.`),
          () => onNotice("The review link could not be copied to the clipboard."),
        );
      },
    }] : []),
    { kind: "separator", id: "sep-export" },
    { id: "export-guide", label: "Export tutorial…", icon: <Download className="h-3.5 w-3.5" />, onSelect: () => setExportOpen(true) },
    {
      id: "copy-ai",
      label: "Copy AI editing prompt",
      icon: <Copy className="h-3.5 w-3.5" />,
      onSelect: () => {
        const prompt = (environment.buildAiEditingPrompt ?? buildTutorialAiEditingPrompt)(tutorialManifestToRecordingDraft(tutorial));
        void navigator.clipboard.writeText(prompt).then(
          () => onNotice(`AI editing prompt for “${tutorial.title}” copied.`),
          () => onNotice("The prompt could not be copied to the clipboard."),
        );
      },
    },
  ];
  return <>
    {exportOpen && <TutorialExportDialog source={{ manifest: tutorial }} onClose={() => setExportOpen(false)} />}
    <IconButton
      icon={<Ellipsis className="h-4 w-4" />}
      aria-label={`More actions for ${tutorial.title}`}
      aria-haspopup="menu"
      aria-expanded={anchor !== null}
      data-testid={`tutorial-card-menu:${tutorial.id}`}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        setAnchor({ x: rect.right, y: rect.bottom + 4 });
      }}
    />
    <ContextMenu open={anchor !== null} x={anchor?.x ?? 0} y={anchor?.y ?? 0} ariaLabel={`Actions for ${tutorial.title}`} onClose={() => setAnchor(null)} items={items} />
  </>;
}

