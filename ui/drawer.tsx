"use client";

import { useId, type ReactNode, type RefObject } from "react";
import clsx from "clsx";
import { DialogShell, type DialogLayer } from "./dialog-shell";

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  side?: "left" | "right";
  layer?: DialogLayer;
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Width/background overrides for the panel (default max-w-md). */
  className?: string;
  backdropClassName?: string;
  /**
   * Id of the element naming the drawer. Provide it and set it on your own
   * heading; a generated id is used otherwise (pair with an element that has it).
   */
  titleId?: string;
}

/**
 * Full-height side sheet on DialogShell (focus trap, topmost-only Escape,
 * backdrop dismissal, body scroll lock, portal). Bring your own header/body;
 * the panel is a flex column.
 */
export function Drawer({
  open,
  onClose,
  children,
  side = "right",
  layer = "dialog",
  initialFocusRef,
  className,
  backdropClassName,
  titleId: titleIdOverride
}: DrawerProps) {
  const generatedTitleId = useId();
  const titleId = titleIdOverride ?? generatedTitleId;

  return (
    <DialogShell
      open={open}
      onClose={onClose}
      titleId={titleId}
      placement={side}
      layer={layer}
      initialFocusRef={initialFocusRef}
      backdropClassName={backdropClassName}
      panelClassName={clsx(
        "flex h-full max-w-md flex-col bg-white shadow-2xl dark:bg-slate-950",
        side === "right"
          ? "border-l border-slate-200 dark:border-slate-700"
          : "border-r border-slate-200 dark:border-slate-700",
        className
      )}
    >
      {children}
    </DialogShell>
  );
}

