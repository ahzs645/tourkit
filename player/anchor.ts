import { DEFAULT_TUTORIAL_DOM_POLICY, SEMANTIC_APPLICATION_DIALOG_SELECTOR, type TutorialDomPolicy } from "./dom-policy";

const ANCHOR_ATTRIBUTE = "data-tutorial-id";
const ANCHOR_ALIASES_ATTRIBUTE = "data-tutorial-aliases";

function matchesAnchor(element: HTMLElement, anchorId: string): boolean {
  if (element.getAttribute(ANCHOR_ATTRIBUTE) === anchorId) return true;
  return (element.getAttribute(ANCHOR_ALIASES_ATTRIBUTE) ?? "")
    .split(/\s+/)
    .includes(anchorId);
}

/** Uses exact attribute comparison so unusual IDs never become unsafe CSS selectors. */
export function findTutorialAnchor(document: Document, anchorId: string, domPolicy: TutorialDomPolicy = DEFAULT_TUTORIAL_DOM_POLICY): HTMLElement | null {
  const candidates = document.querySelectorAll<HTMLElement>(
    `[${ANCHOR_ATTRIBUTE}], [${ANCHOR_ALIASES_ATTRIBUTE}]`,
  );
  const matches = Array.from(candidates).filter((candidate) => matchesAnchor(candidate, anchorId)
    && !candidate.closest('[hidden], [aria-hidden="true"], [inert]')
    && document.defaultView?.getComputedStyle(candidate).display !== "none"
    && document.defaultView?.getComputedStyle(candidate).visibility !== "hidden");
  const laidOut = matches.filter((candidate) => candidate.getClientRects().length > 0);
  const available = laidOut.length ? laidOut : matches; // Unit-test DOMs have no layout.
  const dialog = topmostApplicationDialog(document, { domPolicy });
  const inDialog = dialog ? available.filter((candidate) => dialog.contains(candidate)) : [];
  const scoped = inDialog.length ? inDialog : available;
  // Never silently select the first of two live controls sharing an id.
  return scoped.length === 1 ? scoped[0] : null;
}

/**
 * The list a ringed control has dropped, if it has one open: the control (or
 * a control inside the ringed element) says so the accessible way, with
 * `aria-expanded="true"` and `aria-controls` naming the list. A drop-down's
 * list is a popup of its own, drawn outside the control's box — without this
 * the ring and the spotlight stay on the closed field while the learner picks
 * from a list the overlay has dimmed.
 */
export function openListOf(element: HTMLElement): HTMLElement | null {
  // An anchorless step's "anchor" is the page itself: searching it would pick
  // up any expanded list anywhere — a palette section behind an open modal.
  if (element === element.ownerDocument.body) return null;
  /* The element itself and everything inside it: driver.js stamps the
     element it spotlights with aria-expanded / aria-controls for a popover
     this player never opens, so an id that names nothing is skipped rather
     than taken as the answer. */
  const controls = [
    ...(element.matches('[aria-expanded="true"][aria-controls]') ? [element] : []),
    ...Array.from(element.querySelectorAll<HTMLElement>('[aria-expanded="true"][aria-controls]')),
  ];
  for (const control of controls) {
    for (const id of (control.getAttribute("aria-controls") ?? "").split(/\s+/)) {
      const list = id ? element.ownerDocument.getElementById(id) : null;
      // A list inside the element is already inside its box (the Palette's
      // always-open search results): handing the spotlight to it would only
      // shrink it and dim the rest of the region.
      if (list?.isConnected && !element.contains(list)) return list;
    }
  }
  return null;
}

/**
 * What a step's ring marks: its target when it names one, else its anchor —
 * and in either case the list that control has open, while it is open.
 */
export function resolveRingElement(anchor: HTMLElement, targetId: string | null | undefined, domPolicy: TutorialDomPolicy = DEFAULT_TUTORIAL_DOM_POLICY): HTMLElement {
  const base = (targetId ? findTutorialAnchor(anchor.ownerDocument, targetId, domPolicy) : null) ?? anchor;
  return openListOf(base) ?? visibleBoxOf(base);
}

/**
 * The box a learner sees for `element`. A styled checkbox or radio keeps its
 * real <input> — which is what an anchor has to sit on, because replay clicks
 * the anchored element — at 0 × 0 under a painted box, and a ring around
 * nothing is no ring at all. Its label is what shows, and what a click on
 * toggles. Anything with a size of its own is returned as it is; so is
 * everything in a layout-free DOM, where every box measures 0 × 0.
 */
export function visibleBoxOf(element: HTMLElement): HTMLElement {
  const rect = element.getBoundingClientRect();
  if (rect.width >= 2 && rect.height >= 2) return element;
  const label = element instanceof HTMLInputElement ? element.labels?.[0] ?? element.closest("label") : null;
  if (!label) return element;
  const box = label.getBoundingClientRect();
  return box.width >= 2 && box.height >= 2 ? label : element;
}

export interface WaitForTutorialAnchorOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  domPolicy?: TutorialDomPolicy;
}

/**
 * MutationObserver is the primary signal, but not a complete one: it cannot
 * see into shadow roots, and some DOM environments (happy-dom among them)
 * drop mutation records under load. A slow re-resolve sweep backstops both,
 * so an anchor appearing or disappearing is never missed outright.
 */
const ANCHOR_SWEEP_MS = 500;

export function waitForTutorialAnchor(
  document: Document,
  anchorId: string,
  { timeoutMs = 5_000, signal, domPolicy = DEFAULT_TUTORIAL_DOM_POLICY }: WaitForTutorialAnchorOptions = {}
): Promise<HTMLElement> {
  const existing = findTutorialAnchor(document, anchorId, domPolicy);
  if (existing) return Promise.resolve(existing);
  if (signal?.aborted) return Promise.reject(new DOMException("Tutorial step cancelled", "AbortError"));

  return new Promise((resolve, reject) => {
    const settle = () => {
      const anchor = findTutorialAnchor(document, anchorId, domPolicy);
      if (!anchor) return;
      cleanup();
      resolve(anchor);
    };
    const observer = new MutationObserver(settle);
    const sweep = setInterval(settle, ANCHOR_SWEEP_MS);

    const cleanup = () => {
      observer.disconnect();
      clearInterval(sweep);
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException("Tutorial step cancelled", "AbortError"));
    };

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
    });
    signal?.addEventListener("abort", onAbort, { once: true });
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Could not find tutorial anchor "${anchorId}" within ${timeoutMs}ms.`));
    }, timeoutMs);
  });
}

/**
 * Watches for the element behind an anchor id being replaced.
 *
 * Ordinary React work swaps anchor nodes while a step is on screen: hovering a
 * ribbon tab upgrades its lazy tooltip wrapper, panels re-render, lists
 * virtualize. Re-resolving keeps the highlight on the live node, and reports
 * null so callers can decide how long to wait for the anchor to come back.
 */
export function observeTutorialAnchor(
  document: Document,
  anchorId: string,
  onChange: (anchor: HTMLElement | null) => void,
  domPolicy: TutorialDomPolicy = DEFAULT_TUTORIAL_DOM_POLICY,
): () => void {
  let current = findTutorialAnchor(document, anchorId, domPolicy);
  const check = () => {
    const next = findTutorialAnchor(document, anchorId, domPolicy);
    if (next === current) return;
    current = next;
    onChange(next);
  };
  const observer = new MutationObserver(check);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [ANCHOR_ATTRIBUTE, ANCHOR_ALIASES_ATTRIBUTE],
  });
  const sweep = setInterval(check, ANCHOR_SWEEP_MS);
  return () => {
    observer.disconnect();
    clearInterval(sweep);
  };
}

/** Compatibility export for the semantic selector used by both built-in policies. */
export const APPLICATION_DIALOG_SELECTOR = SEMANTIC_APPLICATION_DIALOG_SELECTOR;

/**
 * The visible application dialog on top of the page, if one is open. Floating
 * host windows participate in anchor resolution, but only semantic dialogs
 * block the rest of the page and take precedence over the tutorial's Escape.
 */
export function topmostApplicationDialog(
  document: Document,
  { includeFloatingWindows = true, domPolicy = DEFAULT_TUTORIAL_DOM_POLICY }: { includeFloatingWindows?: boolean; domPolicy?: TutorialDomPolicy } = {},
): HTMLElement | null {
  const selector = [
    domPolicy.applicationDialogSelector,
    ...(includeFloatingWindows && domPolicy.floatingWindowSelector ? [domPolicy.floatingWindowSelector] : []),
  ].filter(Boolean).join(", ");
  if (!selector) return null;
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>(selector))
    .filter((dialog) => !dialog.closest("[data-tutorial-surface], [hidden], [aria-hidden=\"true\"], [inert]")
      && dialog.getClientRects().length > 0
      && document.defaultView?.getComputedStyle(dialog).visibility !== "hidden");
  // Host window layers can be portalled in a different DOM order from their stacking order.
  const stackingLevel = (dialog: HTMLElement) => {
    let level = 0;
    for (let node: HTMLElement | null = dialog; node; node = node.parentElement) {
      const value = Number.parseInt(document.defaultView?.getComputedStyle(node).zIndex ?? "", 10);
      if (Number.isFinite(value)) level = Math.max(level, value);
    }
    return level;
  };
  dialogs.sort((left, right) => stackingLevel(left) - stackingLevel(right));
  return dialogs.at(-1) ?? null;
}
