"use client";

import type { ReactNode } from "react";
import { useTutorialStudioEnvironment } from "../studio/environment";
import { TutorialPdfAppearance } from "./tutorial-pdf-appearance";
import { TutorialExportPresets } from "./tutorial-export-presets";
import { BuilderSelect } from "../ui/builder-select";
import { Checkbox } from "../ui/checkbox";
import { CHECKBOX_ROW, CONTROL_FOCUS, FIELD_LABEL } from "../ui/control-styles";
import { cn } from "../shared/cn";
import { TUTORIAL_EXPORT_FORMATS, TUTORIAL_EXPORT_GROUPS, tutorialExportFormat, type TutorialExportFormat } from "../export";
import type { TutorialExportOptions } from "../export/options";
import { TUTORIAL_HIGHLIGHT_OPTIONS, type TutorialHighlightStyle } from "../core/highlight";

const FRAMING_OPTIONS = [
  { value: "step", label: "Zoom to each step", description: "Crops to the highlighted control and the interface around it." },
  { value: "screen", label: "Whole screen", description: "The full interface, scaled to fit the page." },
];

/**
 * Format tiles grouped by purpose, then only the settings the chosen format
 * uses. Callers add their own notes (screenshot counts, availability).
 */
export function TutorialExportSettings({ format, onFormatChange, options, onOptionsChange, disabled, unavailable, screenshotNote, children }: {
  format: TutorialExportFormat;
  onFormatChange: (format: TutorialExportFormat) => void;
  options: TutorialExportOptions;
  onOptionsChange: (patch: Partial<TutorialExportOptions>) => void;
  disabled?: boolean;
  /** Why the chosen format cannot export this selection, if it cannot. */
  unavailable?: string | null;
  /** Shown under the screenshot settings of guide formats. */
  screenshotNote?: ReactNode;
  children?: ReactNode;
}) {
  const environment = useTutorialStudioEnvironment();
  const entry = tutorialExportFormat(format);
  return <div className="space-y-5">
    <div role="group" aria-label="Export format" className="@container space-y-3">
      {TUTORIAL_EXPORT_GROUPS.map((group) => (
        <div key={group.id}>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{group.label}</div>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5 @md:grid-cols-3">
            {TUTORIAL_EXPORT_FORMATS.filter((item) => item.group === group.id).map((item) => {
              const selected = item.id === format;
              return <button key={item.id} type="button" aria-pressed={selected} disabled={disabled}
                onClick={() => onFormatChange(item.id)}
                className={cn(CONTROL_FOCUS, "flex min-w-0 flex-col rounded-lg border px-3 py-1.5 text-left text-sm transition-colors disabled:opacity-60",
                  selected
                    ? "border-sky-500 bg-sky-50 font-semibold text-sky-900 ring-1 ring-sky-500 dark:border-sky-400 dark:bg-sky-500/15 dark:text-sky-100 dark:ring-sky-400"
                    : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800")}>
                <span className="truncate">{item.label}</span>
                <span className="truncate text-[11px] font-normal text-slate-500 dark:text-slate-400">{item.extension}</span>
              </button>;
            })}
          </div>
        </div>
      ))}
    </div>

    <p className="text-sm text-slate-700 dark:text-slate-200">{entry.description}</p>
    {unavailable ? <p className="text-sm text-amber-800 dark:text-amber-200">{unavailable}</p> : null}

    {entry.reading ? <div className="space-y-3">
      <label className={CHECKBOX_ROW}><Checkbox checked={options.includeScreenshots} disabled={disabled}
        onChange={(event) => onOptionsChange({ includeScreenshots: event.target.checked })} />Include screenshots</label>
      {options.includeScreenshots ? <div className="space-y-1.5 pl-6">
        <div className={FIELD_LABEL}>Screenshot framing</div>
        <BuilderSelect aria-label="Screenshot framing" value={options.screenshotFraming} disabled={disabled} options={FRAMING_OPTIONS}
          onChange={(value) => onOptionsChange({ screenshotFraming: value as TutorialExportOptions["screenshotFraming"] })} />
        {screenshotNote ? <p className="text-xs text-slate-500 dark:text-slate-400">{screenshotNote}</p> : null}
      </div> : null}
      <label className={CHECKBOX_ROW}><Checkbox checked={options.includeOutcomes} disabled={disabled}
        onChange={(event) => onOptionsChange({ includeOutcomes: event.target.checked })} />Include completion hints</label>
      <label className={CHECKBOX_ROW}><Checkbox checked={options.includeTranscripts} disabled={disabled}
        onChange={(event) => onOptionsChange({ includeTranscripts: event.target.checked })} />Include narration transcripts</label>
      {format === "pdf" || format === "docx" ? <div className="space-y-1.5"><div className={FIELD_LABEL}>Paper size</div>
        <BuilderSelect aria-label="Paper size" value={options.paperSize} disabled={disabled}
          options={[{ value: "A4", label: "A4" }, { value: "LETTER", label: "US Letter" }]}
          onChange={(value) => onOptionsChange({ paperSize: value as TutorialExportOptions["paperSize"] })} /></div> : null}
      {format === "pdf" ? <div className="space-y-3 border-t border-slate-200 pt-3 dark:border-slate-700">
        <div className="space-y-1.5">
          <div className={FIELD_LABEL}>PDF style</div>
          <BuilderSelect aria-label="PDF style" value={options.pdfTemplate} disabled={disabled}
            options={[
              { value: "guide", label: "Reading guide", description: "Portrait pages with roomy headings and screenshots." },
              { value: "compact", label: "Compact handout", description: "Smaller type and spacing to use fewer pages." },
              { value: "presentation", label: "Landscape slides", description: "A new landscape page for each step." },
            ]}
            onChange={(value) => onOptionsChange({ pdfTemplate: value as TutorialExportOptions["pdfTemplate"] })} />
        </div>
        <label className={CHECKBOX_ROW}><Checkbox checked={options.newPagePerChapter} disabled={disabled || options.pdfTemplate === "presentation"}
          onChange={(event) => onOptionsChange({ newPagePerChapter: event.target.checked })} />Start each section on a new page</label>
        <label className={CHECKBOX_ROW}><Checkbox checked={options.newPagePerScreenshot} disabled={disabled || !options.includeScreenshots || options.pdfTemplate === "presentation"}
          onChange={(event) => onOptionsChange({ newPagePerScreenshot: event.target.checked })} />Start steps with screenshots on a new page</label>
        <TutorialPdfAppearance options={options} onChange={onOptionsChange} disabled={disabled} />
        <p className="text-xs text-slate-500 dark:text-slate-400">Short steps stay with their images. Long steps can continue onto another page. Text-only steps use the same style.</p>
      </div> : null}
      {format === "markdown" && options.includeScreenshots ? <p className="text-xs text-slate-500 dark:text-slate-400">Markdown embeds images as data URLs. Some Markdown viewers block them; HTML works offline in a browser.</p> : null}
      <TutorialExportPresets options={options} onChange={onOptionsChange} disabled={disabled} />
      <p className="text-xs text-slate-500 dark:text-slate-400">Recorded audio and live practice are not included.</p>
    </div> : null}

    {format === "interactive-html" && !unavailable ? <div className="space-y-1.5">
      <p className="text-sm text-slate-500 dark:text-slate-400">{environment.interactiveExportDescription}</p>
      <div className={FIELD_LABEL}>Highlight style</div>
      <BuilderSelect aria-label="Highlight style" value={options.highlightStyle} disabled={disabled} options={TUTORIAL_HIGHLIGHT_OPTIONS}
        onChange={(value) => onOptionsChange({ highlightStyle: value as TutorialHighlightStyle })} />
      <p className="text-xs text-slate-500 dark:text-slate-400">The arrow points toward the control and follows it as the interface changes. Viewers can change this on the tutorial’s opening screen.</p>
    </div> : null}
    {children}
  </div>;
}

