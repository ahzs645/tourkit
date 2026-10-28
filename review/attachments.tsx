"use client";

import { useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";

import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { CHECKBOX_ROW, CONTROL_FOCUS } from "../ui/control-styles";
import { Modal } from "../ui/modal";
import { reviewId, type ReviewAttachment } from "./model";

import { useReviewEnvironment } from "./environment";

const MAX_SIDE = 1600;
const MAX_PER_ITEM = 4;

/** A picked image, downscaled to a JPEG so a review file stays small. */
async function readPicture(file: File): Promise<Omit<ReviewAttachment, "noPatientData">> {
  if (!/^image\/(png|jpe?g|gif|webp|bmp)$/.test(file.type)) throw new Error("Choose a PNG, JPEG, GIF, WebP or BMP picture.");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return { id: reviewId("picture"), name: file.name.slice(0, 200), image: canvas.toDataURL("image/jpeg", 0.85), width: canvas.width, height: canvas.height };
}

/**
 * Pictures on a feedback item: the real EMR screen next to the emulator, a
 * paper form beside its preview. Each is added only after the reviewer
 * confirms it shows no patient details, because these files are shared.
 */
export function ReviewAttachments({
  attachments,
  editable,
  onChange,
}: {
  attachments: readonly ReviewAttachment[];
  editable: boolean;
  onChange: (attachments: ReviewAttachment[]) => void;
}) {
  const environment = useReviewEnvironment();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Omit<ReviewAttachment, "noPatientData"> | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [viewing, setViewing] = useState<ReviewAttachment | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-1.5">
      {attachments.length ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Pictures">
          {attachments.map((attachment) => (
            <li key={attachment.id} className="relative">
              <button type="button" onClick={() => setViewing(attachment)} className={`block overflow-hidden rounded-md border border-slate-200 dark:border-slate-700 ${CONTROL_FOCUS}`} aria-label={`View picture ${attachment.name}`}>
                <img src={attachment.image} alt={attachment.name} className="h-14 w-20 object-cover" />
              </button>
              {editable ? (
                <button type="button" aria-label={`Remove picture ${attachment.name}`} onClick={() => onChange(attachments.filter((entry) => entry.id !== attachment.id))}
                  className={`absolute -right-1.5 -top-1.5 rounded-full bg-slate-900 p-0.5 text-white ${CONTROL_FOCUS}`}>
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {pending ? (
        <div className="space-y-1.5 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-950 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100" data-testid="review-picture-confirm">
          <img src={pending.image} alt={pending.name} className="max-h-32 w-full rounded-sm object-contain" />
          <p>This picture goes into the review file and to everyone it is shared with.</p>
          <label className={CHECKBOX_ROW}>
            <Checkbox checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            {environment.attachmentConfirmation}
          </label>
          <div className="flex gap-1.5">
            <Button size="sm" variant="primary" disabled={!confirmed} onClick={() => {
              onChange([...attachments, { ...pending, noPatientData: true }]);
              setPending(null);
              setConfirmed(false);
            }}>Add picture</Button>
            <Button size="sm" variant="ghost" onClick={() => { setPending(null); setConfirmed(false); }}>Cancel</Button>
          </div>
        </div>
      ) : editable && attachments.length < MAX_PER_ITEM ? (
        <Button size="sm" variant="ghost" leftIcon={<ImagePlus className="h-3.5 w-3.5" />} onClick={() => inputRef.current?.click()}>
          Add a picture
        </Button>
      ) : null}
      {error ? <p role="alert" className="text-xs text-rose-700 dark:text-rose-300">{error}</p> : null}
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/bmp"
        className="hidden"
        aria-label="Picture file"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          try {
            setPending(await readPicture(file));
            setError(null);
          } catch (readError) {
            setError(readError instanceof Error ? readError.message : "The picture could not be read.");
          }
        }}
      />
      {viewing ? (
        <Modal open onClose={() => setViewing(null)} size="xl">
          <Modal.Header title={viewing.name} />
          <Modal.Body>
              <img src={viewing.image} alt={viewing.name} className="mx-auto max-h-[70vh] w-auto" />
          </Modal.Body>
        </Modal>
      ) : null}
    </div>
  );
}

