"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "../shared/cn";
import { Spinner } from "./spinner";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success";
type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  /**
   * When true, renders only an icon — require aria-label via `aria-label`.
   * The icon is `leftIcon`, or the children when no `leftIcon` is given.
   */
  iconOnly?: boolean;
  fullWidth?: boolean;
}

const BASE =
  "inline-flex items-center justify-center gap-1.5 font-semibold transition-colors " +
  "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-white " +
  "dark:focus-visible:ring-offset-slate-900 disabled:cursor-not-allowed disabled:opacity-50";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-brand-600 text-white shadow-xs hover:bg-brand-700 active:bg-brand-800 " +
    "focus-visible:ring-brand-500 dark:bg-brand-500 dark:hover:bg-brand-400",
  secondary:
    "border border-slate-300 bg-white text-slate-700 hover:border-slate-300 hover:text-slate-900 " +
    "focus-visible:ring-brand-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 " +
    "dark:hover:border-slate-400 dark:hover:text-white",
  ghost:
    "bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900 " +
    "focus-visible:ring-brand-500 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white",
  danger:
    "bg-danger-600 text-white shadow-xs hover:bg-danger-700 active:bg-danger-800 " +
    "focus-visible:ring-danger-500 dark:bg-danger-500 dark:hover:bg-danger-400",
  success:
    "bg-success-600 text-white shadow-xs hover:bg-success-700 active:bg-success-800 " +
    "focus-visible:ring-success-500 dark:bg-success-500 dark:hover:bg-success-400"
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-xs rounded-lg",
  md: "h-9 px-3.5 text-sm rounded-lg",
  lg: "h-11 px-5 text-base rounded-lg"
};

const ICON_ONLY_SIZES: Record<ButtonSize, string> = {
  sm: "h-7 w-7 rounded-lg",
  md: "h-9 w-9 rounded-lg",
  lg: "h-11 w-11 rounded-lg"
};

const SPINNER_SIZES: Record<ButtonSize, string> = {
  sm: "h-3.5 w-3.5",
  md: "h-4 w-4",
  lg: "h-5 w-5"
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "secondary",
    size = "md",
    loading = false,
    leftIcon,
    rightIcon,
    iconOnly = false,
    fullWidth = false,
    disabled,
    className,
    children,
    type = "button",
    ...rest
  },
  ref
) {
  const isDisabled = disabled || loading;
  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cn(
        BASE,
        VARIANTS[variant],
        iconOnly ? ICON_ONLY_SIZES[size] : SIZES[size],
        fullWidth && "w-full",
        className
      )}
      {...rest}
    >
      {loading ? (
        <Spinner className={SPINNER_SIZES[size]} />
      ) : (
        leftIcon
      )}
      {iconOnly ? (!loading && !leftIcon ? children : null) : children}
      {!loading && rightIcon}
    </button>
  );
});

