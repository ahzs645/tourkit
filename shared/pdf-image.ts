const PNG_PREFIX = "data:image/png;base64,";
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Give pdfmake a PNG it can embed without decoding it.
 *
 * pdfmake's browser build (0.3.12 onward) inflates a PNG with an alpha channel
 * through fflate's asynchronous API, which starts a Web Worker from a blob URL.
 * Node has no `Worker`, and a strict CSP needs `worker-src blob:`. pdfmake has
 * no option to inflate synchronously, but it copies an opaque, non-interlaced
 * PNG's compressed pixels straight into the PDF.
 *
 * An 8-bit grey+alpha or RGBA PNG is therefore flattened onto white, which is
 * what a viewer shows anyway: every PDF image is drawn on the white page,
 * never over a fill. Fully opaque pixels are unchanged. Each row keeps its
 * original filter, so the result compresses about as well as the source.
 * Anything else (JPEG, opaque or palette PNGs, 16-bit or interlaced PNGs, or
 * data that is not a well-formed PNG) is returned as it was.
 */
export async function pdfReadyImage(dataUrl: string): Promise<string> {
  if (!dataUrl.startsWith(PNG_PREFIX)) return dataUrl;
  try {
    const flattened = await flattenPng(fromBase64(dataUrl.slice(PNG_PREFIX.length)));
    return flattened ? PNG_PREFIX + toBase64(flattened) : dataUrl;
  } catch {
    return dataUrl;
  }
}

async function flattenPng(png: Uint8Array): Promise<Uint8Array | undefined> {
  if (png.length < 33 || PNG_SIGNATURE.some((byte, index) => png[index] !== byte)) return undefined;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let header: Uint8Array | undefined;
  const idat: Uint8Array[] = [];
  for (let offset = 8; offset + 12 <= png.length;) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (data.length !== length) return undefined;
    if (type === "IHDR") header = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  if (!header || header.length !== 13 || !idat.length) return undefined;
  const headerView = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const width = headerView.getUint32(0);
  const height = headerView.getUint32(4);
  const [bitDepth, colorType, , , interlace] = header.subarray(8);
  if (bitDepth !== 8 || (colorType !== 4 && colorType !== 6) || interlace !== 0 || !width || !height) return undefined;

  const channels = colorType === 6 ? 4 : 2;
  const colors = channels - 1;
  const inRow = width * channels;
  const outRow = width * colors;
  const filtered = await transform(concat(idat), new DecompressionStream("deflate"));
  if (filtered.length < height * (inRow + 1)) return undefined;

  const output = new Uint8Array(height * (outRow + 1));
  let previousIn = new Uint8Array(inRow), currentIn = new Uint8Array(inRow);
  let previousOut = new Uint8Array(outRow), currentOut = new Uint8Array(outRow);
  for (let y = 0; y < height; y++) {
    const filter = filtered[y * (inRow + 1)];
    if (filter > 4) return undefined;
    const source = filtered.subarray(y * (inRow + 1) + 1, (y + 1) * (inRow + 1));
    for (let i = 0; i < inRow; i++) {
      currentIn[i] = (source[i] + predict(filter, i >= channels ? currentIn[i - channels] : 0, previousIn[i], i >= channels ? previousIn[i - channels] : 0)) & 0xff;
    }
    for (let x = 0, i = 0, o = 0; x < width; x++, i += channels) {
      const alpha = currentIn[i + colors];
      for (let c = 0; c < colors; c++) currentOut[o++] = alpha === 255 ? currentIn[i + c] : Math.round((currentIn[i + c] * alpha + 255 * (255 - alpha)) / 255);
    }
    const target = y * (outRow + 1);
    output[target] = filter;
    for (let i = 0; i < outRow; i++) {
      output[target + 1 + i] = (currentOut[i] - predict(filter, i >= colors ? currentOut[i - colors] : 0, previousOut[i], i >= colors ? previousOut[i - colors] : 0)) & 0xff;
    }
    [previousIn, currentIn] = [currentIn, previousIn];
    [previousOut, currentOut] = [currentOut, previousOut];
  }

  const flatHeader = header.slice();
  flatHeader[9] = colorType === 6 ? 2 : 0;
  return concat([
    Uint8Array.from(PNG_SIGNATURE),
    chunk("IHDR", flatHeader),
    chunk("IDAT", await transform(output, new CompressionStream("deflate"))),
    chunk("IEND", new Uint8Array()),
  ]);
}

function predict(filter: number, left: number, up: number, upLeft: number) {
  switch (filter) {
    case 1: return left;
    case 2: return up;
    case 3: return (left + up) >> 1;
    case 4: {
      const estimate = left + up - upLeft;
      const toLeft = Math.abs(estimate - left), toUp = Math.abs(estimate - up), toUpLeft = Math.abs(estimate - upLeft);
      return toLeft <= toUp && toLeft <= toUpLeft ? left : toUp <= toUpLeft ? up : upLeft;
    }
    default: return 0;
  }
}

async function transform(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  return new Uint8Array(await new Response(new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(stream)).arrayBuffer());
}

function concat(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

let crcTable: Uint32Array | undefined;
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const result = new Uint8Array(12 + data.length);
  const view = new DataView(result.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) result[4 + i] = type.charCodeAt(i);
  result.set(data, 8);
  view.setUint32(8 + data.length, crc32(result.subarray(4, 8 + data.length)));
  return result;
}

function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
