"use client";

import {
  createContext,
  forwardRef,
  useContext,
  useId,
  type HTMLAttributes,
  type ReactNode,
  type RefObject
} from "react";
import { X } from "lucide-react";
import { cn } from "../shared/cn";
import { DialogShell, type DialogLayer } from "./dialog-shell";
import { IconButton } from "./icon-button";

type ModalSize = "sm" | "md" | "lg" | "xl" | "full" | "custom";

const SIZES: Record<ModalSize, string> = {
  sm: "max-h-[calc(100dvh-2rem)] max-w-md",
  md: "max-h-[calc(100dvh-2rem)] max-w-xl",
  lg: "max-h-[calc(100dvh-2rem)] max-w-3xl",
  xl: "max-h-[calc(100dvh-2rem)] max-w-5xl",
  full: "h-[calc(100dvh-2rem)] max-h-[calc(100dvh-2rem)] max-w-none",
  // No size classes — className owns the dimensions (e.g. panels that toggle sizes).
  custom: ""
};

interface ModalContextValue {
  titleId: string;
  descriptionId: string;
  onClose: () => void;
  busy: boolean;
}

const ModalContext = createContext<ModalContextValue | null>(null);

function useModalContext(component: string) {
  const context = useContext(ModalContext);
  if (!context) throw new Error(`${component} must be used inside <Modal>`);
  return context;
}

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  size?: ModalSize;
  placement?: "center" | "top" | "left" | "right";
  layer?: DialogLayer;
  /** Blocks Escape/backdrop dismissal while an action is in flight. */
  busy?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  autoFocus?: "first" | "panel" | "none";
  dismissOnEscape?: boolean;
  dismissOnBackdrop?: boolean;
  trapFocus?: boolean;
  restoreFocus?: boolean;
  respectPickerEscape?: boolean;
  /** Extra classes for the panel (e.g. a custom width). */
  className?: string;
  /** Extra classes for the backdrop (e.g. backdrop-blur-sm). */
  backdropClassName?: string;
  /**
   * Override the generated title/description element ids — for panels that
   * render their own heading instead of Modal.Header. Set the same id on
   * that heading so aria-labelledby resolves.
   */
  titleId?: string;
  descriptionId?: string;
}

/**
 * Standard modal chrome on top of DialogShell: rounded panel with
 * Modal.Header / Modal.Body / Modal.Footer. DialogShell supplies focus trap,
 * Escape (topmost-only), backdrop dismissal, body scroll lock, and portal.
 */
export function Modal({
  open,
  onClose,
  children,
  size = "md",
  placement = "center",
  layer = "dialog",
  busy = false,
  initialFocusRef,
  autoFocus,
  dismissOnEscape,
  dismissOnBackdrop,
  trapFocus,
  restoreFocus,
  respectPickerEscape,
  className,
  backdropClassName,
  titleId: titleIdOverride,
  descriptionId: descriptionIdOverride
}: ModalProps) {
  const generatedTitleId = useId();
  const generatedDescriptionId = useId();
  const titleId = titleIdOverride ?? generatedTitleId;
  const descriptionId = descriptionIdOverride ?? generatedDescriptionId;
  const handleClose = () => {
    if (!busy) onClose();
  };

  return (
    <DialogShell
      open={open}
      onClose={handleClose}
      titleId={titleId}
      descriptionId={descriptionId}
      layer={layer}
      placement={placement}
      initialFocusRef={initialFocusRef}
      autoFocus={autoFocus}
      dismissOnEscape={dismissOnEscape}
      dismissOnBackdrop={dismissOnBackdrop}
      trapFocus={trapFocus}
      restoreFocus={restoreFocus}
      respectPickerEscape={respectPickerEscape}
      backdropClassName={backdropClassName}
      panelClassName={cn(
        "flex flex-col rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900",
        SIZES[size],
        className
      )}
    >
      <ModalContext.Provider value={{ titleId, descriptionId, onClose: handleClose, busy }}>
        {children}
      </ModalContext.Provider>
    </DialogShell>
  );
}

type ModalHeaderTone = "default" | "hero";

const HEADER_TONES: Record<ModalHeaderTone, { container: string; eyebrow: string; title: string; description: string; close: string }> = {
  default: {
    container: "",
    eyebrow: "flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400",
    title: "text-base font-semibold text-slate-900 dark:text-white",
    description: "mt-1 text-sm text-slate-600 dark:text-slate-400",
    close: ""
  },
  // Dark banner header for flagship dialogs (QA report, preset pickers).
  hero: {
    container: "border-slate-800 bg-slate-950 py-5 text-white dark:border-slate-800",
    eyebrow: "flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-sky-200",
    title: "text-xl font-semibold text-white",
    description: "mt-1 max-w-2xl text-sm leading-6 text-slate-300",
    close: "text-slate-300 hover:bg-white/10 hover:text-white dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
  }
};

interface ModalHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Small-caps kicker line rendered above the title. */
  eyebrow?: ReactNode;
  /** Rendered left of the close button (badges, secondary actions). */
  actions?: ReactNode;
  /** Hide the ✕ button for flows that must close via explicit footer actions. */
  hideClose?: boolean;
  tone?: ModalHeaderTone;
  className?: string;
}

function ModalHeader({
  title,
  description,
  eyebrow,
  actions,
  hideClose = false,
  tone = "default",
  className
}: ModalHeaderProps) {
  const { titleId, descriptionId, onClose, busy } = useModalContext("Modal.Header");
  const tones = HEADER_TONES[tone];
  return (
    <div
      className={cn(
        // rounded-t-[inherit] keeps tinted headers (hero, bg-* overrides) inside
        // the panel's rounded corners — the panel doesn't clip its children.
        "flex shrink-0 items-start justify-between gap-3 rounded-t-[inherit] border-b border-slate-200 px-6 py-4 dark:border-slate-700",
        tones.container,
        className
      )}
    >
      <div className="min-w-0">
        {eyebrow && <div className={tones.eyebrow}>{eyebrow}</div>}
        <h2 id={titleId} className={cn(tones.title, eyebrow != null && "mt-2")}>
          {title}
        </h2>
        {description && (
          <p id={descriptionId} className={tones.description}>
            {description}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {actions}
        {!hideClose && (
          <IconButton
            icon={<X className="h-4 w-4" aria-hidden="true" />}
            aria-label="Close dialog"
            onClick={onClose}
            disabled={busy}
            className={tones.close}
          />
        )}
      </div>
    </div>
  );
}

/** Slot between Header and Body for filter/action rows (tabs, search, toggles). */
function ModalToolbar({ children, className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-3 border-b border-slate-200 px-6 py-3 dark:border-slate-700",
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

interface ModalBodyProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /** Scrolls within the panel (default). Disable for bodies that manage their own layout. */
  scrollable?: boolean;
  /** Standard px-6 py-4 padding (default). Disable for pane layouts that own their spacing. */
  padded?: boolean;
}

const ModalBody = forwardRef<HTMLDivElement, ModalBodyProps>(function ModalBody(
  { children, scrollable = true, padded = true, className, ...rest },
  ref
) {
  return (
    <div
      ref={ref}
      className={cn(
        padded && "px-6 py-4",
        scrollable ? "scrollbar-slim min-h-0 flex-1 overflow-y-auto" : "flex min-h-0 flex-1 overflow-hidden",
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
});

function ModalFooter({ children, className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-end gap-2 rounded-b-[inherit] border-t border-slate-200 px-6 py-4 dark:border-slate-700",
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

Modal.Header = ModalHeader;
Modal.Toolbar = ModalToolbar;
Modal.Body = ModalBody;
Modal.Footer = ModalFooter;

