"use client";

import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { cn } from "../shared/cn";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(", ");

function getFocusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => !element.hasAttribute("disabled") && element.tabIndex >= 0
  );
}

/** Named stacking layers — use these instead of literal z-index overrides. */
export type DialogLayer = "dialog" | "nested" | "critical";

export const LAYER_CLASSES: Record<DialogLayer, string> = {
  dialog: "z-400",
  nested: "z-600",
  // For dialogs that must clear embedded third-party surfaces (e.g. hotspot maps).
  critical: "z-2147483000"
};

/**
 * Transient popovers (ribbon menus, listboxes) that may open from inside a
 * dialog. Above `nested` so a menu portaled to <body> is never hidden behind
 * the backdrop of the modal that owns its trigger; below tooltips (700) and
 * context menus (1000) so those still float over an open menu.
 */
export const POPOVER_LAYER_CLASS = "z-650";

// Stack of currently open shells so only the topmost dialog responds to
// Escape. Backdrop clicks are naturally topmost-only (the top overlay covers
// the ones below), but every shell installs a document-level key listener.
const openDialogStack: symbol[] = [];

export interface DialogShellProps {
  open: boolean;
  onClose: () => void;
  titleId: string;
  descriptionId?: string;
  children: ReactNode;
  panelClassName?: string;
  backdropClassName?: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
  layer?: DialogLayer;
  placement?: "center" | "top" | "left" | "right";
  /** Host reproductions may preserve the opener or focus the dialog container. */
  autoFocus?: "first" | "panel" | "none";
  dismissOnEscape?: boolean;
  dismissOnBackdrop?: boolean;
  trapFocus?: boolean;
  restoreFocus?: boolean;
  /** Let an expanded shared picker consume Escape before dismissing its host. */
  respectPickerEscape?: boolean;
}

const PLACEMENT_CLASSES: Record<NonNullable<DialogShellProps["placement"]>, string> = {
  center: "items-center justify-center p-4",
  top: "items-start justify-center p-4 pt-12 sm:pt-16",
  // Drawer placements: panel spans full height, flush to the viewport edge.
  left: "items-stretch justify-start",
  right: "items-stretch justify-end"
};

export function DialogShell({
  open,
  onClose,
  titleId,
  descriptionId,
  children,
  panelClassName,
  backdropClassName,
  initialFocusRef,
  layer = "dialog",
  placement = "center",
  autoFocus = "first",
  dismissOnEscape = true,
  dismissOnBackdrop = true,
  trapFocus = true,
  restoreFocus = true,
  respectPickerEscape = false
}: DialogShellProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const lastActiveElementRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useLayoutEffect(() => {
    if (!open || typeof document === "undefined") return;

    const stackId = Symbol("dialog");
    openDialogStack.push(stackId);

    lastActiveElementRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }
    document.body.style.overflow = "hidden";

    const panel = panelRef.current;
    const focusTarget =
      initialFocusRef?.current ??
      (autoFocus === "none" ? null : autoFocus === "panel" ? panel : panel ? getFocusableElements(panel)[0] ?? panel : null);

    const frame = window.requestAnimationFrame(() => {
      focusTarget?.focus({ preventScroll: true });
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      // Only the topmost open dialog reacts to Escape; parents of nested
      // dialogs keep their listeners but stay inert until they're on top.
      const isTopmost = openDialogStack[openDialogStack.length - 1] === stackId;

      if (event.key === "Escape") {
        if (!isTopmost) return;
        if (respectPickerEscape && event.target instanceof HTMLElement && event.target.closest('[aria-expanded="true"][aria-controls]')) return;
        event.preventDefault();
        if (dismissOnEscape) onCloseRef.current();
        return;
      }

      if (event.key !== "Tab" || !panel || !isTopmost || !trapFocus) return;

      // Tutorial cards (stamped via TUTORIAL_SURFACE_PROPS in
      // player/surface.ts) and full-screen takeovers
      // like the offline-install splash (data-overlay-focus-surface) float
      // above every dialog layer; include their controls so keyboard users
      // can reach them while a modal is open.
      const tutorialSurfaces = Array.from(
        document.querySelectorAll<HTMLElement>(
          "[data-tutorial-surface], [data-overlay-focus-surface]"
        )
      );
      const focusables = [
        ...getFocusableElements(panel),
        ...tutorialSurfaces.flatMap((surface) => getFocusableElements(surface))
      ];
      if (focusables.length === 0) {
        event.preventDefault();
        panel.focus({ preventScroll: true });
        return;
      }

      const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const currentIndex = activeElement ? focusables.indexOf(activeElement) : -1;

      if (event.shiftKey) {
        if (currentIndex <= 0) {
          event.preventDefault();
          focusables[focusables.length - 1]?.focus({ preventScroll: true });
        }
        return;
      }

      if (currentIndex === -1 || currentIndex === focusables.length - 1) {
        event.preventDefault();
        focusables[0]?.focus({ preventScroll: true });
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      const index = openDialogStack.indexOf(stackId);
      if (index !== -1) openDialogStack.splice(index, 1);
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown, true);
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.paddingRight = previousBodyPaddingRight;
      if (restoreFocus) lastActiveElementRef.current?.focus?.({ preventScroll: true });
    };
  }, [initialFocusRef, open, autoFocus, dismissOnEscape, trapFocus, restoreFocus, respectPickerEscape]);

  if (!open) return null;

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 flex overflow-y-auto overscroll-contain bg-black/50",
        PLACEMENT_CLASSES[placement],
        LAYER_CLASSES[layer],
        backdropClassName
      )}
      onWheel={(event) => {
        event.stopPropagation();
      }}
      onTouchMove={(event) => {
        event.stopPropagation();
      }}
      onMouseDown={(event) => {
        if (dismissOnBackdrop && event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className={cn("w-full outline-hidden", panelClassName)}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}

