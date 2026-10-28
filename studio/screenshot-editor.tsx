"use client";

import { useId, useRef, useState, type PointerEvent } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Modal } from "../ui/modal";
import type { TutorialScreenshot } from "../core/screenshot";
import { bakeTutorialScreenshot, originalTutorialScreenshot, screenshotRectangle,
  type ScreenshotAnnotation, type ScreenshotCrop, type ScreenshotPoint, type ScreenshotTool } from "./screenshot-editor-helpers";

type EditState = { annotations: ScreenshotAnnotation[]; crop?: ScreenshotCrop };
const TOOLS: { id: ScreenshotTool; label: string; description: string }[] = [
  { id: "arrow", label: "Arrow", description: "Drag from the arrow tail to the control it should point at." },
  { id: "text", label: "Text", description: "Write a label, then select where it starts on the image." },
  { id: "number", label: "Number", description: "Select a point to place the next numbered marker." },
  { id: "redact", label: "Redact", description: "Drag a rectangle to cover it with solid black pixels." },
  { id: "crop", label: "Crop", description: "Drag a rectangle to select the image area to keep." },
];

export function ScreenshotEditor({ screenshot, onSave, onClose }: {
  screenshot: TutorialScreenshot; onSave: (image: TutorialScreenshot) => void; onClose: () => void;
}) {
  const [base, setBase] = useState(screenshot);
  const [tool, setTool] = useState<ScreenshotTool>("arrow");
  const [edit, setEdit] = useState<EditState>({ annotations: [] });
  const [history, setHistory] = useState<EditState[]>([]);
  const [drag, setDrag] = useState<{ start: ScreenshotPoint; end: ScreenshotPoint } | null>(null);
  const dragRef = useRef<typeof drag>(null);
  const [text, setText] = useState("Look here");
  const [alt, setAlt] = useState(screenshot.alt);
  const [caption, setCaption] = useState(screenshot.caption ?? "");
  const [coordinates, setCoordinates] = useState({ x: 40, y: 40, width: 160, height: 100 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const markerId = useId().replace(/:/g, "");
  const scale = base.width / 1280;
  const fontSize = Math.max(16, Math.round(24 * scale));
  const stroke = Math.max(3, 4 * scale);

  const commit = (next: EditState) => {
    setHistory((current) => [...current, edit]); setEdit(next); setError("");
  };
  const add = (start: ScreenshotPoint, end: ScreenshotPoint) => {
    if (tool === "crop") {
      commit({ ...edit, crop: screenshotRectangle(start, end, base.width, base.height) });
    } else {
      let annotation: ScreenshotAnnotation;
      if (tool === "arrow") annotation = { kind: "arrow", start, end };
      else if (tool === "redact") annotation = { kind: "redact", rect: screenshotRectangle(start, end, base.width, base.height) };
      else if (tool === "text") {
        if (!text.trim()) { setError("Enter the text for this label."); return; }
        annotation = { kind: "text", start, text: text.trim() };
      } else annotation = { kind: "number", start, number: edit.annotations.filter((item) => item.kind === "number").length + 1 };
      commit({ ...edit, annotations: [...edit.annotations, annotation] });
    }
  };
  const point = (event: PointerEvent<SVGSVGElement>): ScreenshotPoint => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(base.width, (event.clientX - bounds.left) / bounds.width * base.width)),
      y: Math.max(0, Math.min(base.height, (event.clientY - bounds.top) / bounds.height * base.height)) };
  };
  const save = async () => {
    if (!alt.trim()) { setError("Enter an accessible description of the image."); return; }
    setBusy(true); setError("");
    try {
      const image = edit.annotations.length || edit.crop ? await bakeTutorialScreenshot(base, edit.annotations, edit.crop) : base;
      onSave({ ...image, alt: alt.trim(), caption: caption.trim() || undefined }); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The image could not be saved."); }
    finally { setBusy(false); }
  };
  const reset = () => {
    setBase(originalTutorialScreenshot(screenshot)); setEdit({ annotations: [] }); setHistory([]); setDrag(null); dragRef.current = null; setError("");
  };

  const preview = drag && (tool === "redact" || tool === "crop") ? screenshotRectangle(drag.start, drag.end, base.width, base.height) : null;
  return <Modal open onClose={onClose} busy={busy} size="xl">
    <Modal.Header title="Edit screenshot" description="Add labels and pointers, crop the view, or redact areas before exporting." />
    <Modal.Toolbar className="flex-wrap">
      <div role="group" aria-label="Screenshot tools" className="flex flex-wrap gap-1">
        {TOOLS.map((item) => <Button key={item.id} size="sm" variant={tool === item.id ? "primary" : "ghost"}
          aria-pressed={tool === item.id} disabled={busy} onClick={() => { setTool(item.id); setDrag(null); dragRef.current = null; }}>{item.label}</Button>)}
      </div>
      <Button size="sm" disabled={busy || !history.length} onClick={() => {
        setEdit(history[history.length - 1]); setHistory((current) => current.slice(0, -1));
      }}>Undo annotation</Button>
      <Button size="sm" disabled={busy} onClick={reset}>Reset original</Button>
    </Modal.Toolbar>
    <Modal.Body>
      <p className="mb-2 text-sm text-slate-600 dark:text-slate-400">{TOOLS.find((item) => item.id === tool)?.description}</p>
      {tool === "text" && <Input aria-label="Annotation text" value={text} maxLength={200} disabled={busy} onChange={(event) => setText(event.target.value)} className="mb-3" />}
      <div className="overflow-auto rounded-lg border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-950">
        <svg aria-label="Screenshot annotation preview" role="img" viewBox={`0 0 ${base.width} ${base.height}`}
          className="block h-auto w-full touch-none" style={{ cursor: "crosshair" }}
          onPointerDown={(event) => {
            if (busy || event.button !== 0) return;
            const start = point(event);
            if (tool === "text" || tool === "number") { add(start, start); return; }
            event.currentTarget.setPointerCapture(event.pointerId);
            dragRef.current = { start, end: start }; setDrag(dragRef.current);
          }}
          onPointerMove={(event) => {
            if (!dragRef.current) return;
            dragRef.current = { ...dragRef.current, end: point(event) }; setDrag(dragRef.current);
          }}
          onPointerUp={(event) => {
            if (!dragRef.current) return;
            const start = dragRef.current.start; const end = point(event);
            dragRef.current = null; setDrag(null);
            if (Math.hypot(end.x - start.x, end.y - start.y) >= 2) add(start, end);
          }}
          onPointerCancel={() => { dragRef.current = null; setDrag(null); }}>
          <title>{alt}</title>
          <defs><marker id={markerId} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#dc2626" /></marker></defs>
          <image href={base.dataUrl} width={base.width} height={base.height} />
          {edit.annotations.filter((annotation) => annotation.kind !== "redact").map((annotation, index) => {
            if (annotation.kind === "arrow") return <line key={index} x1={annotation.start.x} y1={annotation.start.y} x2={annotation.end.x} y2={annotation.end.y} stroke="#dc2626" strokeWidth={stroke} markerEnd={`url(#${markerId})`} />;
            if (annotation.kind === "text") return <text key={index} x={annotation.start.x} y={annotation.start.y} dominantBaseline="hanging" fontFamily="Arial, sans-serif" fontWeight="bold" fontSize={fontSize} fill="#dc2626" stroke="white" strokeWidth={Math.max(4, 5 * scale)} paintOrder="stroke">{annotation.text}</text>;
            if (annotation.kind === "number") return <g key={index}><circle cx={annotation.start.x} cy={annotation.start.y} r={Math.max(14, 19 * scale)} fill="#dc2626" /><text x={annotation.start.x} y={annotation.start.y} textAnchor="middle" dominantBaseline="central" fontFamily="Arial, sans-serif" fontSize={fontSize} fontWeight="bold" fill="white">{annotation.number}</text></g>;
            return null;
          })}
          {edit.annotations.filter((annotation) => annotation.kind === "redact").map((annotation, index) => <rect key={index} {...annotation.rect} fill="black" />)}
          {drag && tool === "arrow" && <line x1={drag.start.x} y1={drag.start.y} x2={drag.end.x} y2={drag.end.y} stroke="#dc2626" strokeWidth={stroke} markerEnd={`url(#${markerId})`} />}
          {preview && <rect {...preview} fill={tool === "redact" ? "black" : "none"} stroke="#2563eb" strokeWidth={stroke} strokeDasharray="10 5" />}
          {edit.crop && <>
            <rect x="0" y="0" width={base.width} height={edit.crop.y} fill="white" fillOpacity=".65" />
            <rect x="0" y={edit.crop.y + edit.crop.height} width={base.width} height={base.height - edit.crop.y - edit.crop.height} fill="white" fillOpacity=".65" />
            <rect x="0" y={edit.crop.y} width={edit.crop.x} height={edit.crop.height} fill="white" fillOpacity=".65" />
            <rect x={edit.crop.x + edit.crop.width} y={edit.crop.y} width={base.width - edit.crop.x - edit.crop.width} height={edit.crop.height} fill="white" fillOpacity=".65" />
            <rect {...edit.crop} fill="none" stroke="#2563eb" strokeWidth={stroke} />
          </>}
        </svg>
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer font-medium">Place with coordinates</summary>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          {(["x", "y", "width", "height"] as const).map((field) => <label key={field} className="w-24 text-xs">
            {field === "width" ? "Width / arrow Δx" : field === "height" ? "Height / arrow Δy" : field.toUpperCase()}
            <Input aria-label={`Annotation ${field}`} type="number" value={coordinates[field]} min={field === "x" || field === "y" ? 0 : 1}
              disabled={busy} onChange={(event) => setCoordinates((current) => ({ ...current, [field]: Number(event.target.value) }))} />
          </label>)}
          <Button size="sm" disabled={busy} onClick={() => {
            const start = { x: Math.min(base.width - 1, Math.max(0, coordinates.x)), y: Math.min(base.height - 1, Math.max(0, coordinates.y)) };
            add(start, { x: Math.min(base.width, start.x + Math.max(1, coordinates.width)), y: Math.min(base.height, start.y + Math.max(1, coordinates.height)) });
          }}>Add {tool === "crop" ? "crop" : "annotation"}</Button>
        </div>
      </details>
      <div className="mt-4 space-y-3">
        <label className="block text-sm font-medium">Accessible description<Input aria-label="Screenshot accessible description" value={alt} maxLength={500} disabled={busy} onChange={(event) => setAlt(event.target.value)} /></label>
        <label className="block text-sm font-medium">Caption (optional)<Input aria-label="Screenshot caption" value={caption} maxLength={500} disabled={busy} onChange={(event) => setCaption(event.target.value)} /></label>
        <p className="text-xs text-slate-500">Exports contain the edited image. The editable draft retains the original for Reset original.</p>
        {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
      </div>
    </Modal.Body>
    <Modal.Footer><Button disabled={busy} onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void save()}>Save screenshot</Button></Modal.Footer>
  </Modal>;
}

