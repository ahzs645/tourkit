import { DEFAULT_BROWSER_CAPTURE_LIMITS, type BrowserCapturePackage } from "./types";
import { parseBrowserCapture, serializeBrowserCapture } from "./validation";

const captureFilename = "capture.json";
const archiveReadme = "TourKit browser capture v1\nOpen capture.json or this ZIP in TourKit Capture Studio.\nThe recording contains reconstructed interface states, not the original application's executable backend.\nPrivacy labels describe capture/review status; they are not a certification that content is synthetic or anonymous.\n";

export async function exportBrowserCaptureZip(capture: BrowserCapturePackage): Promise<Blob> {
  const json = serializeBrowserCapture(capture);
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  zip.file(captureFilename, json);
  zip.file("README.txt", archiveReadme);
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
  return new Blob([new Uint8Array(bytes)], { type: "application/zip" });
}

/** Names and declared expansion sizes are inspected before any decompression. */
function inspectZip(bytes: Uint8Array): Map<string, { size: number; crc: number }> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65_557); at--) {
    if (view.getUint32(at, true) === 0x06054b50 && at + 22 + view.getUint16(at + 20, true) === bytes.length) { end = at; break; }
  }
  if (end < 0) throw new Error("Capture ZIP has no valid central directory.");
  if (view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0) throw new Error("Split ZIP archives are not supported.");
  const count = view.getUint16(end + 10, true);
  const centralSize = view.getUint32(end + 12, true);
  const centralOffset = view.getUint32(end + 16, true);
  if (count < 1 || count > 2 || centralOffset + centralSize !== end) throw new Error("Capture ZIP must contain capture.json and an optional README.txt.");
  const files = new Map<string, { size: number; crc: number }>();
  let cursor = centralOffset;
  let total = 0;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50) throw new Error("Malformed ZIP directory.");
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const length = 46 + nameLength + extraLength + commentLength;
    if (cursor + length > end || (flags & 1) || ![0, 8].includes(method)) throw new Error("Unsupported or malformed capture ZIP.");
    const name = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    if (![captureFilename, "README.txt"].includes(name) || files.has(name)) throw new Error("Unexpected or duplicate file in capture ZIP.");
    total += size;
    if (total > DEFAULT_BROWSER_CAPTURE_LIMITS.maxBytes || size === 0xffffffff) throw new Error("Expanded capture ZIP exceeds the size limit.");
    files.set(name, { size, crc: view.getUint32(cursor + 16, true) });
    cursor += length;
  }
  if (cursor !== end || !files.has(captureFilename)) throw new Error("Capture ZIP is missing capture.json.");
  return files;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export async function importBrowserCapture(input: string | Blob | ArrayBuffer | Uint8Array): Promise<BrowserCapturePackage> {
  if (typeof input === "string") return parseBrowserCapture(input);
  if (input instanceof Blob && input.size > DEFAULT_BROWSER_CAPTURE_LIMITS.maxBytes) throw new Error("Capture exceeds the size limit.");
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input instanceof Blob ? await input.arrayBuffer() : input);
  if (bytes.length > DEFAULT_BROWSER_CAPTURE_LIMITS.maxBytes) throw new Error("Capture exceeds the size limit.");
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return parseBrowserCapture(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  const directory = inspectZip(bytes);
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(bytes, { createFolders: false, checkCRC32: false });
  const file = zip.file(captureFilename);
  if (!file) throw new Error("Capture ZIP is missing capture.json.");
  const expected = directory.get(captureFilename)!;
  // Bounded streaming also catches archives that lie about their uncompressed size.
  const expanded = await new Promise<Uint8Array>((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let length = 0;
    let stopped = false;
    // JSZip 3.10 exposes this method at runtime but omits it on JSZipObject's types.
    const stream = (file as typeof file & { internalStream(type: "uint8array"): import("jszip").JSZipStreamHelper<Uint8Array> }).internalStream("uint8array");
    stream.on("data", (chunk: Uint8Array) => {
      if (stopped) return;
      length += chunk.length;
      if (length > expected.size || length > DEFAULT_BROWSER_CAPTURE_LIMITS.maxBytes) {
        stopped = true; stream.pause(); reject(new Error("Expanded capture ZIP exceeds its declared size.")); return;
      }
      chunks.push(chunk);
    }).on("error", reject).on("end", () => {
      if (stopped) return;
      if (length !== expected.size) { reject(new Error("Capture ZIP size does not match its directory.")); return; }
      const output = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
      if (crc32(output) !== expected.crc) { reject(new Error("Capture ZIP failed its integrity check.")); return; }
      resolve(output);
    }).resume();
  });
  return parseBrowserCapture(new TextDecoder("utf-8", { fatal: true }).decode(expanded));
}

export const createCaptureZip = exportBrowserCaptureZip;
