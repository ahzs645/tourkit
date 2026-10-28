"use client";

import { useRef, type CSSProperties } from "react";
import { ResizeHandle } from "./resize-handle";
export type PanelSide = "left" | "right";

interface PanelResizeHandleProps {
  label: string;
  side: PanelSide;
  width: number;
  min: number;
  max: number;
  onResize: (width: number) => void;
  style: CSSProperties;
}

export function PanelResizeHandle({ label, side, width, min, max, onResize, style }: PanelResizeHandleProps) {
  const drag = useRef<{ pointerId: number; x: number; width: number } | null>(null);
  const grow = side === "left" ? 1 : -1;
  const resize = (next: number) => onResize(Math.min(max, Math.max(min, Math.round(next))));

  return (
    <ResizeHandle
      aria-label={`Resize ${label} panel`}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width}
      aria-valuetext={`${width} pixels`}
      title={`Drag to resize ${label} panel, or use the arrow keys`}
      className="absolute inset-y-0 z-20 hidden lg:flex"
      style={style}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointerId: event.pointerId, x: event.clientX, width };
      }}
      onPointerMove={(event) => {
        if (drag.current?.pointerId !== event.pointerId) return;
        resize(drag.current.width + grow * (event.clientX - drag.current.x));
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointerId !== event.pointerId) return;
        drag.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => { drag.current = null; }}
      onLostPointerCapture={() => { drag.current = null; }}
      onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        if (event.key === "Home") resize(min);
        else if (event.key === "End") resize(max);
        else resize(width + (event.key === "ArrowRight" ? 20 : -20) * grow);
      }}
    />
  );
}

