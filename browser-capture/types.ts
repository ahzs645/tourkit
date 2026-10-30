import type { TutorialScreenshot } from "../core/screenshot";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** The engine payload is intentionally opaque to consumers of the portable format. */
export interface BrowserCaptureEvent {
  type: number;
  timestamp: number;
  data: JsonValue;
}

export interface BrowserCaptureTarget {
  nodeId: number;
  /** Recording document identity, not a CSS frame selector. */
  documentId?: string;
  selector?: string;
  label?: string;
}

export type BrowserCaptureAction = "click" | "input" | "change" | "scroll" | "navigate" | "continue";

export interface BrowserCaptureStep {
  id: string;
  title: string;
  instruction: string;
  /** Milliseconds from the first event, immediately before the expected action. */
  atMs: number;
  /** Optional resulting state, useful for the final action in a recording. */
  afterMs?: number;
  action: BrowserCaptureAction;
  target?: BrowserCaptureTarget;
  sourceDocumentId?: string;
  screenshot?: TutorialScreenshot;
  /** Makes a screenshot taken after an action distinguishable from its starting state. */
  screenshotAtMs?: number;
  /** Optional authored required answer; observed/masked recorder values are not criteria. */
  value?: string;
  disabled?: boolean;
}

export interface BrowserCaptureAsset {
  id: string;
  /** Captured resource identifier. The player never fetches this URL. */
  url: string;
  mime: string;
  dataUrl: string;
}

export interface BrowserCaptureWarning {
  code: string;
  message: string;
  stepId?: string;
}

export interface BrowserCapturePage {
  id: string;
  origin: string;
  /** Query and fragment are deliberately excluded from source metadata. */
  path: string;
}

export interface BrowserCapturePackage {
  format: "tourkit-browser-capture";
  version: 1;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  engine: { name: "rrweb"; version: string };
  viewport: { width: number; height: number; devicePixelRatio?: number };
  /** Masked does not mean synthetic, anonymous, or safe to publish. */
  privacy: { mode: "masked" | "reviewed" | "unreviewed"; notes?: string };
  pages?: BrowserCapturePage[];
  events: BrowserCaptureEvent[];
  steps: BrowserCaptureStep[];
  assets?: BrowserCaptureAsset[];
  warnings: BrowserCaptureWarning[];
}

export interface BrowserCaptureLimits {
  maxBytes: number;
  maxEvents: number;
  maxSteps: number;
  maxAssets: number;
  maxDepth: number;
  maxNodes: number;
}

export const DEFAULT_BROWSER_CAPTURE_LIMITS: Readonly<BrowserCaptureLimits> = Object.freeze({
  maxBytes: 64 * 1024 * 1024,
  maxEvents: 200_000,
  maxSteps: 2_000,
  maxAssets: 2_000,
  maxDepth: 160,
  maxNodes: 1_000_000,
});
