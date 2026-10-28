"use client";

import { useEffect, useRef, useState } from "react";
import { BuilderSelect } from "../ui/builder-select";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { FIELD_LABEL } from "../ui/control-styles";
import { downloadTutorialFile } from "../export";
import type { TutorialExportOptions } from "../export/options";
import { DEFAULT_TUTORIAL_EXPORT_PRESETS, type TutorialExportPreset } from "../export/presets";
import { useTutorialStudioEnvironment } from "../studio/environment";
import { tutorialFilename } from "../export/document";

export function TutorialExportPresets({ options, onChange, disabled }: {
  options: TutorialExportOptions;
  onChange: (options: TutorialExportOptions) => void;
  disabled?: boolean;
}) {
  const environment = useTutorialStudioEnvironment();
  const { makeTutorialExportPreset, parseTutorialExportPreset, readTutorialExportPresets, saveTutorialExportPresets, serializeTutorialExportPreset } = environment.exportPresets ?? DEFAULT_TUTORIAL_EXPORT_PRESETS;
  const [presets, setPresets] = useState<TutorialExportPreset[]>([]);
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => setPresets(readTutorialExportPresets()), [readTutorialExportPresets]);
  const persist = (next: TutorialExportPreset[]) => { saveTutorialExportPresets(next); setPresets(next); };
  const save = () => {
    setError(""); setMessage("");
    try {
      const existing = presets.find((preset) => preset.id === selected);
      const preset = makeTutorialExportPreset(name, options);
      if (existing && existing.name === name.trim()) preset.id = existing.id;
      persist([...presets.filter((item) => item.id !== preset.id), preset]);
      setSelected(preset.id); setMessage(`Saved ${preset.name}.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The preset could not be saved."); }
  };
  return <details className="border-t border-slate-200 pt-3 dark:border-slate-700">
    <summary className="cursor-pointer text-sm font-semibold">Reusable export presets</summary>
    <div className="mt-3 space-y-3">
      <div className={FIELD_LABEL}>Saved preset</div>
      <BuilderSelect aria-label="Saved export preset" value={selected} disabled={disabled}
        options={[{ value: "", label: "Current settings" }, ...presets.map((preset) => ({ value: preset.id, label: preset.name }))]}
        onChange={(id) => {
          setSelected(id); setError(""); setMessage("");
          const preset = presets.find((item) => item.id === id);
          if (preset) { setName(preset.name); onChange(preset.options); }
        }} />
      <p className="text-xs text-slate-500">Presets remember reading settings and PDF appearance, including an embedded logo. They do not change the tutorial.</p>
      <label className="block space-y-1.5"><span className={FIELD_LABEL}>Preset name</span>
        <Input aria-label="Export preset name" value={name} maxLength={80} disabled={disabled} onChange={(event) => setName(event.target.value)} />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={disabled || !name.trim()} onClick={save}>Save preset</Button>
        <Button size="sm" disabled={disabled || !name.trim()} onClick={() => {
          const preset = makeTutorialExportPreset(name, options);
          downloadTutorialFile(new Blob([serializeTutorialExportPreset(preset)], { type: "application/json" }), `${tutorialFilename(preset.name)}.tutorial-export-preset.json`);
        }}>Export preset</Button>
        <Button size="sm" disabled={disabled} onClick={() => file.current?.click()}>Import preset</Button>
        {selected && <Button size="sm" variant="ghost" disabled={disabled} onClick={() => {
          try { persist(presets.filter((preset) => preset.id !== selected)); setSelected(""); setMessage("Preset removed. Current settings are kept."); setError(""); }
          catch (cause) { setError(cause instanceof Error ? cause.message : "The preset could not be removed."); }
        }}>Delete preset</Button>}
      </div>
      <Input ref={file} className="hidden" type="file" accept=".json,application/json" aria-label="Import export preset file" disabled={disabled}
        onChange={async (event) => {
          const upload = event.target.files?.[0]; event.target.value = "";
          if (!upload) return;
          setError(""); setMessage("");
          try {
            if (upload.size > 9_000_000) throw new Error("This export preset is too large.");
            const imported = parseTutorialExportPreset(await upload.text());
            const preset = { ...imported, id: crypto.randomUUID() };
            persist([...presets, preset]); setSelected(preset.id); setName(preset.name); onChange(preset.options);
            setMessage(`Imported ${preset.name}.`);
          } catch (cause) { setError(cause instanceof Error ? cause.message : "The preset could not be imported."); }
        }} />
      {message && <p className="text-xs text-slate-500">{message}</p>}
      {error && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{error}</p>}
    </div>
  </details>;
}

