"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";

export type ContextMenuItem =
  | {
      kind?: "item";
      id: string;
      label: string;
      icon?: ReactNode;
      onSelect: () => void;
      disabled?: boolean;
      /** Render with destructive styling (e.g. Delete). */
      danger?: boolean;
      /** Keyboard shortcut hint shown on the right (display only). */
      shortcut?: string;
      /** Secondary line under the label, e.g. why a disabled item is unavailable. */
      description?: string;
    }
  | { kind: "separator"; id?: string };

interface ContextMenuProps {
  open: boolean;
  /** Viewport-relative anchor (typically the cursor position). */
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
  ariaLabel?: string;
}

const VIEWPORT_MARGIN = 8;

/**
 * A lightweight cursor-anchored menu rendered through a portal so it escapes
 * `overflow` clipping. Dismisses on outside click, scroll, resize, blur, and
 * Escape; supports arrow-key navigation between enabled items.
 */
export function ContextMenu({ open, x, y, items, onClose, ariaLabel = "Context menu" }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const openedAtRef = useRef<number | null>(null);
  const [position, setPosition] = useState({ x, y });

  // Measure once mounted and clamp inside the viewport before paint.
  useLayoutEffect(() => {
    if (!open) {
      openedAtRef.current = null;
      return;
    }
    if (openedAtRef.current === null) openedAtRef.current = performance.now();
    const el = menuRef.current;
    let nextX = x;
    let nextY = y;
    if (el) {
      const rect = el.getBoundingClientRect();
      if (x + rect.width > window.innerWidth - VIEWPORT_MARGIN) {
        nextX = Math.max(VIEWPORT_MARGIN, window.innerWidth - rect.width - VIEWPORT_MARGIN);
      }
      if (y + rect.height > window.innerHeight - VIEWPORT_MARGIN) {
        nextY = Math.max(VIEWPORT_MARGIN, window.innerHeight - rect.height - VIEWPORT_MARGIN);
      }
    }
    setPosition((prev) => (prev.x === nextX && prev.y === nextY ? prev : { x: nextX, y: nextY }));
  }, [open, x, y, items.length]);

  // Move keyboard focus into the menu so Escape and arrow keys work.
  useEffect(() => {
    if (!open) return;
    menuRef.current?.focus();
  }, [open]);

  // Dismiss on any interaction outside the menu.
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    const handleDismiss = () => onClose();
    const handleScroll = (event: Event) => {
      // A single-line input resets its horizontal text scroll on blur. That
      // does not move this menu's anchor and must not dismiss the new menu.
      if (event.target instanceof HTMLInputElement) return;
      // Scrolling the trigger into view can queue an event before this menu
      // opens and deliver it afterward. Only subsequent scrolls dismiss it.
      if (openedAtRef.current !== null && event.timeStamp < openedAtRef.current) return;
      onClose();
    };
    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleDismiss);
    window.addEventListener("blur", handleDismiss);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleDismiss);
      window.removeEventListener("blur", handleDismiss);
    };
  }, [open, onClose]);

  const moveFocus = useCallback((delta: number) => {
    const buttons = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>("button[data-menu-item]:not([disabled])") ?? []
    );
    if (buttons.length === 0) return;
    const active = document.activeElement;
    const currentIndex = buttons.findIndex((button) => button === active);
    const nextIndex =
      currentIndex === -1
        ? delta > 0
          ? 0
          : buttons.length - 1
        : (currentIndex + delta + buttons.length) % buttons.length;
    buttons[nextIndex]?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveFocus(1);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        moveFocus(-1);
      }
    },
    [moveFocus, onClose]
  );

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={ariaLabel}
      aria-orientation="vertical"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      onContextMenu={(event) => event.preventDefault()}
      className="fixed z-1000 min-w-44 max-w-[16rem] overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-slate-700 shadow-xl outline-hidden animate-fade-in dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
      style={{ top: position.y, left: position.x }}
    >
      {items.map((item, index) => {
        if (item.kind === "separator") {
          return (
            <div
              key={item.id ?? `separator-${index}`}
              role="separator"
              className="my-1 border-t border-slate-100 dark:border-slate-700"
            />
          );
        }

        return (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            data-menu-item
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return;
              item.onSelect();
              onClose();
            }}
            className={clsx(
              "flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs font-medium transition-colors focus-visible:outline-hidden",
              item.disabled
                ? "cursor-not-allowed text-slate-300 dark:text-slate-600"
                : item.danger
                  ? "text-rose-600 hover:bg-rose-50 focus:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-500/10 dark:focus:bg-rose-500/10"
                  : "text-slate-700 hover:bg-slate-100 focus:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700 dark:focus:bg-slate-700"
            )}
          >
            {item.icon ? (
              <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">
                {item.icon}
              </span>
            ) : null}
            {item.description ? (
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{item.label}</span>
                <span className="whitespace-normal text-[11px] font-normal text-slate-500 dark:text-slate-400">
                  {item.description}
                </span>
              </span>
            ) : (
              <span className="flex-1 truncate">{item.label}</span>
            )}
            {item.shortcut ? (
              <kbd className="shrink-0 font-sans text-[11px] text-slate-400 dark:text-slate-500">
                {item.shortcut}
              </kbd>
            ) : null}
          </button>
        );
      })}
    </div>,
    document.body
  );
}

