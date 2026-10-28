"use client";

import { useEffect, useRef, useState, useCallback, useId, type ReactNode } from "react";
import clsx from "clsx";
import { CONTROL_BASE, CONTROL_DEFAULT, CONTROL_ERROR } from "./control-styles";

interface SuggestInputProps {
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  disabled?: boolean;
  /** Label shown above suggestions dropdown */
  suggestionsLabel?: string;
  /** Maximum suggestions to show */
  maxSuggestions?: number;
  /** Mark field as required (shows asterisk if a label is provided and exposes aria-required) */
  required?: boolean;
  /** Invalid state — applies error styling and aria-invalid */
  invalid?: boolean;
  /** Error message shown under the input (implies invalid) */
  error?: ReactNode;
  /** Hint text shown under the input when there is no error */
  hint?: ReactNode;
  /** Visible label rendered above the input */
  label?: ReactNode;
  /** Aria label when no visible label is provided */
  ariaLabel?: string;
  /** Explicit id for the input; auto-generated if not supplied */
  id?: string;
}

/**
 * A text input with autocomplete suggestions that filter as you type.
 * Suggestions are shown in a dropdown that appears when the input is focused.
 */
export default function SuggestInput({
  value,
  onChange,
  suggestions,
  placeholder,
  className,
  inputClassName,
  disabled = false,
  suggestionsLabel = "Suggestions",
  maxSuggestions = 8,
  required = false,
  invalid: invalidProp,
  error,
  hint,
  label,
  ariaLabel,
  id: idProp
}: SuggestInputProps) {
  const autoId = useId();
  const inputId = idProp ?? autoId;
  const listboxId = `${inputId}-listbox`;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;

  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const invalid = invalidProp ?? Boolean(error);

  // Filter suggestions based on input value
  const filteredSuggestions = suggestions
    .filter((suggestion) => {
      if (!value.trim()) return true;
      const lowerValue = value.toLowerCase();
      const lowerSuggestion = suggestion.toLowerCase();
      return lowerSuggestion.includes(lowerValue);
    })
    .slice(0, maxSuggestions);

  // Score and sort by relevance
  const scoredSuggestions = filteredSuggestions
    .map((suggestion) => {
      const lowerValue = value.toLowerCase();
      const lowerSuggestion = suggestion.toLowerCase();
      let score = 0;

      if (lowerSuggestion === lowerValue) score = 100;
      else if (lowerSuggestion.startsWith(lowerValue)) score = 80;
      else if (lowerSuggestion.includes(lowerValue)) score = 50;
      if (lowerSuggestion.includes(` ${lowerValue}`)) score += 10;

      score -= suggestion.length * 0.1;

      return { suggestion, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((item) => item.suggestion);

  const hasVisibleSuggestions = scoredSuggestions.length > 0;
  const hasQuery = value.trim().length > 0;
  const showNoResults = isOpen && hasQuery && !hasVisibleSuggestions && suggestions.length > 0;

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setHighlightedIndex(-1);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (highlightedIndex >= 0 && listRef.current) {
      const item = listRef.current.children[highlightedIndex] as HTMLElement;
      item?.scrollIntoView({ block: "nearest" });
    }
  }, [highlightedIndex]);

  const selectSuggestion = useCallback(
    (suggestion: string) => {
      onChange(suggestion);
      setIsOpen(false);
      setHighlightedIndex(-1);
      inputRef.current?.focus();
    },
    [onChange]
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen || !hasVisibleSuggestions) {
      if (event.key === "ArrowDown" && hasVisibleSuggestions) {
        event.preventDefault();
        setIsOpen(true);
        setHighlightedIndex(0);
      }
      return;
    }

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setHighlightedIndex((prev) =>
          prev < scoredSuggestions.length - 1 ? prev + 1 : 0
        );
        break;
      case "ArrowUp":
        event.preventDefault();
        setHighlightedIndex((prev) =>
          prev > 0 ? prev - 1 : scoredSuggestions.length - 1
        );
        break;
      case "Enter":
        event.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < scoredSuggestions.length) {
          selectSuggestion(scoredSuggestions[highlightedIndex]);
        }
        break;
      case "Escape":
        event.preventDefault();
        setIsOpen(false);
        setHighlightedIndex(-1);
        break;
      case "Tab":
        setIsOpen(false);
        setHighlightedIndex(-1);
        break;
    }
  };

  const describedBy = [error ? errorId : null, hint && !error ? hintId : null]
    .filter(Boolean)
    .join(" ") || undefined;

  return (
    <div ref={containerRef} className={clsx("relative", className)}>
      {label && (
        <label
          htmlFor={inputId}
          className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-200"
        >
          {label}
          {required && (
            <span className="ml-0.5 text-danger-600 dark:text-danger-400" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setIsOpen(true);
          setHighlightedIndex(-1);
        }}
        onFocus={() => {
          if (hasVisibleSuggestions || (hasQuery && suggestions.length > 0)) {
            setIsOpen(true);
          }
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={!label ? ariaLabel : undefined}
        aria-required={required || undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={clsx(
          CONTROL_BASE,
          invalid ? CONTROL_ERROR : CONTROL_DEFAULT,
          "rounded-xl px-3 py-2 text-xs",
          disabled && "cursor-not-allowed opacity-50",
          inputClassName
        )}
        autoComplete="off"
        role="combobox"
        aria-expanded={isOpen && (hasVisibleSuggestions || showNoResults)}
        aria-haspopup="listbox"
        aria-autocomplete="list"
        aria-controls={listboxId}
      />

      {error ? (
        <p id={errorId} role="alert" className="mt-1 text-xs text-danger-600 dark:text-danger-400">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {hint}
        </p>
      ) : null}

      {isOpen && (hasVisibleSuggestions || showNoResults) && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-600 dark:bg-slate-800">
          <p className="border-b border-slate-100 px-3 py-1.5 text-2xs font-semibold uppercase tracking-wide text-slate-400 dark:border-slate-700 dark:text-slate-500">
            {suggestionsLabel}
          </p>
          {hasVisibleSuggestions ? (
            <div className="relative">
              <ul
                ref={listRef}
                id={listboxId}
                className="max-h-48 overflow-y-auto py-1"
                role="listbox"
              >
                {scoredSuggestions.map((suggestion, index) => (
                  <li
                    key={suggestion}
                    role="option"
                    aria-selected={highlightedIndex === index}
                    className={clsx(
                      "cursor-pointer px-3 py-1.5 text-xs",
                      highlightedIndex === index
                        ? "bg-brand-50 text-brand-700 dark:bg-brand-500/20 dark:text-brand-300"
                        : "text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700/50"
                    )}
                    onClick={() => selectSuggestion(suggestion)}
                    onMouseEnter={() => setHighlightedIndex(index)}
                  >
                    <HighlightMatch text={suggestion} query={value} />
                  </li>
                ))}
              </ul>
              {scoredSuggestions.length >= maxSuggestions && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 bottom-0 h-5 rounded-b-xl bg-linear-to-t from-white to-transparent dark:from-slate-800"
                />
              )}
            </div>
          ) : (
            <p className="px-3 py-3 text-xs text-slate-500 dark:text-slate-400">
              No suggestions match &ldquo;{value}&rdquo;.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!query.trim()) {
    return <>{text}</>;
  }

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const matchIndex = lowerText.indexOf(lowerQuery);

  if (matchIndex === -1) {
    return <>{text}</>;
  }

  const before = text.slice(0, matchIndex);
  const match = text.slice(matchIndex, matchIndex + query.length);
  const after = text.slice(matchIndex + query.length);

  return (
    <>
      {before}
      <span className="font-semibold text-brand-600 dark:text-brand-400">{match}</span>
      {after}
    </>
  );
}

