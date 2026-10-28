"use client";

import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "../shared/cn";
import {
  CONTROL_BASE,
  CONTROL_DEFAULT,
  CONTROL_ERROR,
  CONTROL_SIZES,
  type ControlSize
} from "./control-styles";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  size?: ControlSize;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid, size = "md", className, ...rest },
  ref
) {
  return (
    <textarea
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        CONTROL_BASE,
        invalid ? CONTROL_ERROR : CONTROL_DEFAULT,
        CONTROL_SIZES[size],
        className
      )}
      {...rest}
    />
  );
});

