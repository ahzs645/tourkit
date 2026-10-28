import { useState } from "react";
import { BuilderSelect } from "../ui/builder-select";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import type { TutorialSetup } from "../core/schema";
import { TUTORIAL_SETUP_KINDS } from "../components/tutorial-setup";

const lines = (value: string) => value.split("\n").map((line) => line.trim()).filter(Boolean);

function SetupListEditor({ label, value, onChange, comma = false }: { label: string; value: string[]; onChange: (value: string[]) => void; comma?: boolean }) {
  const serialized = value.join(comma ? ", " : "\n");
  const [draft, setDraft] = useState({ source: serialized, text: serialized });
  if (draft.source !== serialized) setDraft({ source: serialized, text: serialized });
  const text = draft.source === serialized ? draft.text : serialized;
  const props = { "aria-label": label, value: text, onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft({ source: serialized, text: event.target.value }), onBlur: () => onChange(comma ? text.split(",").map((line) => line.trim()).filter(Boolean) : lines(text)) };
  return comma ? <Input {...props} /> : <Textarea {...props} />;
}

export function LessonSetupEditor({ setup, onChange }: { setup?: TutorialSetup; onChange: (value: TutorialSetup | undefined) => void }) {
  if (!setup) return <Button size="sm" variant="secondary" onClick={() => onChange({ kind: "overview", goal: "Review the illustrated workflow.", audience: [], access: [], startingScreen: "Prepared tutorial fixture", sources: [], limitations: [] })}>Add lesson setup</Button>;
  const update = (patch: Partial<TutorialSetup>) => onChange({ ...setup, ...patch });
  const sourceUpdate = (index: number, patch: Partial<TutorialSetup["sources"][number]>) => update({ sources: setup.sources.map((source, i) => i === index ? { ...source, ...patch } : source) });
  return (
    <fieldset className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <legend className="px-1 text-xs font-semibold">Lesson setup</legend>
      <label className="block text-xs">Lesson type<BuilderSelect aria-label="Lesson type" value={setup.kind} onChange={(kind) => update({ kind: kind as TutorialSetup["kind"] })} options={Object.entries(TUTORIAL_SETUP_KINDS).map(([value, label]) => ({ value, label }))} /></label>
      <label className="block text-xs">Goal<Textarea aria-label="Lesson goal" value={setup.goal} onChange={(event) => update({ goal: event.target.value })} /></label>
      <label className="block text-xs">Learner roles (one per line)<SetupListEditor label="Learner roles" value={setup.audience} onChange={(audience) => update({ audience })} /></label>
      <label className="block text-xs">Access and preparation (one per line)<SetupListEditor label="Lesson access and preparation" value={setup.access} onChange={(access) => update({ access })} /></label>
      <label className="block text-xs">Starting screen<Input aria-label="Lesson starting screen" value={setup.startingScreen} onChange={(event) => update({ startingScreen: event.target.value })} /></label>
      <label className="block text-xs">Training date<Input type="date" aria-label="Lesson training date" value={setup.scenarioDate ?? ""} onChange={(event) => update({ scenarioDate: event.target.value || undefined })} /></label>
      <label className="block text-xs">Interface version<Input aria-label="Lesson interface version" value={setup.applicationVersion ?? ""} onChange={(event) => update({ applicationVersion: event.target.value || undefined })} /></label>
      <label className="block text-xs">Completion and simulator limits (one per line)<SetupListEditor label="Lesson completion limits" value={setup.limitations} onChange={(limitations) => update({ limitations })} /></label>
      {setup.sources.map((source, index) => <fieldset key={index} className="space-y-2 rounded border border-slate-200 p-2 dark:border-slate-700">
        <legend className="text-xs">Reference {index + 1}</legend>
        <Input aria-label={`Reference ${index + 1} title`} value={source.title} onChange={(event) => sourceUpdate(index, { title: event.target.value })} />
        <Input aria-label={`Reference ${index + 1} version`} value={source.version} onChange={(event) => sourceUpdate(index, { version: event.target.value })} />
        <SetupListEditor label={`Reference ${index + 1} article IDs`} value={source.articleIds} comma onChange={(articleIds) => sourceUpdate(index, { articleIds })} />
        <Input type="date" aria-label={`Reference ${index + 1} capture date`} value={source.capturedAt ?? ""} onChange={(event) => sourceUpdate(index, { capturedAt: event.target.value || undefined })} />
        <Button size="sm" variant="secondary" onClick={() => update({ sources: setup.sources.filter((_, i) => i !== index) })}>Remove reference {index + 1}</Button>
      </fieldset>)}
      <Button size="sm" variant="secondary" onClick={() => update({ sources: [...setup.sources, { title: "Reference", version: "Unspecified", articleIds: [] }] })}>Add reference</Button>
      <Button size="sm" variant="secondary" onClick={() => onChange(undefined)}>Remove lesson setup</Button>
    </fieldset>
  );
}

