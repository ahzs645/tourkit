"use client";

import { forwardRef, useEffect, useRef, type InputHTMLAttributes } from "react";
import clsx from "clsx";
import { CONTROL_FOCUS } from "./control-styles";
import styles from "./checkbox.module.css";

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  indeterminate?: boolean;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { indeterminate = false, className, ...rest },
  ref
) {
  const innerRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (innerRef.current) innerRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <input
      ref={(node) => {
        innerRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      }}
      type="checkbox"
      className={clsx(
        styles.checkbox,
        CONTROL_FOCUS,
        "h-4 w-4 shrink-0 cursor-pointer appearance-none rounded-sm border border-slate-400 bg-white transition-colors checked:border-brand-600 checked:bg-brand-600 indeterminate:border-brand-600 indeterminate:bg-brand-600",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "dark:border-slate-500 dark:bg-slate-900 dark:checked:border-brand-500 dark:checked:bg-brand-500 dark:indeterminate:border-brand-500 dark:indeterminate:bg-brand-500",
        className
      )}
      {...rest}
    />
  );
});

