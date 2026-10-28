"use client";

import { useRef, type ReactNode } from "react";
import type { DialogLayer } from "./dialog-shell";
import { Modal } from "./modal";
import { Button } from "./button";

interface ConfirmDialogProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Use danger styling for destructive confirmations */
  destructive?: boolean;
  loading?: boolean;
  /** Use "nested" when confirming above another open dialog. */
  layer?: DialogLayer;
}

export function ConfirmDialog({
  open,
  onCancel,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  loading = false,
  layer = "dialog"
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  return (
    <Modal
      open={open}
      onClose={onCancel}
      size="sm"
      layer={layer}
      busy={loading}
      initialFocusRef={cancelRef}
    >
      <Modal.Header title={title} description={description} hideClose />
      <Modal.Footer>
        <Button ref={cancelRef} variant="secondary" size="sm" onClick={onCancel} disabled={loading}>
          {cancelLabel}
        </Button>
        <Button
          variant={destructive ? "danger" : "primary"}
          size="sm"
          onClick={onConfirm}
          loading={loading}
        >
          {confirmLabel}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

