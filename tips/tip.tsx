"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { isTipAnchorOnScreen, placeTip, type TipPlacement, type TipPosition } from "./placement";
import {
  DEFAULT_TIP_STORAGE_KEY,
  dismissTip,
  getTipQueueState,
  isAutomatedBrowser,
  readDismissedTips,
  releaseTip,
  requestTip,
  subscribeTips,
} from "./store";
import "./tips.css";

export const DEFAULT_TIP_PHONE_QUERY = "(max-width: 559px)";
const ANCHOR_RETRIES = 20;
const ANCHOR_RETRY_MS = 250;

export interface UseTipOptions {
  /** localStorage key holding dismissed tip keys. Scope it per user. */
  storageKey?: string;
  /** Pass false while the tip has nothing to point at. */
  enabled?: boolean;
  /** Keep the tip hidden. Defaults to hiding it in automated browsers. */
  suppressed?: boolean;
}

/** Whether the tip `key` should show now, and a `dismiss` that remembers it. */
export function useTip(
  key: string,
  { storageKey = DEFAULT_TIP_STORAGE_KEY, enabled = true, suppressed }: UseTipOptions = {},
): { open: boolean; dismiss: () => void } {
  const snapshot = useSyncExternalStore(subscribeTips, getTipQueueState, getTipQueueState);
  // Re-read on every render; `snapshot.version` changes whenever dismissals do.
  const dismissed = readDismissedTips(storageKey).includes(key);
  const wants = enabled && !dismissed && !(suppressed ?? isAutomatedBrowser());

  useEffect(() => {
    if (!wants) return;
    requestTip(key);
    return () => releaseTip(key);
  }, [key, wants]);

  const dismiss = useCallback(() => dismissTip(key, storageKey), [key, storageKey]);
  const open = wants && !snapshot.cooledDown && snapshot.queue[0] === key;
  return { open, dismiss };
}

function useMediaQuery(query: string | null): boolean {
  const get = () => (query !== null && typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(query).matches
    : false);
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (query === null || typeof window.matchMedia !== "function") {
      setMatches(false);
      return;
    }
    const media = window.matchMedia(query);
    const onChange = () => setMatches(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/** Finds the first on-screen match, waiting briefly for it to mount (sidebars and toolbars load late). */
function useAnchor(selector: string | undefined): HTMLElement | null {
  const [element, setElement] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setElement(null);
    if (!selector) return;
    let tries = 0;
    let timer: number | undefined;
    const find = () => {
      const found = Array.from(document.querySelectorAll<HTMLElement>(selector)).find(isTipAnchorOnScreen);
      if (found) {
        setElement(found);
        return;
      }
      tries += 1;
      if (tries < ANCHOR_RETRIES) timer = window.setTimeout(find, ANCHOR_RETRY_MS);
    };
    find();
    return () => window.clearTimeout(timer);
  }, [selector]);
  return element;
}

export interface TipProps {
  /** Stable id for remembering dismissal, for example "sidebar-favorites". */
  tipKey: string;
  /** CSS selector of the element to point at. Omit to render inline. */
  anchor?: string;
  placement?: TipPlacement;
  title: ReactNode;
  children?: ReactNode;
  /** Optional illustration above the title. */
  image?: ReactNode;
  ctaLabel?: string;
  onCta?: () => void;
  dismissLabel?: string;
  /** Accessible name of the close button. */
  closeLabel?: string;
  /** Close button content. Defaults to a multiplication sign. */
  closeIcon?: ReactNode;
  className?: string;
  /** localStorage key holding dismissed tip keys. Scope it per user. */
  storageKey?: string;
  /** Keep the tip hidden. Defaults to hiding it in automated browsers. */
  suppressed?: boolean;
  /** Anchored tips stay hidden while this media query matches; null shows them everywhere. */
  hideAnchoredWhen?: string | null;
  /**
   * Block class for the card and its parts (`__head`, `__title`, `__close`,
   * `__body`, `__actions`, `__image`, `__tail`, `--inline`, `--<placement>`)
   * and the tail's custom property (`--<prefix>-tail`). Hosts with their own
   * styles pass their block name; the default `tourkit-tip` uses tips.css.
   */
  classPrefix?: string;
  /** Class of the "Got it" button. */
  dismissButtonClassName?: string;
  /** Class of the call-to-action button. */
  ctaButtonClassName?: string;
}

