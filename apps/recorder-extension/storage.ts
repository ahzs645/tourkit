import { parseBrowserCapture } from "../../browser-capture/index";
import { DEFAULT_BROWSER_CAPTURE_LIMITS, type BrowserCapturePackage, type BrowserCaptureEvent } from "../../browser-capture/types";
import { MAX_RECORDING_BYTES, MAX_ALL_ASSET_BYTES, RRWEB_VERSION, addWarning, type EventChunk, type RecordingSession, type StoredAsset } from "./protocol";

export const DATABASE_NAME = "tourkit-browser-recorder-v1";
let openPromise: Promise<IDBDatabase> | undefined;

function database(): Promise<IDBDatabase> {
  openPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore("sessions", { keyPath: "id" });
      db.createObjectStore("chunks", { keyPath: "id" }).createIndex("sessionId", "sessionId");
      db.createObjectStore("assets", { keyPath: "id" }).createIndex("sessionId", "sessionId");
    };
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); openPromise = undefined; }; resolve(request.result); };
    request.onerror = () => { openPromise = undefined; reject(request.error); };
  });
  return openPromise;
}

async function read<T>(storeName: string, key?: IDBValidKey, index?: string): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readonly");
    const store = transaction.objectStore(storeName);
    const request = index ? store.index(index).getAll(key) : key === undefined ? store.getAll() : store.get(key);
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error);
  });
}

export const getSession = (id: string): Promise<RecordingSession | undefined> => read("sessions", id);
export async function listSessions(): Promise<RecordingSession[]> {
  return (await read<RecordingSession[]>("sessions")).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function putSession(session: RecordingSession): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("sessions", "readwrite");
    transaction.objectStore("sessions").put(session);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("Recording write was aborted."));
  });
}

/** Mutate synchronously inside one transaction: overlapping chunks cannot overwrite steps. */
export async function updateSession(id: string, update: (session: RecordingSession) => void): Promise<RecordingSession> {
  const db = await database();
  return new Promise((resolve, reject) => {
    let result: RecordingSession;
    const transaction = db.transaction("sessions", "readwrite");
    const store = transaction.objectStore("sessions");
    const request = store.get(id);
    request.onsuccess = () => {
      if (!request.result) { transaction.abort(); return; }
      result = request.result as RecordingSession;
      try { update(result); result.updatedAt = new Date().toISOString(); store.put(result); }
      catch (error) { transaction.abort(); reject(error); }
    };
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("Recording no longer exists."));
  });
}

export async function appendChunk(chunk: EventChunk): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["sessions", "chunks"], "readwrite");
    const chunks = transaction.objectStore("chunks");
    const sessions = transaction.objectStore("sessions");
    const prior = chunks.get(chunk.id);
    prior.onsuccess = () => {
      if (prior.result) return; // An acknowledged message may be retried after reconnecting.
      const request = sessions.get(chunk.sessionId);
      request.onsuccess = () => {
        const session = request.result as RecordingSession | undefined;
        if (!session) { transaction.abort(); return; }
        const bytes = JSON.stringify(chunk.events).length * 2;
        // Reserve one event for the final checkpoint appended at export time.
        if (session.eventCount + chunk.events.length >= DEFAULT_BROWSER_CAPTURE_LIMITS.maxEvents) {
          transaction.abort(); reject(new Error("Recording reached the portable format's event limit. Stop and export this recording before continuing in a new recording.")); return;
        }
        if (session.eventBytes + bytes > MAX_RECORDING_BYTES) {
          transaction.abort(); reject(new Error("Recording reached the 40 MiB event limit. Stop and export this recording.")); return;
        }
        session.eventBytes += bytes;
        session.eventCount += chunk.events.length;
        session.lastEventAt = Math.max(session.lastEventAt ?? 0, ...chunk.events.map((event) => event.timestamp));
        session.updatedAt = new Date().toISOString();
        chunks.put(chunk);
        sessions.put(session);
      };
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("Recording chunk was not saved."));
  });
}

