import clsx from "clsx";
import type { ReactNode } from "react";

interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
  /** Compact layout for small containers */
  compact?: boolean;
}

export function EmptyState({ title, description, icon, action, className, compact = false }: EmptyStateProps) {
  return (
    <div
      className={clsx(
        "flex flex-col items-center justify-center rounded-xl border border-dashed text-center",
        "border-slate-200 bg-slate-50/60 text-slate-600",
        "dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300",
        compact ? "gap-1.5 px-4 py-6" : "gap-2 px-6 py-10",
        className
      )}
    >
      {icon && (
        <div className="text-slate-400 dark:text-slate-500" aria-hidden="true">
          {icon}
        </div>
      )}
      <p className={clsx("font-semibold text-slate-800 dark:text-slate-100", compact ? "text-sm" : "text-base")}>
        {title}
      </p>
      {description && (
        <p className={clsx("max-w-sm text-slate-500 dark:text-slate-400", compact ? "text-xs" : "text-sm")}>
          {description}
        </p>
      )}
      {action && <div className={compact ? "mt-1" : "mt-2"}>{action}</div>}
    </div>
  );
}

