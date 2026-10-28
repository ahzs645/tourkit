import { z } from "zod";

/**
 * Reviewer feedback on a host-defined surface (the review's `form.kind`). Comments
 * pinned to elements, sticky notes and freehand drawings, gathered in
 * numbered review rounds. Each surface supplies what is surface-specific
 * (what a pin attaches to, what a "page" is, what a part's fingerprint is)
 * through a ReviewSurface (components/review-feedback/surfaces.ts).
 *
 * A bundle travels as a file, never in a URL: the reviewer downloads it (a
 * ZIP, a self-contained HTML page or a PDF), the author drops it on the
 * builder, and either side can open it again to add to the same round or
 * start the next one. Nothing here is part of the form or any export target.
 *
 * Every item is anchored to the preview element of a field (its `data-*`
 * attribute and value), with an offset from that element's top-left corner,
 * so it follows the field through scrolling, re-layout and paging: a field
 * that is not on screen (another page, another section, hidden by logic)
 * hides its feedback too. An item placed away from any field anchors to the
 * nearest one. See review/README.md.
 */

export const REVIEW_FEEDBACK_FORMAT = "tourkit-review-feedback";
/** Format names written before the kit was published as Tourkit. Still read; never written. */
export const LEGACY_REVIEW_FEEDBACK_FORMATS = ["webforms-review-feedback"] as const;
const READABLE_REVIEW_FEEDBACK_FORMATS: readonly unknown[] = [REVIEW_FEEDBACK_FORMAT, ...LEGACY_REVIEW_FEEDBACK_FORMATS];
export const REVIEW_FEEDBACK_VERSION = 1;

/** The preview attributes a form field's rendered element carries, most specific first. */
export const REVIEW_ANCHOR_ATTRIBUTES = [
  "data-field-id",
  "data-source-field-id",
  "data-alayacare-field-id",
  "data-iview-row",
] as const;
/** Tutorials and the EMR emulators name their elements with tutorial anchors. */
export const TUTORIAL_ANCHOR_ATTRIBUTE = "data-tutorial-id";
/** Any `data-*` attribute a surface anchors to. */
export type ReviewAnchorAttribute = string;

/** What was reviewed. Files written before kinds existed are form reviews. */
export const REVIEW_SUBJECT_KINDS = ["form", "tutorial", "emr"] as const;
/** Built-in kinds retain their names; other hosts can use a stable lowercase subject id. */
export type ReviewSubjectKind = (typeof REVIEW_SUBJECT_KINDS)[number] | (string & {});

const PersonSchema = z.object({
  name: z.string().max(120).optional(),
  role: z.string().max(120).optional(),
});
export type ReviewPerson = z.infer<typeof PersonSchema>;

const AnchorSchema = z.object({
  /** Null when nothing on the page was near: the item is placed on the view itself. */
  attribute: z.string().regex(/^data-[a-z0-9-]+$/).nullable(),
  value: z.string().nullable(),
  /**
   * The reviewed part the item is about, when known: a builder field (form),
   * a tutorial step, an emulator screen. Its fingerprint says whether the part
   * changed after the review.
   */
  fieldId: z.string().nullable(),
  /** Label of what the item is tied to, shown in lists and exports. */
  fieldLabel: z.string().nullable(),
  /** CSS pixels from the anchor element's (or the preview's) top-left corner. */
  dx: z.number(),
  dy: z.number(),
});
export type ReviewAnchor = z.infer<typeof AnchorSchema>;

const ReplySchema = z.object({
  id: z.string(),
  round: z.number().int().positive(),
  author: PersonSchema.optional(),
  text: z.string(),
  createdAt: z.string(),
});
export type ReviewReply = z.infer<typeof ReplySchema>;

export const REVIEW_COLORS = ["#dc2626", "#2563eb", "#16a34a", "#111827", "#ca8a04"] as const;

/**
 * A picture the reviewer added (the real EMR screen, a paper form). Only
 * accepted once they confirm it shows no patient details.
 */
const AttachmentSchema = z.object({
  id: z.string(),
  name: z.string().max(200),
  /** JPEG or PNG data URL, downscaled on the way in. */
  image: z.string().regex(/^data:image\/(jpeg|png);base64,/),
  width: z.number(),
  height: z.number(),
  noPatientData: z.literal(true),
});
export type ReviewAttachment = z.infer<typeof AttachmentSchema>;

