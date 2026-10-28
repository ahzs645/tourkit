"use client";

import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "../shared/cn";

/** Shared vertical resize grip. Callers supply sizing, positioning, and input handlers. */
export const ResizeHandle = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function ResizeHandle({ className, children, ...props }, ref) {
    return (
      <div
        ref={ref}
        role="separator"
        aria-orientation="vertical"
        tabIndex={0}
        className={cn(
          "group flex w-4 touch-none cursor-col-resize select-none items-center justify-center rounded-lg outline-hidden hover:bg-brand-500/10 focus-visible:ring-2 focus-visible:ring-brand-300",
          className
        )}
        {...props}
      >
        <span aria-hidden="true" className="pointer-events-none h-10 w-1 rounded-full bg-slate-300 transition-colors group-hover:bg-brand-500 group-focus-visible:bg-brand-500 dark:bg-slate-600" />
        {children}
      </div>
    );
  }
);