export async function putAsset(asset: StoredAsset): Promise<boolean> {
  const db = await database();
  return new Promise((resolve, reject) => {
    let inserted = false;
    const transaction = db.transaction(["assets", "sessions"], "readwrite");
    const store = transaction.objectStore("assets");
    const prior = store.get(asset.id);
    prior.onsuccess = () => {
      if (prior.result) return;
      const sessions = transaction.objectStore("sessions");
      const request = sessions.get(asset.sessionId);
      request.onsuccess = () => {
        if (!request.result) return;
        const session = request.result as RecordingSession;
        if (session.blockedResourceKeys?.includes(asset.url)) return;
        if (session.assetBytes + asset.bytes > MAX_ALL_ASSET_BYTES) {
          addWarning(session, { code: "asset-limit", message: "The asset bundle reached 12 MiB. Some resources were omitted; check offline replay before publishing." });
          sessions.put(session); return;
        }
        session.assetBytes += asset.bytes;
        store.put(asset); sessions.put(session); inserted = true;
      };
    };
    transaction.oncomplete = () => resolve(inserted);
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function deleteSession(id: string): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["sessions", "chunks", "assets"], "readwrite");
    transaction.objectStore("sessions").delete(id);
    for (const name of ["chunks", "assets"]) {
      const request = transaction.objectStore(name).index("sessionId").openKeyCursor(IDBKeyRange.only(id));
      request.onsuccess = () => { const cursor = request.result; if (cursor) { transaction.objectStore(name).delete(cursor.primaryKey); cursor.continue(); } };
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function sessionCapture(id: string): Promise<BrowserCapturePackage> {
  const session = await getSession(id);
  if (!session) throw new Error("Recording no longer exists.");
  const [chunks, assets] = await Promise.all([
    read<EventChunk[]>("chunks", id, "sessionId"), read<StoredAsset[]>("assets", id, "sessionId"),
  ]);
  const events: BrowserCaptureEvent[] = chunks.flatMap((chunk) => chunk.events).sort((a, b) => a.timestamp - b.timestamp);
  if (!events.some((event) => event.type === 2)) throw new Error("This recording has no complete interface snapshot yet. Resume it on the page, then stop again.");
  const firstAt = events[0].timestamp;
  let lastAt = events.at(-1)?.timestamp ?? firstAt;
  const latestStepAt = Math.max(firstAt, ...session.steps.map((step) => Math.max(step.at, step.afterAt ?? step.at, step.screenshotAt ?? step.at)));
  if (lastAt < latestStepAt) { lastAt = latestStepAt; events.push({ type: 5, timestamp: lastAt, data: { tag: "tourkit-checkpoint", payload: {} } }); }
  const steps = session.steps.filter((step) => step.at >= firstAt).sort((a, b) => a.at - b.at).map(({ at, afterAt, screenshotAt, ...step }) => ({
    ...step, atMs: at - firstAt,
    ...(afterAt !== undefined ? { afterMs: Math.max(at, afterAt) - firstAt } : {}),
    ...(screenshotAt !== undefined ? { screenshotAtMs: screenshotAt - firstAt } : {}),
  }));
  if (!steps.length) steps.push({ id: crypto.randomUUID(), title: "Explore this screen", instruction: "Review the captured interface, then continue.", action: "continue", atMs: 0 });
  if (session.status === "recording") addWarning(session, { code: "recording-in-progress", message: "This export is a checkpoint of an active recording. Stop before publishing the complete tutorial." });
  return parseBrowserCapture({
    format: "tourkit-browser-capture", version: 1, id: session.id, title: session.title,
    createdAt: session.createdAt, updatedAt: session.updatedAt,
    engine: { name: "rrweb", version: RRWEB_VERSION }, viewport: session.viewport,
    privacy: { mode: "masked", notes: "Inputs, marked private elements and opaque frames were masked. Visible page text and image contents still require review before sharing. No cookies or authorization headers are exported." },
    pages: session.pages, events, steps,
    assets: assets.filter((asset) => !session.blockedResourceKeys?.includes(asset.url)).map(({ sessionId: _sessionId, bytes: _bytes, ...asset }) => asset), warnings: session.warnings,
  });
}
