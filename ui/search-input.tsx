"use client";

import { forwardRef } from "react";
import { Search, X } from "lucide-react";
import { Input, type InputProps } from "./input";

export interface SearchInputProps extends Omit<InputProps, "leading" | "trailing" | "type"> {
  /** When set and the input has a value, shows a clear (✕) button. */
  onClear?: () => void;
  /** Accessible name for the optional clear button. */
  clearAriaLabel?: string;
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  { onClear, clearAriaLabel = "Clear search", value, ...rest },
  ref
) {
  const showClear = Boolean(onClear) && Boolean(value);
  return (
    <Input
      ref={ref}
      type="search"
      role="searchbox"
      value={value}
      leading={<Search className="h-4 w-4" aria-hidden="true" />}
      trailing={
        showClear ? (
          <button
            type="button"
            onClick={onClear}
            aria-label={clearAriaLabel}
            className="rounded-sm p-1 text-slate-400 transition hover:text-slate-600 dark:hover:text-slate-200"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ) : undefined
      }
      {...rest}
    />
  );
});

