export const TUTORIAL_HIGHLIGHT_STYLES = ["box", "arrow", "both"] as const;
export type TutorialHighlightStyle = (typeof TUTORIAL_HIGHLIGHT_STYLES)[number];
export const TUTORIAL_HIGHLIGHT_OPTIONS = [
  { value: "box", label: "Yellow box" },
  { value: "arrow", label: "Red arrow" },
  { value: "both", label: "Yellow box and red arrow" },
] as const;

/** Allocate within a step, including rapid clicks and deleted/re-added areas. */
export function nextTutorialHighlightId(items: readonly { id: string }[]): string {
  const ids = new Set(items.map((item) => item.id));
  let index = 1;
  while (ids.has(`focus-${index}`)) index += 1;
  return `focus-${index}`;
}

