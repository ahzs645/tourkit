import clsx, { type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * clsx + tailwind-merge: later classes win same-property conflicts
 * (e.g. base "py-4" + override "py-5" → "py-5"), instead of depending on
 * generated stylesheet order. Use for any component that accepts a
 * className override on top of its own base classes.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

