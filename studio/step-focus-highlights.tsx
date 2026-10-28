"use client";
import { useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { BuilderSelect } from "../ui/builder-select";
import type { TutorialFocusHighlight } from "../core/schema";
import { nextTutorialHighlightId, TUTORIAL_HIGHLIGHT_OPTIONS } from "../core/highlight";

export interface FocusPickRequest { kind: "element" | "area"; anchor?: string }
export function StepFocusHighlights({ highlights = [], defaultAnchor, onChange, onPick, picking = false }: {
  highlights?: TutorialFocusHighlight[]; defaultAnchor?: string;
  onChange: (items: TutorialFocusHighlight[] | undefined) => void;
  onPick?: (request: FocusPickRequest | null) => void; picking?: boolean;
}) {
  const [reference, setReference] = useState(defaultAnchor ?? "");
  const update = (index: number, patch: Partial<TutorialFocusHighlight>) => onChange(highlights.map((item, i) => i === index ? { ...item, ...patch } : item));
  return <fieldset className="space-y-2 rounded-md border border-slate-200 p-2 dark:border-slate-700">
    <legend className="px-1 text-xs font-semibold">Focus highlights ({highlights.length}/32)</legend>
    <p className="text-xs text-slate-500">Highlight several controls or draw areas inside a named window. These visual cues keep the step’s action and completion rules.</p>
    <div className="flex flex-wrap gap-1">
      {onPick && <Button size="sm" variant={picking ? "primary" : "ghost"} aria-pressed={picking}
        onClick={() => onPick(picking ? null : { kind: "element" })}>{picking ? "Done selecting highlights" : "Multi-select elements"}</Button>}
      <Button size="sm" variant="ghost" disabled={!reference.trim() || highlights.length >= 32} onClick={() => onChange([...highlights,
        { id: nextTutorialHighlightId(highlights), target: { kind: "element", anchor: reference.trim() }, style: "box", arrowFrom: "left" }])}>Add element by ID</Button>
    </div>
    <Input aria-label="Highlight window or area anchor" value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Window / area data-tutorial-id" />
    <div className="flex gap-1">
      {onPick && <Button size="sm" variant="ghost" disabled={!reference.trim() || highlights.length >= 32}
        onClick={() => onPick({ kind: "area", anchor: reference.trim() })}>Draw areas in this window</Button>}
      <Button size="sm" variant="ghost" disabled={!reference.trim() || highlights.length >= 32} onClick={() => onChange([...highlights,
        { id: nextTutorialHighlightId(highlights), target: { kind: "area", anchor: reference.trim(), rect: { x: .1, y: .1, width: .3, height: .15 } }, style: "box", arrowFrom: "left" }])}>Add relative area</Button>
    </div>
    {highlights.map((item, index) => <div key={item.id} className="space-y-1 rounded border border-slate-200 p-2 dark:border-slate-700">
      <div className="flex gap-1"><Input aria-label={`Highlight ${index + 1} anchor`} value={item.target.anchor}
        onChange={(event) => update(index, { target: { ...item.target, anchor: event.target.value } })} />
        <Button size="sm" variant="ghost" aria-label={`Remove highlight ${index + 1}`} onClick={() => onChange(highlights.length === 1 ? undefined : highlights.filter((_, i) => i !== index))}>Remove</Button></div>
      <Input aria-label={`Highlight ${index + 1} label`} placeholder="Optional description" value={item.label ?? ""} onChange={(event) => update(index, { label: event.target.value || undefined })} />
      <div className="grid grid-cols-2 gap-1"><BuilderSelect aria-label={`Highlight ${index + 1} style`} value={item.style} options={TUTORIAL_HIGHLIGHT_OPTIONS}
        onChange={(style) => update(index, { style: style as TutorialFocusHighlight["style"] })} />
        <BuilderSelect aria-label={`Highlight ${index + 1} arrow direction`} value={item.arrowFrom}
          options={["left", "right", "top", "bottom"].map((value) => ({ value, label: `Arrow from ${value}` }))}
          onChange={(arrowFrom) => update(index, { arrowFrom: arrowFrom as TutorialFocusHighlight["arrowFrom"] })} /></div>
      {item.target.kind === "area" && <div className="grid grid-cols-4 gap-1">{(["x", "y", "width", "height"] as const).map((key) => <label key={key} className="text-[10px]">{key} %
        <Input type="number" min={key === "width" || key === "height" ? .1 : 0} max={100} step={.1} aria-label={`Highlight ${index + 1} ${key} percent`}
          value={Math.round((item.target.kind === "area" ? item.target.rect[key] : 0) * 1000) / 10} onChange={(event) => {
            if (item.target.kind !== "area") return;
            const value = Number(event.target.value) / 100; if (!Number.isFinite(value)) return;
            const rect = { ...item.target.rect, [key]: Math.max(key === "width" || key === "height" ? .001 : 0, Math.min(1, value)) };
            rect.width = Math.min(rect.width, 1 - rect.x); rect.height = Math.min(rect.height, 1 - rect.y);
            if (rect.width > 0 && rect.height > 0) update(index, { target: { ...item.target, rect } });
          }} /></label>)}</div>}
    </div>)}
  </fieldset>;
}

