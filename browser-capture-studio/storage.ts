import type { BrowserCapturePackage } from "../browser-capture/types";
import { parseBrowserCapture } from "../browser-capture/validation";

const DATABASE = "tourkit-capture-studio";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("This browser does not provide local draft storage.")); return; }
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("drafts", { keyPath: "id" });
      request.result.createObjectStore("metadata");
    };
    request.onerror = () => reject(request.error ?? new Error("Local draft storage could not open."));
    request.onsuccess = () => resolve(request.result);
  });
}

export async function saveCaptureStudioDraft(capture: BrowserCapturePackage): Promise<void> {
  const validated = parseBrowserCapture(capture);
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(["drafts", "metadata"], "readwrite");
    transaction.objectStore("drafts").put(validated);
    transaction.objectStore("metadata").put(validated.id, "last-draft");
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error ?? new Error("Local draft storage is unavailable or full.")); };
    transaction.onabort = () => { database.close(); reject(transaction.error ?? new Error("Saving this draft was interrupted.")); };
  });
}

export async function readCaptureStudioDraft(id?: string): Promise<BrowserCapturePackage | null> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(["drafts", "metadata"], "readonly");
    let result: BrowserCapturePackage | null = null;
    let failure: unknown;
    const read = (key: string) => {
      const request = transaction.objectStore("drafts").get(key);
      request.onsuccess = () => { if (request.result) { try { result = parseBrowserCapture(request.result); } catch (error) { failure = error; } } };
    };
    if (id) read(id);
    else {
      const request = transaction.objectStore("metadata").get("last-draft");
      request.onsuccess = () => { if (typeof request.result === "string") read(request.result); };
    }
    transaction.oncomplete = () => { database.close(); if (failure) reject(failure); else resolve(result); };
    transaction.onerror = () => { database.close(); reject(transaction.error ?? new Error("Saved edits could not be loaded.")); };
  });
}
