"use client";

import { forwardRef, type ReactNode } from "react";
import { Button, type ButtonProps } from "./button";

export interface IconButtonProps extends Omit<ButtonProps, "iconOnly" | "leftIcon" | "rightIcon" | "children"> {
  icon: ReactNode;
  /** Accessible name — required, since the button renders no text. */
  "aria-label": string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, variant = "ghost", size = "sm", ...rest },
  ref
) {
  return (
    <Button ref={ref} iconOnly variant={variant} size={size} leftIcon={icon} {...rest} />
  );
});

