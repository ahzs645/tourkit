// Shared authoring controls. Dense editors use sm; ordinary forms use md.
// Keep multiline controls flexible by applying CONTROL_HEIGHTS only to single-line controls.
export const CONTROL_FOCUS =
  "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900";

export const CONTROL_BASE =
  "w-full border bg-white text-slate-900 transition-colors " +
  "placeholder:text-slate-400 focus:outline-hidden focus:ring-2 " +
  "disabled:cursor-not-allowed disabled:opacity-50 " +
  "dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500";

export const CONTROL_DEFAULT =
  "border-slate-300 hover:enabled:border-slate-400 focus:border-brand-500 focus:ring-brand-500/20 " +
  "dark:border-slate-600 dark:hover:enabled:border-slate-500 dark:focus:border-brand-400 dark:focus:ring-brand-400/25";

export const CONTROL_ERROR =
  "border-danger-500 focus:border-danger-500 focus:ring-danger-500/20 " +
  "dark:border-danger-400 dark:focus:border-danger-400 dark:focus:ring-danger-400/25";

export const CONTROL_SIZES = {
  sm: "rounded-lg px-2.5 py-1 text-sm leading-5",
  md: "rounded-lg px-3 py-1.5 text-sm leading-5"
} as const;

export const CONTROL_HEIGHTS = { sm: "h-8", md: "h-9" } as const;
export type ControlSize = keyof typeof CONTROL_SIZES;

export const FIELD_LABEL = "block text-xs font-medium text-slate-700 dark:text-slate-200";
export const CHECKBOX_ROW =
  "flex min-h-8 cursor-pointer items-center gap-2 rounded-lg py-1 text-sm font-normal text-slate-700 dark:text-slate-200 has-disabled:cursor-not-allowed has-disabled:text-slate-400 dark:has-disabled:text-slate-500";
export const PANEL_SURFACE =
  "rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900";
export const MENU_SURFACE =
  "rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900";
export const MENU_ITEM =
  "flex min-h-9 w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:enabled:bg-slate-100 focus-visible:bg-brand-50 focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-200 dark:hover:enabled:bg-slate-800 dark:focus-visible:bg-brand-500/15";

