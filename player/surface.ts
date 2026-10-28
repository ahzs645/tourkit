/**
 * Shared look for every tutorial surface — the step card inside driver's
 * popover and the standalone player cards (paused, resume prompt). Colors are
 * CSS variables so the surfaces follow the app's class-based dark mode; inline
 * styles reference the variables instead of hard-coding light values.
 */
export const TUTORIAL_SURFACE_CLASS = "tourkit-surface";

/**
 * Spread onto every tutorial card root. Besides the shared styling class, the
 * data attribute is the contract dialog focus traps use (see
 * components/ui/dialog-shell.tsx) to include the card's controls in their Tab
 * cycle — without it, keyboard users cannot reach the tutorial while a modal
 * is open.
 */
export const TUTORIAL_SURFACE_PROPS = {
  className: TUTORIAL_SURFACE_CLASS,
  "data-tutorial-surface": "",
} as const;

export const TUTORIAL_SURFACE_CSS = `
.tourkit-popover, .${TUTORIAL_SURFACE_CLASS} {
  --tourkit-bg: #ffffff;
  --tourkit-ink: #0f172a;
  --tourkit-ink-2: #334155;
  --tourkit-ink-3: #64748b;
  --tourkit-line: #cbd5e1;
  --tourkit-line-soft: #e2e8f0;
  --tourkit-track: #e2e8f0;
}
.dark .tourkit-popover, .dark .${TUTORIAL_SURFACE_CLASS} {
  --tourkit-bg: #0f172a;
  --tourkit-ink: #e2e8f0;
  --tourkit-ink-2: #cbd5e1;
  --tourkit-ink-3: #94a3b8;
  --tourkit-line: #475569;
  --tourkit-line-soft: #334155;
  --tourkit-track: #1e293b;
}
`;

