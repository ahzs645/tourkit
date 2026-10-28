"use client";

import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "../shared/cn";
import {
  CONTROL_BASE,
  CONTROL_DEFAULT,
  CONTROL_ERROR,
  CONTROL_SIZES,
  CONTROL_HEIGHTS,
  type ControlSize
} from "./control-styles";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  invalid?: boolean;
  size?: ControlSize;
  /** Icon or adornment rendered inside the control's left edge. */
  leading?: ReactNode;
  /** Icon, button, or adornment rendered inside the control's right edge. */
  trailing?: ReactNode;
  /** Applied to the relative wrapper when `leading`/`trailing` are used. */
  wrapperClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, size = "md", leading, trailing, wrapperClassName, className, ...rest },
  ref
) {
  const input = (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        CONTROL_BASE,
        invalid ? CONTROL_ERROR : CONTROL_DEFAULT,
        CONTROL_SIZES[size],
        CONTROL_HEIGHTS[size],
        leading && "pl-9",
        trailing && "pr-9",
        className
      )}
      {...rest}
    />
  );

  if (!leading && !trailing) return input;

  return (
    <div className={cn("relative w-full", wrapperClassName)}>
      {leading && (
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
          {leading}
        </span>
      )}
      {input}
      {trailing && (
        <span className="absolute inset-y-0 right-2 flex items-center text-slate-400">
          {trailing}
        </span>
      )}
    </div>
  );
});