/**
 * A small coachmark that points at a feature once. Non-modal: focus is never
 * moved or trapped. Esc or the dismiss button closes it, and if focus was
 * inside the tip it returns to the anchor. Anchored tips render in a portal
 * and hide while their anchor is off screen.
 */
export function Tip({
  tipKey,
  anchor,
  placement = "bottom",
  title,
  children,
  image,
  ctaLabel,
  onCta,
  dismissLabel = "Got it",
  closeLabel = "Dismiss tip",
  closeIcon = <span aria-hidden="true">×</span>,
  className,
  storageKey,
  suppressed,
  hideAnchoredWhen = DEFAULT_TIP_PHONE_QUERY,
  classPrefix = "tourkit-tip",
  dismissButtonClassName,
  ctaButtonClassName,
}: TipProps) {
  const inline = !anchor;
  const anchorHidden = useMediaQuery(inline ? null : hideAnchoredWhen);
  const anchorElement = useAnchor(inline || anchorHidden ? undefined : anchor);
  const { open, dismiss } = useTip(tipKey, {
    storageKey,
    suppressed,
    enabled: inline || (!anchorHidden && Boolean(anchorElement)),
  });
  const cardRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [position, setPosition] = useState<TipPosition | null>(null);

  useLayoutEffect(() => {
    if (!open || inline || !anchorElement) return;
    const place = () => {
      const card = cardRef.current;
      if (!card) return;
      // The anchor scrolled away or its drawer closed: hide rather than point at nothing.
      if (!anchorElement.isConnected || !isTipAnchorOnScreen(anchorElement)) {
        setPosition(null);
        return;
      }
      setPosition(placeTip(anchorElement.getBoundingClientRect(), { width: card.offsetWidth, height: card.offsetHeight }, placement));
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    observer?.observe(anchorElement);
    // Content loading above the anchor moves it without resizing it.
    observer?.observe(document.body);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      observer?.disconnect();
    };
  }, [open, inline, anchorElement, placement]);

  const close = useCallback(() => {
    const hadFocus = cardRef.current?.contains(document.activeElement) ?? false;
    dismiss();
    if (hadFocus) anchorElement?.focus();
  }, [dismiss, anchorElement]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // Let an open dialog or menu take Esc first.
      if (document.querySelector('[role="dialog"][aria-modal="true"], [role="menu"], [role="listbox"]')) return;
      close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  if (!open) return null;

  const block = classPrefix;
  const style: CSSProperties | undefined = inline ? undefined : {
    top: position?.top ?? -9999,
    left: position?.left ?? -9999,
    visibility: position ? undefined : "hidden",
    ...(position ? { [`--${block}-tail`]: `${position.tail}px` } : {}),
  };
  const card = (
    <div
      ref={cardRef}
      className={[block, inline ? `${block}--inline` : `${block}--${placement}`, className].filter(Boolean).join(" ")}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      data-tip={tipKey}
      style={style}
    >
      {!inline && <span className={`${block}__tail`} aria-hidden="true" />}
      {image && <div className={`${block}__image`}>{image}</div>}
      <div className={`${block}__head`}>
        <h2 className={`${block}__title`} id={titleId}>{title}</h2>
        <button type="button" className={`${block}__close`} onClick={close} aria-label={closeLabel}>
          {closeIcon}
        </button>
      </div>
      {children && <div className={`${block}__body`}>{children}</div>}
      <div className={`${block}__actions`}>
        {ctaLabel && onCta && (
          <button
            type="button"
            className={ctaButtonClassName ?? `${block}__button`}
            onClick={() => {
              onCta();
              close();
            }}
          >
            {ctaLabel}
          </button>
        )}
        <button type="button" className={dismissButtonClassName ?? `${block}__button ${block}__button--primary`} onClick={close}>
          {dismissLabel}
        </button>
      </div>
    </div>
  );

  return inline ? card : createPortal(card, document.body);
}
