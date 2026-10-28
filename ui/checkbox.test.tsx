// @vitest-environment happy-dom
import React, { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { Checkbox } from "./checkbox";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("preserves native label activation, disabled behavior, and indeterminate state through the forwarded ref", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const ref = createRef<HTMLInputElement>();
  const onChange = vi.fn();
  try {
    await act(async () => root.render(<label><Checkbox ref={ref} indeterminate onChange={onChange} />Include field</label>));
    expect(ref.current?.indeterminate).toBe(true);
    await act(async () => host.querySelector("label")?.click());
    expect(ref.current?.checked).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<label><Checkbox ref={ref} disabled indeterminate={false} onChange={onChange} />Include field</label>));
    expect(ref.current?.indeterminate).toBe(false);
    await act(async () => host.querySelector("label")?.click());
    expect(onChange).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