const ItemSchema = z.object({
  id: z.string(),
  kind: z.enum(["comment", "sticky", "drawing"]),
  round: z.number().int().positive(),
  author: PersonSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  anchor: AnchorSchema,
  /** Where the item was made: the page or section label of its field. */
  page: z.string(),
  text: z.string().default(""),
  color: z.string().default(REVIEW_COLORS[0]),
  /** Drawing points, relative to the anchor origin. */
  points: z.array(z.tuple([z.number(), z.number()])).optional(),
  status: z.enum(["open", "resolved"]).default("open"),
  replies: z.array(ReplySchema).default([]),
  attachments: z.array(AttachmentSchema).default([]),
  /** The part's fingerprint when the item was made (see reviewItemState). */
  fieldFingerprint: z.string().nullable().default(null),
  deleted: z.boolean().optional(),
});
export type ReviewItem = z.infer<typeof ItemSchema>;

const RoundSchema = z.object({
  number: z.number().int().positive(),
  startedAt: z.string(),
  closedAt: z.string().nullable().default(null),
  reviewer: PersonSchema.optional(),
});
export type ReviewRound = z.infer<typeof RoundSchema>;

const SnapshotSchema = z.object({
  page: z.string(),
  round: z.number().int().positive(),
  /** JPEG data URL of the preview, overlay excluded. */
  image: z.string(),
  width: z.number(),
  height: z.number(),
  capturedAt: z.string(),
  /** Each item's anchor origin in snapshot pixels at capture time. */
  placements: z.record(z.string(), z.tuple([z.number(), z.number()])),
});
export type ReviewSnapshot = z.infer<typeof SnapshotSchema>;

export const ReviewFeedbackBundleSchema = z.object({
  format: z.enum([REVIEW_FEEDBACK_FORMAT, ...LEGACY_REVIEW_FEEDBACK_FORMATS]).transform(() => REVIEW_FEEDBACK_FORMAT),
  version: z.literal(REVIEW_FEEDBACK_VERSION),
  /** The reviewed subject (named `form` from when only forms were reviewed). */
  form: z.object({
    kind: z.string().min(1).max(80).regex(/^[a-z][a-z0-9._-]*$/).default("form"),
    /** Stable id of the subject: a tutorial id, an emulator id. */
    id: z.string().optional(),
    name: z.string(),
    /** Form: the share-link preview target (for example a renderer id); tutorial: its mode; emulator: its host id. */
    target: z.string(),
    /** The link that opens the reviewed subject, to continue the review. */
    shareUrl: z.string().nullable(),
    /** Part id → fingerprint when the review started (form fields, tutorial steps, emulator screens). */
    fields: z.record(z.string(), z.object({ label: z.string(), fingerprint: z.string() })),
  }),
  rounds: z.array(RoundSchema).min(1),
  items: z.array(ItemSchema),
  snapshots: z.array(SnapshotSchema).default([]),
  updatedAt: z.string(),
});
export type ReviewFeedbackBundle = z.infer<typeof ReviewFeedbackBundleSchema>;

/**
 * A reviewed part and what a reviewer saw of it: a builder field (type,
 * label, answers), a tutorial step (its text and target), an emulator screen.
 */
export interface ReviewableField {
  id: string;
  label?: string;
  type: string;
  options?: unknown;
}

