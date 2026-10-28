import { mergeReviewBundles, parseReviewBundle, type ReviewFeedbackBundle, type ReviewSubjectKind } from "./model";
import { resolveReviewStorage, type ReviewStorageSource } from "./review-storage";

export interface ReviewInboxState {
  bundles: Partial<Record<ReviewSubjectKind, ReviewFeedbackBundle>>;
  open: readonly ReviewSubjectKind[] | null;
}
export interface ReviewInboxStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): ReviewInboxState;
  getServerSnapshot(): ReviewInboxState;
  set(kind: ReviewSubjectKind, bundle: ReviewFeedbackBundle | null): void;
  open(kinds: readonly ReviewSubjectKind[] | null): void;
  import(incoming: ReviewFeedbackBundle, options?: { open?: readonly ReviewSubjectKind[] }): void;
}
const emptyBundles = (): ReviewInboxState["bundles"] => Object.create(null);
const SERVER_STATE: ReviewInboxState = { bundles: emptyBundles(), open: null };

/** One review per subject kind, isolated by app/user namespace. No application singleton. */
export function createReviewInboxStore(options: {
  namespace?: string;
  kinds?: readonly ReviewSubjectKind[];
  storage?: ReviewStorageSource;
  /** Supply only when preserving an application's historical keys. */
  storageKey?: (kind: ReviewSubjectKind) => string;
} = {}): ReviewInboxStore {
  const namespace = options.namespace ?? "tourkit-review";
  if (!namespace.trim()) throw new Error("A review inbox namespace must not be empty.");
  const keyOf = options.storageKey ?? ((kind: string) => `${encodeURIComponent(namespace)}:inbox:${encodeURIComponent(kind)}`);
  const knownKinds = new Set<ReviewSubjectKind>(options.kinds ?? ["tutorial"]);
  const listeners = new Set<() => void>();
  const unpersisted = new Set<ReviewSubjectKind>();
  const read = (kind: ReviewSubjectKind): ReviewFeedbackBundle | undefined => {
    try {
      const text = resolveReviewStorage(options.storage)?.getItem(keyOf(kind));
      const bundle = text ? parseReviewBundle(JSON.parse(text)) : undefined;
      return bundle?.form.kind === kind ? bundle : undefined;
    } catch { return undefined; }
  };
  let state: ReviewInboxState = { bundles: Object.assign(emptyBundles(), Object.fromEntries([...knownKinds].map((kind) => [kind, read(kind)]))), open: null };
  const emit = (next: ReviewInboxState) => { state = next; listeners.forEach((listener) => listener()); };
  const persist = (kind: ReviewSubjectKind, bundle: ReviewFeedbackBundle | null): boolean => {
    const storage = resolveReviewStorage(options.storage);
    if (!storage) return false;
    try {
      if (bundle) storage?.setItem(keyOf(kind), JSON.stringify(bundle));
      else storage.removeItem(keyOf(kind));
      return true;
    } catch {
      try {
        if (bundle) { storage.setItem(keyOf(kind), JSON.stringify({ ...bundle, snapshots: [] })); return true; }
      } catch { /* Keep this visit's state. */ }
      return false;
    }
  };
  const refresh = (kinds: Iterable<ReviewSubjectKind>) => {
    if (!resolveReviewStorage(options.storage)) return;
    const bundles = Object.assign(emptyBundles(), state.bundles);
    let changed = false;
    for (const kind of kinds) {
      if (unpersisted.has(kind)) continue;
      const incoming = read(kind);
      if (JSON.stringify(incoming) !== JSON.stringify(bundles[kind])) { bundles[kind] = incoming; changed = true; }
    }
    if (changed) emit({ ...state, bundles });
  };
  const onStorage = (event: StorageEvent) => {
    const storage = resolveReviewStorage(options.storage);
    if (event.storageArea && storage && event.storageArea !== storage) return;
    refresh([...knownKinds].filter((kind) => event.key === null || keyOf(kind) === event.key));
  };
  const store: ReviewInboxStore = {
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) {
        // Covers SSR hydration as well as writes while no inbox was mounted.
        refresh(knownKinds);
        if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size && typeof window !== "undefined") window.removeEventListener("storage", onStorage);
      };
    },
    getSnapshot: () => state,
    getServerSnapshot: () => SERVER_STATE,
    set(kind, bundle) {
      if (bundle && bundle.form.kind !== kind) throw new Error("A review cannot be stored under a different subject kind.");
      knownKinds.add(kind);
      if (persist(kind, bundle)) unpersisted.delete(kind);
      else unpersisted.add(kind);
      emit({ ...state, bundles: Object.assign(emptyBundles(), state.bundles, { [kind]: bundle ?? undefined }) });
    },
    open(kinds) {
      for (const kind of kinds ?? []) {
        if (!knownKinds.has(kind)) { knownKinds.add(kind); refresh([kind]); }
      }
      emit({ ...state, open: kinds });
    },
    import(incoming, importOptions = {}) {
      const kind = incoming.form.kind;
      const current = state.bundles[kind];
      const same = current && current.form.name === incoming.form.name && current.form.id === incoming.form.id;
      store.set(kind, same ? mergeReviewBundles(current, incoming) : incoming);
      if (importOptions.open) store.open(importOptions.open);
    },
  };
  return store;
}
