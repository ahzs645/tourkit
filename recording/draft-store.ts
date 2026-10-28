import type { TutorialRecordingDraft } from "./types";

export interface TutorialDraftSummary {
  id: string;
  title: string;
  updatedAt: string;
  description?: string;
  createdAt?: string;
  stepCount?: number;
  /** The launch path, which names the stage (workspace or a host emulator). */
  launchPath?: string;
  hasAudio?: boolean;
}

/** Card-sized facts about a draft, so a list never has to hold the audio Blobs. */
export function summarizeTutorialDraft(draft: TutorialRecordingDraft): TutorialDraftSummary {
  return {
    id: draft.id,
    title: draft.title,
    updatedAt: draft.updatedAt,
    description: draft.description,
    createdAt: draft.createdAt,
    stepCount: draft.steps.length,
    launchPath: draft.launch.path,
    hasAudio: Boolean(draft.audio),
  };
}

export interface TutorialDraftStore {
  get(id: string): Promise<TutorialRecordingDraft | undefined>;
  put(draft: TutorialRecordingDraft): Promise<void>;
  delete(id: string): Promise<void>;
  list(): Promise<TutorialDraftSummary[]>;
}

export class MemoryTutorialDraftStore implements TutorialDraftStore {
  private readonly drafts = new Map<string, TutorialRecordingDraft>();

  async get(id: string): Promise<TutorialRecordingDraft | undefined> {
    return this.drafts.get(id);
  }

  async put(draft: TutorialRecordingDraft): Promise<void> {
    this.drafts.set(draft.id, draft);
  }

  async delete(id: string): Promise<void> {
    this.drafts.delete(id);
  }

  async list(): Promise<TutorialDraftSummary[]> {
    return [...this.drafts.values()]
      .map(summarizeTutorialDraft)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }
}

/** IndexedDB keeps the audio Blob out of localStorage and supports offline PWA authoring. */
export class IndexedDbTutorialDraftStore implements TutorialDraftStore {
  constructor(
    private readonly databaseName = "tourkit-studio",
    private readonly storeName = "drafts"
  ) {}

  async get(id: string): Promise<TutorialRecordingDraft | undefined> {
    return this.request("readonly", (store) => store.get(id));
  }

  async put(draft: TutorialRecordingDraft): Promise<void> {
    await this.request("readwrite", (store) => store.put(draft));
  }

  async delete(id: string): Promise<void> {
    await this.request("readwrite", (store) => store.delete(id));
  }

  async list(): Promise<TutorialDraftSummary[]> {
    const drafts = await this.request<TutorialRecordingDraft[]>("readonly", (store) => store.getAll());
    return drafts
      .map(summarizeTutorialDraft)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  private async request<T>(
    mode: IDBTransactionMode,
    makeRequest: (store: IDBObjectStore) => IDBRequest<T>
  ): Promise<T> {
    const database = await this.open();
    return new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(this.storeName, mode);
      const request = makeRequest(transaction.objectStore(this.storeName));
      let result: T;
      let requestSucceeded = false;
      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        database.close();
        reject(error);
      };
      request.onsuccess = () => {
        result = request.result;
        requestSucceeded = true;
      };
      request.onerror = () => fail(request.error ?? new Error("Tutorial draft storage failed."));
      transaction.oncomplete = () => {
        if (settled) return;
        settled = true;
        database.close();
        if (requestSucceeded) resolve(result);
        else reject(new Error("Tutorial draft transaction completed without a result."));
      };
      transaction.onerror = () => fail(
        transaction.error ?? new Error("Tutorial draft transaction failed."),
      );
      transaction.onabort = () => fail(
        transaction.error ?? new Error("Tutorial draft transaction was aborted."),
      );
    });
  }

  private open(): Promise<IDBDatabase> {
    if (typeof indexedDB === "undefined") {
      return Promise.reject(new Error("IndexedDB is unavailable in this browser."));
    }
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(this.storeName)) {
          database.createObjectStore(this.storeName, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Could not open tutorial draft storage."));
    });
  }
}

export function createDefaultTutorialDraftStore(options: { databaseName?: string; storeName?: string } = {}): TutorialDraftStore {
  return typeof indexedDB === "undefined"
    ? new MemoryTutorialDraftStore()
    : new IndexedDbTutorialDraftStore(options.databaseName, options.storeName);
}

