"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { ZodError } from "zod";
import { Button } from "../ui/button";
import { FIELD_LABEL } from "../ui/control-styles";
import { Input } from "../ui/input";
import { Modal } from "../ui/modal";
import { useTutorialStudioEnvironment } from "../studio/environment";
import { tutorialRecordingDraftToManifest, type TutorialRecordingDraft } from "../recording";
import type { TutorialManifest } from "../core/schema";
import {
  TUTORIAL_SHARE_SOFT_LIMIT,
  tutorialShareImportUrl,
  tutorialShareRunUrl,
} from "../share";

type Links = { practice: string; autoplay: string; edit: string; review: string; droppedMedia: boolean };

/**
 * Share a tutorial as a link. Nothing is uploaded: the tutorial is compressed
 * into the URL, so anyone with the link can open it in Try it or Watch, or
 * save an editable copy in their own Tutorial Studio.
 */
export function TutorialShareDialog({ source, onClose }: {
  source: { draft: TutorialRecordingDraft } | { manifest: TutorialManifest };
  onClose: () => void;
}) {
  const environment = useTutorialStudioEnvironment();
  const { encodeTutorialShare, shareableTutorialManifest } = environment.shareCodec;
  const resolveAppPath = environment.resolvePath;
  const [links, setLinks] = useState<Links | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<keyof Links | null>(null);
  const title = "draft" in source ? source.draft.title : source.manifest.title;

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const manifest = "draft" in source ? tutorialRecordingDraftToManifest(source.draft) : source.manifest;
        const steps = manifest.chapters.flatMap((chapter) => chapter.steps);
        const kept = shareableTutorialManifest(manifest).chapters.flatMap((chapter) => chapter.steps);
        const droppedMedia = ("draft" in source && Boolean(source.draft.audio))
          || steps.some((step, index) => Boolean(step.screenshot) || (Boolean(step.narration) && !kept[index].narration));
        const token = await encodeTutorialShare(manifest);
        const origin = new URL(resolveAppPath("/"), window.location.href).href.replace(/\/$/, "");
        const studio = new URL(resolveAppPath(environment.studioPath), window.location.href).href;
        if (active) setLinks({
          practice: tutorialShareRunUrl(manifest, token, "practice", origin),
          autoplay: tutorialShareRunUrl(manifest, token, "autoplay", origin),
          edit: tutorialShareImportUrl(token, studio),
          review: environment.review?.startUrl(tutorialShareRunUrl(manifest, token, "practice", origin)) ?? "",
          droppedMedia,
        });
      } catch (cause) {
        if (!active) return;
        setError(cause instanceof ZodError
          ? "Finish every step first — each needs a title, an instruction, and an action or outcome — then share it as a link."
          : cause instanceof Error ? cause.message : "The link could not be made.");
      }
    })();
    return () => { active = false; };
  }, [source, environment, encodeTutorialShare, shareableTutorialManifest, resolveAppPath]);

  const copy = (key: keyof Links, value: string) => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(key);
      setTimeout(() => setCopied((current) => (current === key ? null : current)), 2000);
    }, () => setError("The link could not be copied. Select it and copy it instead."));
  };

  const row = (key: "practice" | "autoplay" | "edit" | "review", label: string, hint: string) => links ? (
    <div className="space-y-1.5">
      <div className={FIELD_LABEL}>{label}</div>
      <div className="flex gap-2">
        <Input readOnly value={links[key]} aria-label={`${label} link`} onFocus={(event) => event.currentTarget.select()} className="font-mono text-xs" wrapperClassName="min-w-0 flex-1" />
        <Button onClick={() => copy(key, links[key])} leftIcon={copied === key ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}>
          {copied === key ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">{hint}</p>
    </div>
  ) : null;

  return <Modal open onClose={onClose} size="md">
    <Modal.Header title="Share as a link" description={title} />
    <Modal.Body className="space-y-5">
      {!links && !error ? <p role="status" className="text-sm text-slate-600 dark:text-slate-300">Making the link…</p> : null}
      {row("practice", "Try it", "Opens the tutorial on its stage; the learner does each step.")}
      {row("autoplay", "Watch", "Plays the steps for the viewer.")}
      {row("edit", "Edit a copy", "Opens Tutorial Studio and saves a copy the recipient can change. Their edits never affect yours.")}
      {environment.review && row("review", "Review", "Opens Try it with feedback tools: reviewers comment on steps, cards and controls as they go, then send the feedback back as a file for Tutorial Studio.")}
      {links ? <div className="space-y-1.5 text-xs text-slate-500 dark:text-slate-400">
        <p>Nothing is uploaded: the whole tutorial is inside the link ({links.practice.length.toLocaleString()} characters). Anyone with it can read the steps.</p>
        {links.practice.length > TUTORIAL_SHARE_SOFT_LIMIT ? <p className="text-amber-800 dark:text-amber-200">Long links can be cut off by some chat and email tools. If one arrives broken, share the tutorial as a file instead.</p> : null}
        {links.droppedMedia ? <p>Screenshots and recorded narration are not included in links — share the file for those.</p> : null}
      </div> : null}
      {error ? <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p> : null}
    </Modal.Body>
    <Modal.Footer>
      <Button onClick={onClose}>Close</Button>
    </Modal.Footer>
  </Modal>;
}

