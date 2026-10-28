"use client";

import { useRef, useState } from "react";
import { Camera, ImagePlus, Pencil, Trash } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Checkbox } from "../ui/checkbox";
import { CHECKBOX_ROW } from "../ui/control-styles";
import { screenshotIsStale, type TutorialScreenshot } from "../core/screenshot";
import { importTutorialScreenshot, originalTutorialScreenshot } from "./screenshot-editor-helpers";
import { ScreenshotEditor } from "./screenshot-editor";

export function StepScreenshot({ screenshot, screenshotMode, onScreenshotModeChange, onCapture, onCaptureStep, expectedFingerprint, onChange, disabled }: {
  screenshot?: TutorialScreenshot;
  screenshotMode?: "auto" | "none";
  onScreenshotModeChange: (mode: "auto" | "none" | undefined) => void;
  onCapture: () => Promise<void>;
  onCaptureStep?: () => Promise<void>;
  expectedFingerprint?: string;
  onChange: (screenshot: TutorialScreenshot | undefined) => void;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const run = async (operation: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try { await operation(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The interface could not be captured."); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const importImage = (file: Blob) => run(async () => {
    const image = await importTutorialScreenshot(file, screenshot?.alt ?? "Tutorial interface", expectedFingerprint);
    onChange(image);
  });
  const pasteImage = () => run(async () => {
    if (!navigator.clipboard?.read) throw new Error("Paste a PNG with ⌘V or Ctrl+V in the image area, or choose Import PNG.");
    const items = await navigator.clipboard.read();
    const item = items.find((entry) => entry.types.includes("image/png"));
    if (!item) throw new Error("The clipboard has no PNG image.");
    onChange(await importTutorialScreenshot(await item.getType("image/png"), screenshot?.alt ?? "Tutorial interface", expectedFingerprint));
  });
  const stale = screenshot ? screenshotIsStale(screenshot, expectedFingerprint) : false;
  return <div className="space-y-2 border-t border-slate-200 pt-3 dark:border-slate-700">
    <label className={CHECKBOX_ROW}><Checkbox checked={screenshotMode !== "none"} disabled={busy || disabled}
      onChange={(event) => onScreenshotModeChange(event.target.checked ? undefined : "none")} />Include screenshot for this step</label>
    {screenshotMode === "none" ? <p className="text-xs text-slate-500">This step exports as text only. Its actions still run before later screenshots are taken.</p> : <>
    <p className="text-xs text-slate-500">Capture this step to replay its actions first, or arrange the stage and capture the current interface. You can also import or paste a PNG. Use synthetic data.</p>
    <div className="flex flex-wrap gap-2">
      {onCaptureStep && <Button size="sm" onClick={() => void run(onCaptureStep)} disabled={disabled || busy} leftIcon={<Camera className="h-3.5 w-3.5" />}>Capture this step</Button>}
      <Button size="sm" onClick={() => void run(onCapture)} disabled={disabled || busy} leftIcon={<Camera className="h-3.5 w-3.5" />}>
        Capture current interface
      </Button>
      <Button size="sm" disabled={disabled || busy} onClick={() => fileRef.current?.click()} leftIcon={<ImagePlus className="h-3.5 w-3.5" />}>Import PNG</Button>
      <Button size="sm" disabled={disabled || busy} onClick={() => void pasteImage()}>Paste image</Button>
      <Input ref={fileRef} type="file" accept="image/png" aria-label="Import screenshot PNG" className="hidden" disabled={disabled || busy} onChange={(event) => {
        const file = event.target.files?.[0]; event.target.value = "";
        if (file) void importImage(file);
      }} />
      {screenshot && <Button size="sm" disabled={disabled || busy} onClick={() => setEditing(true)} leftIcon={<Pencil className="h-3.5 w-3.5" />}>Edit image</Button>}
      {screenshot?.sourceDataUrl && <Button size="sm" variant="ghost" disabled={disabled || busy} onClick={() => onChange(originalTutorialScreenshot(screenshot))}>Reset original</Button>}
      {screenshot && <Button size="sm" variant="ghost" disabled={busy || disabled} onClick={() => onChange(undefined)} leftIcon={<Trash className="h-3.5 w-3.5" />}>Remove screenshot</Button>}
    </div>
    <div tabIndex={disabled || busy ? -1 : 0} aria-label="Screenshot paste area" className="rounded-sm outline-offset-2 focus-visible:outline-2 focus-visible:outline-sky-500" onPaste={(event) => {
      if (busy || disabled) return;
      const file = Array.from(event.clipboardData.files).find((entry) => entry.type === "image/png");
      if (file) { event.preventDefault(); void importImage(file); }
    }}>
    {screenshot ? <>
      {/* Embedded authoring image; Next Image optimization is intentionally unnecessary. */}
      <img src={screenshot.dataUrl} alt={screenshot.alt} className="h-auto w-full rounded-sm border border-slate-200" />
      <Input aria-label="Screenshot description" value={screenshot.alt} maxLength={500} disabled={busy || disabled}
        onChange={(event) => onChange({ ...screenshot, alt: event.target.value || "Tutorial interface" })} />
      <Input aria-label="Screenshot caption" placeholder="Caption (optional)" value={screenshot.caption ?? ""} maxLength={500} disabled={busy || disabled}
        onChange={(event) => onChange({ ...screenshot, caption: event.target.value || undefined })} />
      <p className="text-xs text-slate-500">{screenshot.width} × {screenshot.height} · {screenshot.provenance?.engine === "native" ? "Browser pixels" : screenshot.provenance?.engine === "import" ? "Imported PNG" : screenshot.provenance?.engine === "dom" ? "Interface capture" : "Embedded PNG"}</p>
      {stale && <p role="status" className="text-xs text-amber-700 dark:text-amber-300">This screenshot was captured before this step or its earlier actions changed. Recapture it to show the current tutorial.</p>}
      {!screenshot.provenance && <p className="text-xs text-slate-500">Capture date unknown. Review this image before sharing.</p>}
      {screenshot.provenance && <label className={CHECKBOX_ROW}><Checkbox checked={Boolean(screenshot.provenance.reviewedAt)} disabled={disabled || busy || stale}
        onChange={(event) => onChange({ ...screenshot, provenance: { ...screenshot.provenance!, reviewedAt: event.target.checked ? new Date().toISOString() : undefined } })} />Image reviewed</label>}
    </> : <p className="py-2 text-xs text-slate-500">Focus here and paste a PNG with ⌘V or Ctrl+V.</p>}
    </div>
    {busy && <p role="status" className="text-xs text-slate-500">Preparing screenshot…</p>}
    {error && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{error}</p>}
    </>}
    {editing && screenshot && <ScreenshotEditor key={screenshot.dataUrl} screenshot={screenshot} onSave={onChange} onClose={() => setEditing(false)} />}
  </div>;
}