const now = () => new Date().toISOString();
export const reviewId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** FNV-1a over the field's type, label and answer labels: changes when what a reviewer saw changes. */
export function reviewFieldFingerprint(field: ReviewableField): string {
  const options = Array.isArray(field.options)
    ? field.options.map((option) => (typeof option === "string" ? option : String((option as { label?: unknown })?.label ?? ""))).join("|")
    : "";
  const text = `${field.type}\u0000${field.label ?? ""}\u0000${options}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function createReviewBundle(input: {
  kind?: ReviewSubjectKind;
  subjectId?: string;
  formName: string;
  target: string;
  shareUrl: string | null;
  fields: readonly ReviewableField[];
  reviewer?: ReviewPerson;
}): ReviewFeedbackBundle {
  const at = now();
  return {
    format: REVIEW_FEEDBACK_FORMAT,
    version: REVIEW_FEEDBACK_VERSION,
    form: {
      kind: input.kind ?? "form",
      ...(input.subjectId ? { id: input.subjectId } : {}),
      name: input.formName,
      target: input.target,
      shareUrl: input.shareUrl,
      fields: Object.fromEntries(input.fields.map((field) => [field.id, { label: field.label ?? field.id, fingerprint: reviewFieldFingerprint(field) }])),
    },
    rounds: [{ number: 1, startedAt: at, closedAt: null, ...(hasPerson(input.reviewer) ? { reviewer: input.reviewer } : {}) }],
    items: [],
    snapshots: [],
    updatedAt: at,
  };
}

export const hasPerson = (person?: ReviewPerson | null): person is ReviewPerson =>
  Boolean(person?.name?.trim() || person?.role?.trim());

export function personLabel(person?: ReviewPerson | null): string {
  if (!hasPerson(person)) return "Anonymous";
  return [person.name?.trim(), person.role?.trim()].filter(Boolean).join(", ");
}

export function currentRound(bundle: ReviewFeedbackBundle): ReviewRound {
  return bundle.rounds[bundle.rounds.length - 1];
}

/** Items still in the bundle (deleted ones are kept as tombstones so merges don't revive them). */
export const liveItems = (bundle: ReviewFeedbackBundle) => bundle.items.filter((item) => !item.deleted);

/** Close the current round and open the next one. */
export function startNextRound(bundle: ReviewFeedbackBundle, reviewer?: ReviewPerson): ReviewFeedbackBundle {
  const at = now();
  const last = currentRound(bundle);
  return {
    ...bundle,
    rounds: [
      ...bundle.rounds.slice(0, -1),
      { ...last, closedAt: last.closedAt ?? at },
      { number: last.number + 1, startedAt: at, closedAt: null, ...(hasPerson(reviewer) ? { reviewer } : {}) },
    ],
    updatedAt: at,
  };
}

/** Record who is reviewing the open round. */
export function setRoundReviewer(bundle: ReviewFeedbackBundle, reviewer: ReviewPerson): ReviewFeedbackBundle {
  const last = currentRound(bundle);
  const rounds = [...bundle.rounds.slice(0, -1), { ...last, reviewer: hasPerson(reviewer) ? reviewer : undefined }];
  return { ...bundle, rounds, updatedAt: now() };
}

export function addReviewItem(
  bundle: ReviewFeedbackBundle,
  item: Omit<ReviewItem, "id" | "round" | "createdAt" | "updatedAt" | "status" | "replies" | "attachments" | "fieldFingerprint"> & { id?: string },
): { bundle: ReviewFeedbackBundle; item: ReviewItem } {
  const at = now();
  const fieldId = item.anchor.fieldId;
  const created: ReviewItem = {
    status: "open",
    replies: [],
    attachments: [],
    ...item,
    id: item.id ?? reviewId(item.kind),
    round: currentRound(bundle).number,
    createdAt: at,
    updatedAt: at,
    fieldFingerprint: fieldId ? bundle.form.fields[fieldId]?.fingerprint ?? null : null,
  };
  return { bundle: { ...bundle, items: [...bundle.items, created], updatedAt: at }, item: created };
}

export function updateReviewItem(
  bundle: ReviewFeedbackBundle,
  id: string,
  patch: Partial<Pick<ReviewItem, "text" | "color" | "status" | "anchor" | "points" | "page" | "deleted" | "attachments">>,
): ReviewFeedbackBundle {
  const at = now();
  return {
    ...bundle,
    items: bundle.items.map((item) => (item.id === id ? { ...item, ...patch, updatedAt: at } : item)),
    updatedAt: at,
  };
}

export function deleteReviewItem(bundle: ReviewFeedbackBundle, id: string): ReviewFeedbackBundle {
  return updateReviewItem(bundle, id, { deleted: true, text: "", points: undefined, attachments: [] });
}

/** How each kind of subject names its parts in lists ("Field changed since", "Step changed since"). */
export const REVIEW_PART_NOUN: Record<ReviewSubjectKind, { one: string; changed: string; removed: string }> = {
  form: { one: "field", changed: "Field changed since", removed: "Field no longer on the form" },
  tutorial: { one: "step", changed: "Step changed since", removed: "Step no longer in the tutorial" },
  emr: { one: "screen", changed: "Screen changed since", removed: "Screen no longer in the emulator" },
};

/** A file-friendly default title; UI hosts can override their labels through the environment. */
export function reviewSubjectTitle(kind: ReviewSubjectKind): string {
  return kind === "emr" ? "EMR emulator" : kind.replace(/[._-]+/g, " ").replace(/^./, (character) => character.toUpperCase());
}

export function addReviewReply(bundle: ReviewFeedbackBundle, id: string, text: string, author?: ReviewPerson): ReviewFeedbackBundle {
  const at = now();
  const reply: ReviewReply = { id: reviewId("reply"), round: currentRound(bundle).number, text, createdAt: at, ...(hasPerson(author) ? { author } : {}) };
  return {
    ...bundle,
    items: bundle.items.map((item) => (item.id === id ? { ...item, replies: [...item.replies, reply], updatedAt: at } : item)),
    updatedAt: at,
  };
}

/** Keep one snapshot per page and round: the latest capture wins. */
export function putReviewSnapshot(bundle: ReviewFeedbackBundle, snapshot: ReviewSnapshot): ReviewFeedbackBundle {
  const snapshots = bundle.snapshots.filter((entry) => !(entry.page === snapshot.page && entry.round === snapshot.round));
  return { ...bundle, snapshots: [...snapshots, snapshot] };
}

/**
 * Combine two copies of the same review (the author's and a reviewer's
 * returned file): rounds by number, items and replies by id, the most
 * recently updated copy of an item winning (the incoming one on a tie); a
 * deletion is kept.
 */
export function mergeReviewBundles(base: ReviewFeedbackBundle, incoming: ReviewFeedbackBundle): ReviewFeedbackBundle {
  const rounds = new Map(base.rounds.map((round) => [round.number, round]));
  for (const round of incoming.rounds) {
    const existing = rounds.get(round.number);
    rounds.set(round.number, existing
      ? { ...existing, closedAt: existing.closedAt ?? round.closedAt, reviewer: existing.reviewer ?? round.reviewer }
      : round);
  }
  const items = new Map(base.items.map((item) => [item.id, item]));
  for (const item of incoming.items) {
    const existing = items.get(item.id);
    if (!existing) { items.set(item.id, item); continue; }
    // The incoming copy wins a tie: it is the file someone just sent back.
    const newer = item.updatedAt >= existing.updatedAt ? item : existing;
    const replies = new Map([...existing.replies, ...item.replies].map((reply) => [reply.id, reply]));
    items.set(item.id, {
      ...newer,
      deleted: existing.deleted || item.deleted || undefined,
      replies: [...replies.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    });
  }
  const snapshots = new Map(base.snapshots.map((snapshot) => [`${snapshot.round}\u0000${snapshot.page}`, snapshot]));
  for (const snapshot of incoming.snapshots) {
    const key = `${snapshot.round}\u0000${snapshot.page}`;
    const existing = snapshots.get(key);
    if (!existing || snapshot.capturedAt > existing.capturedAt) snapshots.set(key, snapshot);
  }
  return {
    ...base,
    form: { ...base.form, shareUrl: base.form.shareUrl ?? incoming.form.shareUrl, fields: { ...incoming.form.fields, ...base.form.fields } },
    rounds: [...rounds.values()].sort((a, b) => a.number - b.number),
    items: [...items.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    snapshots: [...snapshots.values()],
    updatedAt: base.updatedAt > incoming.updatedAt ? base.updatedAt : incoming.updatedAt,
  };
}

export type ReviewItemState = "current" | "changed" | "removed" | "unanchored";

/** Whether an item's field still looks as it did when the item was made, against the form now. */
export function reviewItemState(item: ReviewItem, fields: ReadonlyMap<string, ReviewableField>): ReviewItemState {
  const fieldId = item.anchor.fieldId;
  if (!fieldId) return "unanchored";
  const field = fields.get(fieldId);
  if (!field) return "removed";
  if (item.fieldFingerprint && reviewFieldFingerprint(field) !== item.fieldFingerprint) return "changed";
  return "current";
}

/** Validate a bundle read from a file; throws a readable error. */
export function parseReviewBundle(value: unknown): ReviewFeedbackBundle {
  const result = ReviewFeedbackBundleSchema.safeParse(value);
  if (!result.success) throw new Error("This file is not a review feedback file, or it is from a newer version.");
  return result.data;
}

export function isReviewBundleLike(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && READABLE_REVIEW_FEEDBACK_FORMATS.includes((value as { format?: unknown }).format));
}

/** Items in reading order: by round, then page, then position on the page. */
export function orderedReviewItems(bundle: ReviewFeedbackBundle): ReviewItem[] {
  return liveItems(bundle).slice().sort((a, b) => a.round - b.round || a.createdAt.localeCompare(b.createdAt));
}

/** Short reference ("2.3": round 2, third item) shown on pins, lists and exports. */
export function reviewItemNumbers(bundle: ReviewFeedbackBundle): Map<string, string> {
  const counters = new Map<number, number>();
  const numbers = new Map<string, string>();
  for (const item of orderedReviewItems(bundle)) {
    const next = (counters.get(item.round) ?? 0) + 1;
    counters.set(item.round, next);
    numbers.set(item.id, `${item.round}.${next}`);
  }
  return numbers;
}

