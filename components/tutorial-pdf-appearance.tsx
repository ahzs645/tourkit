"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Checkbox } from "../ui/checkbox";
import { CHECKBOX_ROW, FIELD_LABEL } from "../ui/control-styles";
import { BuilderSelect } from "../ui/builder-select";
import type { TutorialExportOptions } from "../export/options";
import { readTutorialBrandLogo } from "../export/presets";
import { useTutorialStudioEnvironment } from "../studio/environment";

export function TutorialPdfAppearance({ options, onChange, disabled }: {
  options: TutorialExportOptions;
  onChange: (patch: Partial<TutorialExportOptions>) => void;
  disabled?: boolean;
}) {
  const { exportRuntime } = useTutorialStudioEnvironment();
  const alternateFontAvailable = Boolean(exportRuntime?.pdfFonts?.LiberationSans);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [accent, setAccent] = useState(options.branding.accent);
  const file = useRef<HTMLInputElement>(null);
  const latestOptions = useRef(options);
  useLayoutEffect(() => { latestOptions.current = options; }, [options]);
  useEffect(() => setAccent(options.branding.accent), [options.branding.accent]);
  const branding = (patch: Partial<TutorialExportOptions["branding"]>) => onChange({ branding: { ...latestOptions.current.branding, ...patch } });
  return <details className="border-t border-slate-200 pt-3 dark:border-slate-700">
    <summary className="cursor-pointer text-sm font-semibold">PDF branding and front matter</summary>
    <div className="mt-3 space-y-3">
      <label className={CHECKBOX_ROW}><Checkbox disabled={disabled} checked={options.includeCover}
        onChange={(event) => onChange({ includeCover: event.target.checked })} />Separate cover page</label>
      <label className={CHECKBOX_ROW}><Checkbox disabled={disabled} checked={options.includeTableOfContents}
        onChange={(event) => onChange({ includeTableOfContents: event.target.checked })} />Table of contents</label>
      <div className="space-y-1.5"><div className={FIELD_LABEL}>PDF font</div>
        <BuilderSelect aria-label="PDF font" value={options.pdfFont} disabled={disabled}
          options={[{ value: "Roboto", label: "Roboto" }, ...(alternateFontAvailable || options.pdfFont === "LiberationSans" ? [{ value: "LiberationSans", label: alternateFontAvailable ? "Liberation Sans" : "Liberation Sans (unavailable)" }] : [])]}
          onChange={(value) => onChange({ pdfFont: value as TutorialExportOptions["pdfFont"] })} />
      </div>
      {options.pdfFont === "LiberationSans" && !alternateFontAvailable && <p role="alert" className="text-xs text-amber-700 dark:text-amber-300">This application has no Liberation Sans assets. Choose Roboto before exporting.</p>}
      <label className="block space-y-1.5"><span className={FIELD_LABEL}>Accent colour</span>
        <Input aria-label="PDF accent colour" value={accent} maxLength={7} disabled={disabled} invalid={!/^#[\da-fA-F]{6}$/.test(accent)}
          onChange={(event) => { setAccent(event.target.value); if (/^#[\da-fA-F]{6}$/.test(event.target.value)) branding({ accent: event.target.value }); }} />
      </label>
      {!/^#[\da-fA-F]{6}$/.test(accent) && <p className="text-xs text-red-700">Use a six-digit colour such as #174cb6. The last valid colour is kept.</p>}
      {([['author', 'Author'], ['organization', 'Organization'], ['footer', 'Footer text']] as const).map(([key, label]) =>
        <label key={key} className="block space-y-1.5"><span className={FIELD_LABEL}>{label}</span>
          <Input aria-label={`PDF ${label.toLowerCase()}`} value={options.branding[key]} maxLength={key === "footer" ? 300 : 200} disabled={disabled}
            onChange={(event) => branding({ [key]: event.target.value })} />
        </label>)}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={disabled || loading} loading={loading} onClick={() => file.current?.click()}>{options.branding.logo ? "Replace PDF logo" : "Add PDF logo"}</Button>
        {options.branding.logo && <Button size="sm" variant="ghost" disabled={disabled || loading} onClick={() => branding({ logo: undefined })}>Remove PDF logo</Button>}
      </div>
      {options.branding.logo && <img src={options.branding.logo.dataUrl} alt="PDF logo preview" className="max-h-16 max-w-48 object-contain" />}
      <Input className="hidden" ref={file} type="file" accept="image/png" aria-label="Upload PDF logo" disabled={disabled || loading} onChange={async (event) => {
        const logo = event.target.files?.[0]; event.target.value = "";
        if (!logo) return;
        setLoading(true); setError("");
        try { branding({ logo: await readTutorialBrandLogo(logo) }); }
        catch (cause) { setError(cause instanceof Error ? cause.message : "The logo could not be loaded."); }
        finally { setLoading(false); }
      }} />
      <p className="text-xs text-slate-500">PNG logos are embedded in the PDF and saved presets. Font choices are embedded too, so the finished PDF needs no external assets.</p>
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
    </div>
  </details>;
}


