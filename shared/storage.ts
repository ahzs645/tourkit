/** A namespace separates app/user preferences on the same origin. It is not an access-control boundary. */
export interface TutorialStorageOptions {
  namespace?: string;
  storage?: () => Storage | null;
}

/** The prefix of every key written without a namespace. */
export const TOURKIT_STORAGE_PREFIX = "tourkit:";

export function tutorialStorageKey(name: string, namespace?: string): string {
  if (namespace === undefined) return `${TOURKIT_STORAGE_PREFIX}${name}`;
  if (!namespace.trim()) throw new Error("A tutorial storage namespace must not be empty.");
  return `${encodeURIComponent(namespace)}:tutorial:${name}`;
}

export function browserTutorialStorage(kind: "localStorage" | "sessionStorage"): Storage | null {
  try { return typeof window === "undefined" ? null : globalThis[kind]; }
  catch { return null; }
}

const CHANGE_EVENT = "tourkit:storage-change";
interface StorageChange { key: string; storage: Storage; source: object }

/** Notify both same-document consumers and other documents sharing this storage. */
export function createTutorialStorageChannel(getStorage: () => Storage | null, matches: (key: string | null) => boolean) {
  const source = {};
  const listeners = new Set<() => void>();
  const readStorage = () => { try { return getStorage(); } catch { return null; } };
  const emit = () => { for (const listener of [...listeners]) listener(); };
  return {
    storage: readStorage,
    notify(key: string, storage: Storage) {
      emit();
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<StorageChange>(CHANGE_EVENT, { detail: { key, storage, source } }));
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      if (typeof window === "undefined") return () => { listeners.delete(listener); };
      const sameDocument = (event: Event) => {
        const detail = (event as CustomEvent<StorageChange>).detail;
        if (detail?.source !== source && detail?.storage === readStorage() && matches(detail.key)) listener();
      };
      const otherDocument = (event: StorageEvent) => {
        if ((!event.storageArea || event.storageArea === readStorage()) && matches(event.key)) listener();
      };
      window.addEventListener(CHANGE_EVENT, sameDocument);
      window.addEventListener("storage", otherDocument);
      return () => {
        listeners.delete(listener);
        window.removeEventListener(CHANGE_EVENT, sameDocument);
        window.removeEventListener("storage", otherDocument);
      };
    },
  };
}
