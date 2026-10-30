import type { BrowserCapturePackage, BrowserCaptureStep, BrowserCaptureTarget, BrowserCaptureEvent, JsonValue } from "../browser-capture/types";

/** Edits preserve the recorded timeline and privacy provenance. */
export function updateCaptureStep(capture: BrowserCapturePackage, id: string, patch: Partial<BrowserCaptureStep>): BrowserCapturePackage {
  return { ...capture, updatedAt: new Date().toISOString(), steps: capture.steps.map((step) => step.id === id ? { ...step, ...patch, id: step.id } : step) };
}

export function moveCaptureStep(capture: BrowserCapturePackage, id: string, direction: -1 | 1): BrowserCapturePackage {
  const from = capture.steps.findIndex((step) => step.id === id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= capture.steps.length) return capture;
  const steps = [...capture.steps];
  [steps[from], steps[to]] = [steps[to]!, steps[from]!];
  return { ...capture, steps, updatedAt: new Date().toISOString() };
}

export function removeCaptureStep(capture: BrowserCapturePackage, id: string): BrowserCapturePackage {
  if (capture.steps.length <= 1) return capture;
  return { ...capture, updatedAt: new Date().toISOString(), steps: capture.steps.filter((step) => step.id !== id), warnings: capture.warnings.filter((warning) => warning.stepId !== id) };
}

export function captureTargetLabel(target?: BrowserCaptureTarget): string {
  return target?.label || target?.selector || (target ? `Element ${target.nodeId}` : "No element selected");
}

export function captureFileName(title: string, suffix: string): string {
  return `${title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "captured-tutorial"}${suffix}`;
}

const record = (value: JsonValue): value is { [key: string]: JsonValue } => Boolean(value && typeof value === "object" && !Array.isArray(value));

/**
 * Replaces a leaf element's captured content within its recording document.
 * This is a data edit, not a promise of comprehensive redaction: screenshots
 * and unrelated copies of the text must be reviewed separately.
 */
export function replaceCaptureTargetText(capture: BrowserCapturePackage, stepId: string, value: string): BrowserCapturePackage {
  const step = capture.steps.find((candidate) => candidate.id === stepId);
  if (!step?.target) throw new Error("Select an element before changing its text.");
  const nodeId = step.target.nodeId;
  const at = capture.events[0]!.timestamp + step.atMs;
  const markers = capture.events.flatMap((event) => event.type === 5 && record(event.data) && event.data.tag === "tourkit-document" && record(event.data.payload) && typeof event.data.payload.documentId === "string" ? [{ timestamp: event.timestamp, documentId: event.data.payload.documentId }] : []);
  const marker = markers.filter((event) => event.timestamp <= at).at(-1);
  const expectedDocument = step.sourceDocumentId ?? step.target.documentId;
  if (marker && expectedDocument && marker.documentId !== expectedDocument) throw new Error("This target belongs to another captured document. Select the correct element before editing its text.");
  // rrweb emits metadata again at periodic checkpoints. Explicit document
  // markers let an edit cover those checkpoints without leaking into a new page.
  const metas = capture.events.filter((event) => event.type === 4);
  const start = marker?.timestamp ?? metas.filter((event) => event.timestamp <= at).at(-1)?.timestamp ?? -Infinity;
  const end = marker ? markers.find((event) => event.timestamp > marker.timestamp && event.documentId !== marker.documentId)?.timestamp ?? Infinity : metas.find((event) => event.timestamp > at)?.timestamp ?? Infinity;
  const textIds = new Set<number>();
  let changed = false;
  let input = false;
  const changeNode = (node: JsonValue): JsonValue => {
    if (!record(node)) return node;
    if (node.id === nodeId && node.type === 2) {
      if (node.tagName === "input") {
        input = true;
        changed = true;
        return { ...node, attributes: { ...(record(node.attributes) ? node.attributes : {}), value } };
      }
      const children = Array.isArray(node.childNodes) ? node.childNodes : [];
      if (children.some((child) => record(child) && child.type === 2)) throw new Error("Choose a text-only element or input. This element contains other controls or markup.");
      let written = false;
      const childNodes = children.map((child) => {
        if (!record(child) || child.type !== 3) return child;
        if (typeof child.id === "number") textIds.add(child.id);
        const textContent = written ? "" : value;
        written = true;
        return { ...child, textContent };
      });
      if (!written) throw new Error("This element has no captured text node. Select a text label or input.");
      changed = true;
      return { ...node, childNodes };
    }
    return Array.isArray(node.childNodes) ? { ...node, childNodes: node.childNodes.map(changeNode) } : node;
  };
  const events = capture.events.map<BrowserCaptureEvent>((event) => {
    if (event.timestamp < start || event.timestamp >= end || !record(event.data)) return event;
    if (event.type === 2) return { ...event, data: { ...event.data, node: changeNode(event.data.node) } };
    return event;
  }).map((event) => {
    if (event.timestamp < start || event.timestamp >= end || event.type !== 3 || !record(event.data)) return event;
    if (event.data.source === 5 && event.data.id === nodeId) return { ...event, data: { ...event.data, text: value } };
    if (event.data.source !== 0) return event;
    const data: { [key: string]: JsonValue } = { ...event.data };
    if (Array.isArray(data.texts)) data.texts = data.texts.map((change) => record(change) && typeof change.id === "number" && textIds.has(change.id) ? { ...change, value } : change);
    if (Array.isArray(data.attributes) && input) data.attributes = data.attributes.map((change) => record(change) && change.id === nodeId && record(change.attributes) && "value" in change.attributes ? { ...change, attributes: { ...change.attributes, value } } : change);
    return { ...event, data };
  });
  if (!changed) throw new Error("This element is introduced by a later mutation. Re-record this screen or choose an element in its starting snapshot.");
  return {
    ...capture, events, updatedAt: new Date().toISOString(), privacy: { ...capture.privacy, mode: "unreviewed" },
    warnings: [...capture.warnings.filter((warning) => !(warning.code === "edited-interface-screenshots" && warning.stepId === step.id)), { code: "edited-interface-screenshots", message: "Interface text was edited. Screenshots and other copies of the original text require separate review.", stepId: step.id }],
  };
}

export function downloadCaptureFile(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
