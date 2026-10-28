import { useInsertionEffect, useRef } from "react";

/**
 * Returns a ref that always holds the value from the latest committed render.
 *
 * This replaces the `ref.current = value` assignment during render (which
 * `react-hooks/refs` rejects): the write happens in an insertion effect, which
 * React runs before every layout and passive effect of the same commit, so
 * effects, timers, event handlers, and async continuations that read
 * `ref.current` still see the newest value. Like `useStableCallback`, the ref
 * must only be read outside render.
 */
export function useLatestRef<T>(value: T): { readonly current: T } {
  const ref = useRef(value);
  useInsertionEffect(() => {
    ref.current = value;
  });
  return ref;
}

