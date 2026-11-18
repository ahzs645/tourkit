import { describe, expect, it } from "vitest";
import { deflateSync, inflateSync } from "node:zlib";
import { pdfReadyImage } from "./pdf-image";

const PREFIX = "data:image/png;base64,";

function chunk(type: string, bytes: Buffer) {
  const payload = Buffer.concat([Buffer.from(type), bytes]);
  let crc = 0xffffffff;
  for (const byte of payload) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const header = Buffer.alloc(4); header.writeUInt32BE(bytes.length);
  const footer = Buffer.alloc(4); footer.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([header, payload, footer]);
}

const paeth = (a: number, b: number, c: number) => {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};
const predictor = [() => 0, (a: number) => a, (_: number, b: number) => b, (a: number, b: number) => (a + b) >> 1, paeth];

/** Encode raw rows with the given filter per row, independently of the code under test. */
function png(width: number, colorType: number, rows: number[][], filters: number[], extra: Buffer[] = []) {
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType]!;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(rows.length, 4); header[8] = 8; header[9] = colorType;
  const data: number[] = [];
  rows.forEach((row, y) => {
    data.push(filters[y]);
    row.forEach((value, i) => {
      const a = i >= channels ? row[i - channels] : 0, b = y ? rows[y - 1][i] : 0, c = y && i >= channels ? rows[y - 1][i - channels] : 0;
      data.push((value - predictor[filters[y]](a, b, c)) & 0xff);
    });
  });
  const file = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", header), ...extra, chunk("IDAT", deflateSync(Buffer.from(data))), chunk("IEND", Buffer.alloc(0))]);
  return PREFIX + file.toString("base64");
}

/** Read a PNG back to colour type and unfiltered rows, checking every chunk's CRC. */
function decode(dataUrl: string) {
  const file = Buffer.from(dataUrl.slice(PREFIX.length), "base64");
  expect(file.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  const chunks: { type: string; data: Buffer }[] = [];
  for (let offset = 8; offset < file.length;) {
    const length = file.readUInt32BE(offset);
    const type = file.subarray(offset + 4, offset + 8).toString("latin1");
    const data = file.subarray(offset + 8, offset + 8 + length);
    expect(chunk(type, data).equals(file.subarray(offset, offset + 12 + length))).toBe(true);
    chunks.push({ type, data });
    offset += 12 + length;
  }
  const ihdr = chunks[0].data;
  const width = ihdr.readUInt32BE(0), height = ihdr.readUInt32BE(4), colorType = ihdr[9];
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType]!;
  const filtered = inflateSync(Buffer.concat(chunks.filter((entry) => entry.type === "IDAT").map((entry) => entry.data)));
  const rows: number[][] = [];
  const filters: number[] = [];
  for (let y = 0; y < height; y++) {
    const start = y * (width * channels + 1);
    filters.push(filtered[start]);
    const row: number[] = [];
    for (let i = 0; i < width * channels; i++) {
      const a = i >= channels ? row[i - channels] : 0, b = y ? rows[y - 1][i] : 0, c = y && i >= channels ? rows[y - 1][i - channels] : 0;
      row.push((filtered[start + 1 + i] + predictor[filtered[start]](a, b, c)) & 0xff);
    }
    rows.push(row);
  }
  return { types: chunks.map((entry) => entry.type), bitDepth: ihdr[8], colorType, interlace: ihdr[12], width, height, rows, filters };
}

describe("PNG images for pdfmake", () => {
  it("flattens a translucent RGBA PNG onto white and keeps opaque pixels and each row's filter", async () => {
    const rows = [
      [10, 20, 30, 255, 200, 100, 50, 0, 0, 0, 0, 128],
      [40, 50, 60, 255, 41, 52, 63, 255, 255, 255, 255, 255],
      [1, 2, 3, 255, 100, 150, 200, 64, 7, 8, 9, 255],
      [90, 80, 70, 255, 91, 79, 72, 255, 0, 255, 0, 200],
      [5, 5, 5, 255, 250, 250, 250, 1, 128, 64, 32, 255],
    ];
    const result = decode(await pdfReadyImage(png(3, 6, rows, [0, 1, 2, 3, 4])));
    expect(result).toMatchObject({ types: ["IHDR", "IDAT", "IEND"], bitDepth: 8, colorType: 2, interlace: 0, width: 3, height: 5, filters: [0, 1, 2, 3, 4] });
    const white = (value: number, alpha: number) => Math.round((value * alpha + 255 * (255 - alpha)) / 255);
    expect(result.rows).toEqual(rows.map((row) => Array.from({ length: 3 }, (_, x) => [0, 1, 2].map((c) => white(row[x * 4 + c], row[x * 4 + 3]))).flat()));
    expect(result.rows[0]).toEqual([10, 20, 30, 255, 255, 255, 127, 127, 127]);
  });

  it("flattens grey with alpha to grey", async () => {
    const result = decode(await pdfReadyImage(png(2, 4, [[0, 255, 0, 0], [100, 128, 200, 255]], [4, 1])));
    expect(result).toMatchObject({ colorType: 0, filters: [4, 1], rows: [[0, 255], [177, 200]] });
  });

  it("returns images pdfmake already embeds without decoding unchanged", async () => {
    const opaque = png(2, 2, [[1, 2, 3, 4, 5, 6]], [1]);
    const grey = png(1, 0, [[9]], [0]);
    const sixteenBit = PREFIX + Buffer.from(Buffer.from(png(1, 6, [[1, 2, 3, 4]], [0]).slice(PREFIX.length), "base64").map((byte, index) => index === 24 ? 16 : byte)).toString("base64");
    const jpeg = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2Q==";
    const notPng = PREFIX + Buffer.from("not an image").toString("base64");
    for (const image of [opaque, grey, sixteenBit, jpeg, notPng]) expect(await pdfReadyImage(image)).toBe(image);
  });
});
