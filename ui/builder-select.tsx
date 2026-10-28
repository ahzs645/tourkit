"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEventHandler,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { Check, ChevronDown } from "lucide-react";
import { CONTROL_BASE, CONTROL_DEFAULT, CONTROL_SIZES, CONTROL_HEIGHTS, MENU_SURFACE, PANEL_SURFACE } from "./control-styles";
import { DialogShell } from "./dialog-shell";
import { cn } from "../shared/cn";

export interface BuilderSelectOption {
  value: string;
  label: string;
  menuLabel?: string;
  triggerLabel?: string;
  disabled?: boolean;
  icon?: ReactNode;
  description?: string;
}

interface BasePickerProps {
  id?: string;
  value: string;
  options: readonly BuilderSelectOption[];
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  allowCustomValue?: boolean;
  listboxVariant?: "popover" | "modal";
  modalTitle?: string;
  onBlur?: FocusEventHandler<HTMLInputElement | HTMLButtonElement>;
  onFocus?: FocusEventHandler<HTMLInputElement | HTMLButtonElement>;
  controlClassName?: string;
  popoverWidth?: number;
  /** Style the portaled menu when embedding a picker in an external preview. */
  popoverClassName?: string;
  showSelectedIndicator?: boolean;
  "aria-label"?: string;
  /** Tutorial anchors belong to the interactive trigger, not its wrapper or popup. */
  "data-tutorial-id"?: string;
  "data-tutorial-aliases"?: string;
}

interface ComboboxProps extends BasePickerProps {
  /** Observe the search text while typing, for free-text suggestion fields. */
  onInputChange?: (value: string) => void;
  /** Runs after the picker's keyboard handling, for unhandled keys. */
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
}

function useCloseOnOutsideClick(open: boolean, onClose: () => void) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const portalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !portalRef.current?.contains(target)
      ) {
        onClose();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [onClose, open]);

  return { rootRef, portalRef };
}

interface FloatingListboxPosition {
  top?: number;
  bottom?: number;
  left: number;
  width: number;
  maxHeight: number;
}

interface FloatingListboxAnchor {
  top: number;
  bottom: number;
  left: number;
  width: number;
}

export function getFloatingListboxPosition(
  anchor: FloatingListboxAnchor,
  optionCount: number,
  viewportWidth: number,
  viewportHeight: number,
): FloatingListboxPosition {
  const viewportPadding = 12;
  const gap = 4;
  const estimatedHeight = Math.min(256, Math.max(44, optionCount * 40 + 8));
  const spaceBelow = viewportHeight - anchor.bottom - viewportPadding;
  const spaceAbove = anchor.top - viewportPadding;
  const openAbove = spaceBelow < estimatedHeight && spaceAbove > spaceBelow;
  const availableHeight = (openAbove ? spaceAbove : spaceBelow) - gap;

  return {
    // Bottom-position upward-opening menus so their actual rendered height does
    // not create a gap when it is shorter than the available max height.
    top: openAbove ? undefined : anchor.bottom + gap,
    bottom: openAbove ? viewportHeight - anchor.top + gap : undefined,
    left: Math.max(
      viewportPadding,
      Math.min(anchor.left, viewportWidth - anchor.width - viewportPadding),
    ),
    width: anchor.width,
    maxHeight: Math.min(256, Math.max(0, availableHeight)),
  };
}

function useFloatingListboxPosition(
  open: boolean,
  rootRef: RefObject<HTMLDivElement | null>,
  optionCount: number,
) {
  const [position, setPosition] = useState<FloatingListboxPosition | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }

    const updatePosition = () => {
      const anchor = rootRef.current?.getBoundingClientRect();
      if (!anchor) return;

      setPosition(
        getFloatingListboxPosition(
          anchor,
          optionCount,
          window.innerWidth,
          window.innerHeight,
        ),
      );
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, optionCount, rootRef]);

  return open ? position : null;
}

function Chevron() {
  return <ChevronDown className="h-4 w-4" aria-hidden="true" />;
}

