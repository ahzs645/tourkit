"use client";

import {
  cloneElement,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import clsx from "clsx";

type Placement = "top" | "bottom" | "left" | "right";

interface TooltipProps {
  content: ReactNode;
  placement?: Placement;
  children: ReactElement<{
    onMouseEnter?: (event: React.MouseEvent) => void;
    onMouseLeave?: (event: React.MouseEvent) => void;
    onFocus?: (event: React.FocusEvent) => void;
    onBlur?: (event: React.FocusEvent) => void;
    "aria-describedby"?: string;
    "aria-disabled"?: boolean | "true" | "false";
    disabled?: boolean;
    style?: CSSProperties;
  }>;
  delay?: number;
  className?: string;
  /**
   * Keep the text on one line. Only for short, unbreakable content (a code or
   * keyboard shortcut); everything else wraps at the shared width.
   */
  nowrap?: boolean;
  /** @deprecated Tooltips wrap by default now; this has no effect. */
  multiline?: boolean;
  /** Extra classes for the wrapper span, e.g. to let the trigger flex/truncate. */
  wrapperClassName?: string;
  /**
   * Retained for compatibility with existing call sites. Radix renders tooltip
   * content in a portal by default, so false keeps the same visual behavior.
   */
  portal?: boolean;
}

// One width for every tooltip: short labels stay on a single line (w-max
// shrinks to the text), longer explanations wrap at 240px instead of running
// across the screen. Callers should not pass their own width classes.
const WRAP_CLASS = "w-max max-w-[240px] whitespace-normal wrap-break-word text-left leading-snug";
const NOWRAP_CLASS = "whitespace-nowrap";

// Above every dialog layer (dialog 400, nested 600) — tooltips are transient
// hover overlays triggered from inside those surfaces, so nothing should
// cover them except critical dialogs.
const BUBBLE_BASE_CLASS =
  "z-700 rounded-md bg-slate-900 px-2 py-1 text-2xs font-medium text-white " +
  "shadow-lg animate-fade-in dark:bg-slate-100 dark:text-slate-900";

const ORIGIN_CLASS_BY_PLACEMENT: Record<Placement, string> = {
  top: "origin-bottom",
  bottom: "origin-top",
  left: "origin-right",
  right: "origin-left"
};

/**
 * Radix-backed hover/focus tooltip. Wrap a single child.
 * Native disabled controls are wrapped so the tooltip can still explain why
 * the control is unavailable while preserving the disabled element semantics.
 */
export function Tooltip({
  content,
  placement = "top",
  children,
  delay = 250,
  className,
  nowrap = false,
  wrapperClassName,
}: TooltipProps) {
  // Radix mounts a Root/Popper stack per tooltip; screens like the builder
  // canvas render ~1000 of them, so stay a bare span until the first
  // pointer-enter/focus and only then mount the Radix machinery.
  const [mountedBy, setMountedBy] = useState<"pointer" | "focus" | null>(null);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const enterPointRef = useRef<{ x: number; y: number } | null>(null);
  // The activating event predates the Radix trigger, so replay it after the
  // swap: re-focus the recreated control (the remount drops keyboard focus;
  // Radix then opens instantly, as it always does on focus), or re-send the
  // pointer position so Radix starts its usual hover-delay timer.
  useEffect(() => {
    if (!mountedBy) return;
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    if (mountedBy === "focus") {
      if (wrapper.contains(document.activeElement)) return;
      wrapper
        .querySelector<HTMLElement>("a,button,input,select,textarea,[tabindex]")
        ?.focus();
      return;
    }
    const point = enterPointRef.current;
    if (!point || !wrapper.matches(":hover")) return;
    wrapper.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        clientX: point.x,
        clientY: point.y,
        pointerType: "mouse",
      })
    );
  }, [mountedBy]);
  const hasContent =
    content !== null &&
    content !== undefined &&
    !(typeof content === "string" && content.trim() === "");

  if (!isValidElement(children) || !hasContent) {
    return <>{children}</>;
  }

  const childDisabled =
    children.props.disabled === true ||
    children.props["aria-disabled"] === true ||
    children.props["aria-disabled"] === "true";

  const trigger = childDisabled
    ? cloneElement(children, {
        style: { ...children.props.style, pointerEvents: "none" }
      })
    : children;

  const widthClass = nowrap ? NOWRAP_CLASS : WRAP_CLASS;

  if (!mountedBy) {
    return (
      <span
        className={clsx("inline-flex", wrapperClassName)}
        onPointerEnter={(event) => {
          enterPointRef.current = { x: event.clientX, y: event.clientY };
          // Pointer-enter is a continuous event, so React would normally batch
          // this swap into a later frame — which can land between a fast
          // click's pointerdown and pointerup and silently drop the click.
          // Remounting synchronously keeps the whole gesture on one element.
          flushSync(() => setMountedBy("pointer"));
        }}
        onFocus={() => setMountedBy("focus")}
      >
        {trigger}
      </span>
    );
  }

  return (
    // Focus already happened by the time the Radix trigger exists, so replay
    // its instant-open; pointer entry keeps the hover delay via pointer-move.
    <TooltipPrimitive.Root delayDuration={delay} defaultOpen={mountedBy === "focus"}>
      <TooltipPrimitive.Trigger asChild>
        <span ref={wrapperRef} className={clsx("inline-flex", wrapperClassName)}>
          {trigger}
        </span>
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={placement}
          sideOffset={6}
          collisionPadding={8}
          className={clsx(BUBBLE_BASE_CLASS, ORIGIN_CLASS_BY_PLACEMENT[placement], widthClass, className)}
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-slate-900 dark:fill-slate-100" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

