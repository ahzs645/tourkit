import { parseReviewBundle, type ReviewFeedbackBundle, type ReviewPerson } from "./model";

export type ReviewKeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type ReviewStorageSource = ReviewKeyValueStorage | null | (() => ReviewKeyValueStorage | null);
export interface ReviewStorageSubject {
  kind: string;
  subjectId?: string;
  name: string;
  target: string;
}
export interface ReviewBrowserStorage {
  personKey: string;
  reviewKey(subject: ReviewStorageSubject): string;
  readStoredPerson(): ReviewPerson;
  storePerson(person: ReviewPerson): void;
  readStoredReview(key: string): ReviewFeedbackBundle | null;
  storeReview(key: string, bundle: ReviewFeedbackBundle): void;
}

/** Read lazily: storage may be absent during SSR, blocked, or injected by a host. */
export function resolveReviewStorage(source?: ReviewStorageSource): ReviewKeyValueStorage | null {
  try {
    return typeof source === "function" ? source() : source === undefined
      ? (typeof localStorage === "undefined" ? null : localStorage) : source;
  } catch { return null; }
}

/** A private reviewer identity and in-progress review namespace, independent of the inbox. */
export function createReviewStorage(options: {
  namespace?: string;
  storage?: ReviewStorageSource;
  /** Compatibility hooks for consumers retaining existing keys. */
  personKey?: string;
  reviewKey?: (subject: ReviewStorageSubject) => string;
} = {}): ReviewBrowserStorage {
  const namespace = options.namespace ?? "tourkit-review";
  if (!namespace.trim()) throw new Error("A review storage namespace must not be empty.");
  const prefix = encodeURIComponent(namespace);
  const personKey = options.personKey ?? `${prefix}:person`;
  return {
    personKey,
    reviewKey: options.reviewKey ?? ((subject) => `${prefix}:review:${[subject.kind, subject.subjectId ?? subject.name, subject.target].map(encodeURIComponent).join(":")}`),
    readStoredPerson() {
      try {
        const value = JSON.parse(resolveReviewStorage(options.storage)?.getItem(personKey) ?? "{}");
        return { name: typeof value?.name === "string" ? value.name : undefined, role: typeof value?.role === "string" ? value.role : undefined };
      } catch { return {}; }
    },
    storePerson(person) {
      try { resolveReviewStorage(options.storage)?.setItem(personKey, JSON.stringify(person)); } catch { /* Optional browser persistence. */ }
    },
    readStoredReview(key) {
      try {
        const text = resolveReviewStorage(options.storage)?.getItem(key);
        return text ? parseReviewBundle(JSON.parse(text)) : null;
      } catch { return null; }
    },
    storeReview(key, bundle) {
      const storage = resolveReviewStorage(options.storage);
      try { storage?.setItem(key, JSON.stringify(bundle)); }
      catch {
        // Pictures can exceed a browser quota; preserve the comments and replies.
        try { storage?.setItem(key, JSON.stringify({ ...bundle, snapshots: [] })); } catch { /* The current visit keeps its copy. */ }
      }
    },
  };
}

/** A smoothed SVG path through drawing points offset by (x, y). */
export function drawingPath(points: ReadonlyArray<readonly [number, number]>, x: number, y: number): string {
  if (!points.length) return "";
  let path = `M${x + points[0][0]} ${y + points[0][1]}`;
  for (let index = 1; index < points.length; index += 1) {
    const [px, py] = points[index - 1];
    const [qx, qy] = points[index];
    path += ` Q${x + px} ${y + py} ${x + (px + qx) / 2} ${y + (py + qy) / 2}`;
  }
  return path;
}