const controlBaseClass = `${CONTROL_BASE} ${CONTROL_DEFAULT} text-left`;
const controlSizeClass = `${CONTROL_SIZES.md} ${CONTROL_HEIGHTS.md}`;
const controlClass = `${controlBaseClass} ${controlSizeClass}`;
const floatingListboxClass = `scrollbar-slim fixed z-10000 overflow-y-auto overscroll-contain ${MENU_SURFACE}`;

function optionClass(active: boolean, selected: boolean, disabled?: boolean) {
  return clsx(
    "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition",
    disabled
      ? "cursor-not-allowed text-slate-400 dark:text-slate-600"
      : "cursor-pointer text-slate-700 dark:text-slate-200",
    active && !disabled && "bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-100",
    selected && !active && "bg-slate-50 font-semibold dark:bg-slate-800",
  );
}

function PickerModal({
  id,
  title,
  children,
  onClose,
  portalRef,
  initialFocusRef,
  onKeyDown,
}: {
  id?: string;
  title: string;
  children: ReactNode;
  onClose: () => void;
  portalRef: RefObject<HTMLDivElement | null>;
  initialFocusRef?: RefObject<HTMLElement | null>;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
}) {
  const fallbackTitleId = useId();
  const titleId = id ? `${id}-modal-title` : fallbackTitleId;

  return (
    <DialogShell
      open
      onClose={onClose}
      titleId={titleId}
      layer="nested"
      initialFocusRef={initialFocusRef}
      panelClassName="max-w-lg"
    >
      <div
        ref={portalRef}
        onKeyDown={onKeyDown}
        className={`${PANEL_SURFACE} flex max-h-[78vh] w-full flex-col overflow-hidden shadow-xl`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <h3
            id={titleId}
            className="text-sm font-semibold text-slate-900 dark:text-slate-100"
          >
            {title}
          </h3>
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            aria-label="Close picker"
            onClick={onClose}
          >
            <span aria-hidden="true" className="text-lg leading-none">
              ×
            </span>
          </button>
        </div>
        {children}
      </div>
    </DialogShell>
  );
}

export function BuilderSelect({
  id,
  value,
  options,
  onChange,
  className,
  placeholder = "Select...",
  disabled,
  listboxVariant = "popover",
  modalTitle = "Select an option",
  onBlur,
  onFocus,
  controlClassName,
  popoverWidth,
  popoverClassName,
  showSelectedIndicator = true,
  "aria-label": ariaLabel,
  "data-tutorial-id": tutorialId,
  "data-tutorial-aliases": tutorialAliases,
}: BasePickerProps) {
  const [open, setOpen] = useState(false);
  const selectedOption = options.find((option) => option.value === value) ?? null;
  const selectedIndex = options.findIndex((option) => option.value === value);
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, selectedIndex));
  const { rootRef, portalRef } = useCloseOnOutsideClick(open, () => setOpen(false));
  const listboxPosition = useFloatingListboxPosition(open, rootRef, options.length);
  const generatedId = useId();
  const listboxId = `${id ?? generatedId}-listbox`;

  const openListbox = () => {
    setActiveIndex(selectedIndex >= 0 && !options[selectedIndex]?.disabled ? selectedIndex : options.findIndex((option) => !option.disabled));
    setOpen(true);
  };

  const chooseOption = (option: BuilderSelectOption) => {
    if (option.disabled) return;
    onChange(option.value);
    setOpen(false);
    if (listboxVariant === "popover") rootRef.current?.querySelector("button")?.focus();
  };

  const moveActiveIndex = (direction: 1 | -1) => {
    setActiveIndex((current) => {
      for (let offset = 1; offset <= options.length; offset += 1) {
        const next = (current + direction * offset + options.length) % options.length;
        if (!options[next]?.disabled) return next;
      }
      return current;
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        openListbox();
        return;
      }
      moveActiveIndex(event.key === "ArrowDown" ? 1 : -1);
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!open) {
        openListbox();
        return;
      }
      const option = options[activeIndex];
      if (option) chooseOption(option);
    }
    if (open && (event.key === "Home" || event.key === "End")) {
      event.preventDefault();
      const enabled = options.map((option, index) => option.disabled ? -1 : index).filter((index) => index >= 0);
      setActiveIndex(event.key === "Home" ? enabled[0] ?? -1 : enabled[enabled.length - 1] ?? -1);
    }
    if (event.key === "Escape" || event.key === "Tab") {
      if (event.key === "Escape" && open) event.stopPropagation();
      setOpen(false);
    }
  };

  // DialogShell moves focus into the picker panel, so arrow-key navigation
  // must live on the panel itself (the trigger no longer receives keydowns
  // while the modal variant is open). Enter on a focused option button is
  // left to the button's native click.
  const handleModalKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveActiveIndex(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (
      event.key === "Enter" &&
      !(event.target instanceof HTMLElement && event.target.closest('[role="option"]'))
    ) {
      event.preventDefault();
      const option = options[activeIndex];
      if (option) chooseOption(option);
    }
  };

  return (
    <div ref={rootRef} className={clsx("relative", className)}>
      <button
        id={id}
        data-tutorial-id={tutorialId}
        data-tutorial-aliases={tutorialAliases}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-label={ariaLabel}
        onClick={() => {
          if (open) {
            setOpen(false);
          } else {
            openListbox();
          }
        }}
        onBlur={onBlur as FocusEventHandler<HTMLButtonElement> | undefined}
        onFocus={onFocus as FocusEventHandler<HTMLButtonElement> | undefined}
        onKeyDown={handleKeyDown}
        className={cn(controlClass, "flex items-center", controlClassName)}
      >
        <span className="flex min-w-0 items-center gap-2 pr-6">
          {selectedOption?.icon ? <span className="shrink-0">{selectedOption.icon}</span> : null}
          <span className={clsx("truncate", !selectedOption && "text-slate-400")}>
            {selectedOption?.triggerLabel ?? selectedOption?.label ?? placeholder}
          </span>
        </span>
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-400">
          <Chevron />
        </span>
      </button>
      {open && listboxVariant === "modal" ? (
        <PickerModal
          id={id}
          title={modalTitle}
          onClose={() => setOpen(false)}
          portalRef={portalRef}
          onKeyDown={handleModalKeyDown}
        >
          <div id={listboxId} className="scrollbar-slim max-h-[64vh] overflow-y-auto py-1" role="listbox" aria-labelledby={id}>
            {options.map((option, index) => {
              const selected = option.value === value;
              const active = index === activeIndex;
              return (
                <button
                  key={option.value || `empty-${index}`}
                  type="button"
                  role="option"
                  aria-selected={selected}
                        data-active={active || undefined}
                  disabled={option.disabled}
                  className={optionClass(active, selected, option.disabled)}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => chooseOption(option)}
                >
                  {option.icon ? <span className="shrink-0">{option.icon}</span> : null}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{option.menuLabel ?? option.label}</span>
                    {option.description ? (
                      <span className="block truncate text-xs font-normal text-slate-500 dark:text-slate-400">
                        {option.description}
                      </span>
                    ) : null}
                  </span>
                  {selected && showSelectedIndicator ? (
                    <Check className="h-4 w-4 shrink-0 text-brand-600 dark:text-brand-300" aria-hidden="true" />
                  ) : null}
                </button>
              );
            })}
          </div>
        </PickerModal>
      ) : open && listboxPosition
        ? createPortal(
            <div
              ref={portalRef}
              className={clsx(floatingListboxClass, popoverClassName)}
              style={{
                top: listboxPosition.top,
                bottom: listboxPosition.bottom,
                left: listboxPosition.left,
                width: popoverWidth ?? listboxPosition.width,
                maxHeight: listboxPosition.maxHeight,
              }}
              onWheelCapture={(event) => event.stopPropagation()}
              onTouchMoveCapture={(event) => event.stopPropagation()}
            >
              <div id={listboxId} role="listbox" aria-labelledby={id}>
                {options.map((option, index) => {
                  const selected = option.value === value;
                  const active = index === activeIndex;
                  return (
                    <button
                      key={option.value || `empty-${index}`}
                      type="button"
                      role="option"
                      tabIndex={-1}
                      aria-selected={selected}
                        data-active={active || undefined}
                      disabled={option.disabled}
                      className={optionClass(active, selected, option.disabled)}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => chooseOption(option)}
                    >
                      {option.icon ? <span className="shrink-0">{option.icon}</span> : null}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{option.label}</span>
                        {option.description ? (
                          <span className="block truncate text-xs font-normal text-slate-500 dark:text-slate-400">
                            {option.description}
                          </span>
                        ) : null}
                      </span>
                      {selected && showSelectedIndicator ? (
                        <Check className="h-4 w-4 shrink-0 text-brand-600 dark:text-brand-300" aria-hidden="true" />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

export function BuilderCombobox({
  id,
  value,
  options,
  onChange,
  onInputChange,
  onKeyDown,
  className,
  placeholder = "Search...",
  disabled,
  allowCustomValue,
  listboxVariant = "popover",
  modalTitle = "Select an option",
  onBlur,
  onFocus,
  controlClassName,
  popoverClassName,
  "aria-label": ariaLabel,
  "data-tutorial-id": tutorialId,
  "data-tutorial-aliases": tutorialAliases,
}: ComboboxProps) {
  const selectedOption = options.find((option) => option.value === value) ?? null;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const queryEditedRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // When the modal picker closes, DialogShell restores focus to the trigger
  // input; without this guard that focus event would immediately reopen it.
  const suppressOpenOnFocusRef = useRef(false);
  const closeListbox = () => {
    if (listboxVariant === "modal") suppressOpenOnFocusRef.current = true;
    setOpen(false);
  };
  const { rootRef, portalRef } = useCloseOnOutsideClick(open, closeListbox);
  const generatedId = useId();
  const listboxId = `${id ?? generatedId}-listbox`;
  const inputValue = open ? query : selectedOption?.label ?? value;

  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return options;
    return options.filter((option) =>
      `${option.label} ${option.value} ${option.description ?? ""}`
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [options, query]);
  const listboxPosition = useFloatingListboxPosition(open, rootRef, filteredOptions.length || 1);

  const chooseOption = (option: BuilderSelectOption) => {
    if (option.disabled) return;
    onChange(option.value);
    setQuery(option.label);
    queryEditedRef.current = false;
    closeListbox();
    if (listboxVariant === "popover") {
      const input = rootRef.current?.querySelector("input");
      if (input && document.activeElement !== input) {
        suppressOpenOnFocusRef.current = true;
        input.focus();
      }
    }
  };

  const commitCustomValue = (rawValue: string) => {
    const trimmed = rawValue.trim();
    const matchingOption = options.find(
      (option) => option.label === trimmed || option.value === trimmed,
    );
    onChange(matchingOption?.value ?? trimmed);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => {
        for (let offset = 1; offset <= filteredOptions.length; offset += 1) {
          const next = (current + direction * offset + filteredOptions.length) % filteredOptions.length;
          if (!filteredOptions[next]?.disabled) return next;
        }
        return -1;
      });
    }
    if (event.key === "Enter" && open) {
      const option = filteredOptions[activeIndex];
      if (option) {
        event.preventDefault();
        chooseOption(option);
        return;
      }
      if (allowCustomValue) {
        event.preventDefault();
        commitCustomValue(query);
        closeListbox();
      }
    }
    if (event.key === "Escape" || event.key === "Tab") {
      if (event.key === "Escape" && open) event.stopPropagation();
      closeListbox();
    }
  };

  return (
    <div ref={rootRef} className={clsx("relative", className)}>
      <input
        id={id}
        data-tutorial-id={tutorialId}
        data-tutorial-aliases={tutorialAliases}
        value={inputValue}
        disabled={disabled}
        aria-label={ariaLabel}
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={open && filteredOptions[activeIndex] ? `${listboxId}-option-${activeIndex}` : undefined}
        onClick={() => {
          // Dismissal can leave focus on the trigger, so a later click must
          // reopen the picker even when no new focus event fires.
          if (!open) {
            suppressOpenOnFocusRef.current = false;
            queryEditedRef.current = false;
            setQuery("");
            setActiveIndex(0);
            setOpen(true);
          }
        }}
        onFocus={(event) => {
          if (suppressOpenOnFocusRef.current) {
            suppressOpenOnFocusRef.current = false;
            onFocus?.(event);
            return;
          }
          queryEditedRef.current = false;
          setQuery("");
          setOpen(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          if (allowCustomValue && queryEditedRef.current && !(listboxVariant === "modal" && open)) {
            commitCustomValue(event.target.value);
          }
          onBlur?.(event);
        }}
        onChange={(event) => {
          queryEditedRef.current = true;
          setQuery(event.target.value);
          onInputChange?.(event.target.value);
          setOpen(true);
          setActiveIndex(0);
        }}
        onKeyDown={(event) => {
          handleKeyDown(event);
          if (!event.defaultPrevented) onKeyDown?.(event);
        }}
        placeholder={placeholder}
        className={cn(controlBaseClass, controlSizeClass, controlClassName, "pr-9")}
      />
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-400">
        <Chevron />
      </span>
      {open && listboxVariant === "modal" ? (
        <PickerModal
          id={id}
          title={modalTitle}
          onClose={closeListbox}
          portalRef={portalRef}
          initialFocusRef={searchInputRef}
        >
          <div className="border-b border-slate-100 p-3 dark:border-slate-800">
            <input
              ref={searchInputRef}
              value={query}
              onChange={(event) => {
                queryEditedRef.current = true;
                setQuery(event.target.value);
                onInputChange?.(event.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              className={cn(controlBaseClass, controlSizeClass, controlClassName)}
            />
          </div>
          <div id={listboxId} className="scrollbar-slim max-h-[56vh] overflow-y-auto py-1" role="listbox" aria-labelledby={id}>
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option, index) => {
                const selected = option.value === value;
                const active = index === activeIndex;
                return (
                  <button
                    key={option.value || `empty-${index}`}
                    type="button"
                    role="option"
                    id={`${listboxId}-option-${index}`}
                    aria-selected={selected}
                        data-active={active || undefined}
                    disabled={option.disabled}
                    className={optionClass(active, selected, option.disabled)}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => chooseOption(option)}
                  >
                    {option.icon ? <span className="shrink-0">{option.icon}</span> : null}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{option.label}</span>
                      {option.description ? (
                        <span className="block truncate text-xs font-normal text-slate-500 dark:text-slate-400">
                          {option.description}
                        </span>
                      ) : null}
                    </span>
                    {selected ? (
                      <Check className="h-4 w-4 shrink-0 text-brand-600 dark:text-brand-300" aria-hidden="true" />
                    ) : null}
                  </button>
                );
              })
            ) : (
              <div className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400">
                No matches
              </div>
            )}
          </div>
        </PickerModal>
      ) : open && listboxPosition
        ? createPortal(
            <div
              ref={portalRef}
              className={clsx(floatingListboxClass, popoverClassName)}
              style={{
                top: listboxPosition.top,
                bottom: listboxPosition.bottom,
                left: listboxPosition.left,
                width: listboxPosition.width,
                maxHeight: listboxPosition.maxHeight,
              }}
              onWheelCapture={(event) => event.stopPropagation()}
              onTouchMoveCapture={(event) => event.stopPropagation()}
            >
              <div id={listboxId} role="listbox" aria-labelledby={id}>
                {filteredOptions.length > 0 ? (
                  filteredOptions.map((option, index) => {
                    const selected = option.value === value;
                    const active = index === activeIndex;
                    return (
                      <button
                        key={option.value || `empty-${index}`}
                        type="button"
                        role="option"
                    id={`${listboxId}-option-${index}`}
                      tabIndex={-1}
                        aria-selected={selected}
                        data-active={active || undefined}
                        disabled={option.disabled}
                        className={optionClass(active, selected, option.disabled)}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => chooseOption(option)}
                      >
                        {option.icon ? <span className="shrink-0">{option.icon}</span> : null}
                        <span className="min-w-0 flex-1">
                        <span className="block truncate">{option.menuLabel ?? option.label}</span>
                          {option.description ? (
                            <span className="block truncate text-xs font-normal text-slate-500 dark:text-slate-400">
                              {option.description}
                            </span>
                          ) : null}
                        </span>
                        {selected ? (
                          <Check className="h-4 w-4 shrink-0 text-brand-600 dark:text-brand-300" aria-hidden="true" />
                        ) : null}
                      </button>
                    );
                  })
                ) : (
                  <div className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400">
                    No matches
                  </div>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

