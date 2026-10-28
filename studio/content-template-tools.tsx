"use client";

import { useEffect, useRef, useState } from "react";
import { BuilderSelect } from "../ui/builder-select";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { downloadTutorialFile } from "../export";
import { parseTutorialContentTemplates, defaultTutorialContentTemplateStore, serializeTutorialContentTemplates,
  type TutorialContentTemplate } from "../recording/content-blocks";
import { useTutorialStudioEnvironment } from "./environment";
import type { TutorialRecordingStep } from "../recording/types";

export function ContentTemplateTools({ step, onChange }: {
  step: TutorialRecordingStep;
  onChange: (patch: Partial<Omit<TutorialRecordingStep, "id">>) => void;
}) {
  const { contentTemplates = defaultTutorialContentTemplateStore } = useTutorialStudioEnvironment();
  const [templates, setTemplates] = useState<TutorialContentTemplate[]>([]);
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const file = useRef<HTMLInputElement>(null);
  // Browser-only storage is read after hydration so server and client initially render the same controls.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setTemplates(contentTemplates.read()), [contentTemplates]);
  const store = (next: TutorialContentTemplate[]) => {
    try { contentTemplates.save(next); setTemplates(next); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save blocks in this browser."); }
  };
  return <details className="rounded-lg border border-slate-200 p-2 dark:border-slate-700">
    <summary className="cursor-pointer text-xs font-semibold">Reusable text blocks</summary>
    <div className="mt-2 space-y-2">
      <p className="text-xs text-slate-500">Save titles and instructions for other tutorials. Applying a block keeps this step’s action, image, and narration.</p>
      {templates.length > 0 && <div className="flex gap-2">
        <BuilderSelect aria-label="Saved text block" value={selected} onChange={setSelected}
          options={[{ value: "", label: "Choose a saved block" }, ...templates.map((template) => ({ value: template.id, label: template.name }))]} />
        <Button size="sm" disabled={!selected} onClick={() => {
          const template = templates.find((item) => item.id === selected);
          if (!template) return;
          onChange({ contentKind: template.contentKind, title: template.title, instruction: template.instruction,
            pageBreakBefore: template.pageBreakBefore,
            ...(!step.action && !step.check && template.contentKind !== "action" && !step.screenshot ? { screenshotMode: "none" as const } : {}) });
        }}>Apply block</Button>
        <Button size="sm" variant="ghost" disabled={!selected} onClick={() => {
          store(templates.filter((item) => item.id !== selected)); setSelected("");
        }}>Delete block</Button>
      </div>}
      <div className="flex gap-2">
        <Input aria-label="Text block name" placeholder="Name this reusable block" value={name} maxLength={100} onChange={(event) => setName(event.target.value)} />
        <Button size="sm" disabled={!name.trim() || templates.length >= 100} onClick={() => {
          store([...templates, { id: crypto.randomUUID(), name: name.trim(), contentKind: step.contentKind ?? "action",
            title: step.title, instruction: step.instruction, pageBreakBefore: step.pageBreakBefore }]); setName("");
        }}>Save block</Button>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="ghost" disabled={!templates.length} onClick={() => downloadTutorialFile(
          new Blob([serializeTutorialContentTemplates(templates)], { type: "application/json" }), "tutorial-text-blocks.json")}>Export blocks</Button>
        <Button size="sm" variant="ghost" onClick={() => file.current?.click()}>Import blocks</Button>
        <input ref={file} type="file" accept="application/json,.json" hidden aria-label="Import text blocks file" onChange={async (event) => {
          const input = event.target.files?.[0]; event.target.value = "";
          if (!input) return;
          try {
            if (input.size > 1_000_000) throw new Error("Text block files must be smaller than 1 MB.");
            const imported = parseTutorialContentTemplates(await input.text());
            const next = new Map(templates.map((template) => [template.id, template]));
            imported.forEach((template) => next.set(template.id, template));
            store([...next.values()]);
          } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not import text blocks."); }
        }} />
      </div>
      {error && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{error}</p>}
    </div>
  </details>;
}


