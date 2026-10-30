import type { BrowserCaptureAsset, BrowserCaptureEvent, BrowserCapturePage, BrowserCaptureStep, BrowserCaptureWarning } from "../../browser-capture/types";

export const CHANNEL = "tourkit-recorder-v1";
export const RRWEB_VERSION = "2.2.0";
export const PRIVATE_SELECTOR = "[data-tourkit-private],[data-private],.rr-block,[data-tourkit-capture-blocked]";
export const MASKED_TEXT_SELECTOR = "[data-tourkit-mask],.rr-mask,[contenteditable]";
export const MAX_RECORDING_BYTES = 40 * 1024 * 1024;
export const MAX_ASSET_BYTES = 2 * 1024 * 1024;
export const MAX_ALL_ASSET_BYTES = 12 * 1024 * 1024;

export interface RecorderSettings {
  screenshots: boolean;
  privateSelector: string;
  advanced: boolean;
}

export interface StoredStep extends Omit<BrowserCaptureStep, "atMs" | "afterMs" | "screenshotAtMs"> {
  at: number;
  afterAt?: number;
  screenshotAt?: number;
}

export interface RecordingSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  status: "recording" | "paused" | "stopped" | "interrupted";
  tabId: number;
  settings: RecorderSettings;
  viewport: { width: number; height: number; devicePixelRatio?: number };
  pages: BrowserCapturePage[];
  steps: StoredStep[];
  warnings: BrowserCaptureWarning[];
  eventCount: number;
  eventBytes: number;
  assetBytes: number;
  screenshotBytes: number;
  lastEventAt?: number;
  lastDocumentId?: string;
  missingAssetOrigins: string[];
  /** Opaque identities of images used in explicitly private regions. */
  blockedResourceKeys?: string[];
}

export interface EventChunk {
  id: string;
  sessionId: string;
  documentId: string;
  events: BrowserCaptureEvent[];
}

export interface StoredAsset extends BrowserCaptureAsset { sessionId: string; bytes: number }
export interface Rect { x: number; y: number; width: number; height: number }
export interface ScreenshotPreparation {
  token: string;
  masks: Rect[];
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
  revision: number;
}

export interface RecorderResponse { ok: boolean; error?: string; [key: string]: unknown }

export function warning(code: string, message: string, stepId?: string): BrowserCaptureWarning {
  return { code, message, ...(stepId ? { stepId } : {}) };
}

export function addWarning(session: RecordingSession, value: BrowserCaptureWarning): void {
  if (!session.warnings.some((item) => item.code === value.code && item.message === value.message && item.stepId === value.stepId)) {
    session.warnings.push(value);
    if (session.warnings.length > 500) session.warnings.splice(0, session.warnings.length - 500);
  }
}
