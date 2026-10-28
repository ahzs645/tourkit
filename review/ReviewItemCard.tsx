"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { X } from "lucide-react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { CONTROL_FOCUS } from "../ui/control-styles";
import { ReviewAttachments } from "./attachments";
import { personLabel, type ReviewItem, type ReviewPerson, type updateReviewItem } from "./model";

const CARD_WIDTH = 288;
const KIND_LABEL: Record<ReviewItem["kind"], string> = { comment: "Comment", sticky: "Note", drawing: "Drawing" };

/**
 * One feedback item, opened from its pin, note or drawing. The text is
 * editable while the item's round is the open one; earlier rounds take
 * replies, so a later round answers without rewriting what was said.
 */
export function ReviewItemCard({
  item,
  number,
  x,
  y,
  bounds,
  currentRound,
  author,
  partLabel = "part",
  onChange,
  onReply,
  onDelete,
  onReattach,
  onClose,
}: {
  item: ReviewItem;
  number: string;
  x: number;
  y: number;
  bounds: { width: number; height: number } | null;
  currentRound: number;
  author?: ReviewPerson;
  partLabel?: string;
  onChange: (patch: Parameters<typeof updateReviewItem>[2]) => void;
  onReply: (text: string) => void;
  onDelete: () => void;
  /** Pick another field for this item to belong to. */
  onReattach: () => void;
  onClose: () => void;
}) {
  const [reply, setReply] = useState("");
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardHeight, setCardHeight] = useState(320);
  const editable = item.round === currentRound;
  const width = bounds?.width ?? 1200;
  const cardWidth = Math.min(CARD_WIDTH, Math.max(160, width - 16));
  const maxHeight = Math.max(160, (bounds?.height ?? 900) - 16);
  const left = Math.max(8, Math.min(x + 16, width - cardWidth - 8));
  const top = Math.max(8, Math.min(y + 12, (bounds?.height ?? 900) - Math.min(cardHeight, maxHeight) - 8));
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const measure = () => { const height = card.getBoundingClientRect().height; if (height > 0) setCardHeight(height); };
    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(card);
    return () => observer?.disconnect();
  }, []);
  const sendReply = () => {
    if (!reply.trim()) return;
    onReply(reply);
    setReply("");
  };

  return (
    <div
      ref={cardRef}
      role="dialog"
      aria-label={`Feedback ${number}`}
      className="pointer-events-auto absolute z-10 space-y-2 overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-800 shadow-xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      style={{ left, top, width: cardWidth, maxHeight }}
      data-testid="review-item-card"
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white" style={{ background: item.color }}>{number}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{item.anchor.fieldLabel || item.page}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {KIND_LABEL[item.kind]} · {item.page} · {personLabel(item.author)} · round {item.round}
          </p>
        </div>
        <Button size="sm" variant="ghost" iconOnly aria-label="Close" leftIcon={<X className="h-4 w-4" />} onClick={onClose} />
      </div>

      <p className="flex items-center gap-1.5 rounded-md bg-sky-50 px-2 py-1 text-xs text-sky-900 dark:bg-sky-500/10 dark:text-sky-100">
        <span className="min-w-0 flex-1 truncate">
          {item.anchor.attribute ? <>Tied to <b>{item.anchor.fieldLabel || `a ${partLabel}`}</b></> : `Not tied to a ${partLabel}`}
        </span>
        <button type="button" onClick={onReattach} className={`shrink-0 font-medium underline decoration-dotted underline-offset-2 ${CONTROL_FOCUS}`}>
          {item.anchor.attribute ? "Change" : `Pick a ${partLabel}`}
        </button>
      </p>

      {editable ? (
        <Textarea
          autoFocus={!item.text}
          rows={3}
          value={item.text}
          aria-label="Feedback text"
          placeholder={item.kind === "drawing" ? "Say what the drawing points at (optional)" : "What should change?"}
          onChange={(event) => onChange({ text: event.target.value })}
        />
      ) : item.text ? (
        <p className="whitespace-pre-wrap">{item.text}</p>
      ) : null}

      <ReviewAttachments attachments={item.attachments} editable={editable} onChange={(attachments) => onChange({ attachments })} />

      {item.replies.length ? (
        <ul className="space-y-1.5 border-l-2 border-slate-200 pl-2 dark:border-slate-700">
          {item.replies.map((entry) => (
            <li key={entry.id}>
              <p className="text-xs text-slate-500 dark:text-slate-400">{personLabel(entry.author)} · round {entry.round}</p>
              <p className="whitespace-pre-wrap">{entry.text}</p>
            </li>
          ))}
        </ul>
      ) : null}

      {!editable || item.replies.length || item.text ? (
        <div className="flex gap-1.5">
          <Input
            value={reply}
            placeholder={author ? `Reply as ${personLabel(author)}` : "Reply"}
            aria-label="Reply"
            onChange={(event) => setReply(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") sendReply(); }}
          />
          <Button size="sm" variant="secondary" onClick={sendReply} disabled={!reply.trim()}>Reply</Button>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2 pt-1">
        <Button size="sm" variant={item.status === "resolved" ? "secondary" : "success"} onClick={() => onChange({ status: item.status === "resolved" ? "open" : "resolved" })}>
          {item.status === "resolved" ? "Reopen" : "Resolve"}
        </Button>
        {editable ? <Button size="sm" variant="danger" onClick={onDelete}>Delete</Button> : null}
      </div>
    </div>
  );
}

