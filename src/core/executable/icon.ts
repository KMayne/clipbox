/**
 * Icon resources: reassembles an RT_GROUP_ICON into a `.ico` file, and turns one icon image into
 * a PNG (PNG-compressed icons as they are; BMP DIBs decoded and re-encoded here, so it runs in the
 * worker and in Node without a canvas).
 */

import { zlibSync } from 'fflate';
import { isPngData } from './pe';
import { FormatError, Reader } from './reader';

const MAX_SIDE = 1024;

let crcTable: Uint32Array | null = null;
function crc32(b: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = (crcTable[(c ^ (b[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** An 8-bit RGBA PNG. */
export function encodePng(
  width: number,
  height: number,
  rgba: Uint8Array,
): Uint8Array<ArrayBuffer> {
  if (rgba.length !== width * height * 4) throw new Error('pixel data does not match the size');
  const stride = width * 4 + 1;
  const raw = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++)
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * stride + 1);
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return concat([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlibSync(raw)),
    pngChunk('IEND', new Uint8Array(0)),
  ]);
}

/** Decodes an icon's BMP DIB (colour bitmap plus AND mask) to RGBA. */
export function decodeDib(bytes: Uint8Array<ArrayBuffer>): {
  width: number;
  height: number;
  rgba: Uint8Array;
} {
  const r = new Reader(bytes);
  const headerSize = r.u32(0);
  if (headerSize < 40) throw new FormatError('unsupported bitmap header');
  const width = r.i32(4);
  const fullHeight = r.i32(8);
  const bpp = r.u16(14);
  const compression = r.u32(16);
  const clrUsed = r.u32(32);
  const height = Math.floor(Math.abs(fullHeight) / 2);
  const topDown = fullHeight < 0;
  if (width < 1 || height < 1 || width > MAX_SIDE || height > MAX_SIDE) {
    throw new FormatError(`unsupported icon size ${width}×${height}`);
  }
  if (![1, 4, 8, 16, 24, 32].includes(bpp)) throw new FormatError(`unsupported bit depth ${bpp}`);
  if (compression !== 0 && !(compression === 3 && (bpp === 16 || bpp === 32))) {
    throw new FormatError('compressed bitmaps are not supported');
  }
  const paletteSize = bpp <= 8 ? Math.min(clrUsed || 1 << bpp, 256) : 0;
  const palette = headerSize + (compression === 3 && headerSize === 40 ? 12 : 0);
  const xorAt = palette + paletteSize * 4;
  const xorStride = Math.floor((width * bpp + 31) / 32) * 4;
  const andAt = xorAt + xorStride * height;
  const andStride = Math.floor((width + 31) / 32) * 4;
  r.check(xorAt, xorStride * height, 'icon bitmap');
  const hasMask = r.has(andAt, andStride * height);
  const b = bytes;

  const rgba = new Uint8Array(width * height * 4);
  let anyAlpha = false;
  for (let y = 0; y < height; y++) {
    const row = xorAt + (topDown ? y : height - 1 - y) * xorStride;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      let blue: number;
      let green: number;
      let red: number;
      let alpha = 255;
      if (bpp <= 8) {
        const bit = x * bpp;
        const byte = b[row + (bit >> 3)] ?? 0;
        const index = (byte >> (8 - bpp - (bit & 7))) & ((1 << bpp) - 1);
        const pe = palette + index * 4;
        blue = b[pe] ?? 0;
        green = b[pe + 1] ?? 0;
        red = b[pe + 2] ?? 0;
      } else if (bpp === 16) {
        const v = (b[row + x * 2] ?? 0) | ((b[row + x * 2 + 1] ?? 0) << 8);
        red = ((v >> 10) & 0x1f) * 8.25;
        green = ((v >> 5) & 0x1f) * 8.25;
        blue = (v & 0x1f) * 8.25;
      } else {
        const p = row + x * (bpp / 8);
        blue = b[p] ?? 0;
        green = b[p + 1] ?? 0;
        red = b[p + 2] ?? 0;
        if (bpp === 32) {
          alpha = b[p + 3] ?? 0;
          if (alpha) anyAlpha = true;
        }
      }
      rgba[o] = red;
      rgba[o + 1] = green;
      rgba[o + 2] = blue;
      rgba[o + 3] = alpha;
    }
  }
  // Without a real alpha channel, the AND mask says which pixels are transparent
  if (!(bpp === 32 && anyAlpha)) {
    for (let y = 0; y < height; y++) {
      const row = andAt + (topDown ? y : height - 1 - y) * andStride;
      for (let x = 0; x < width; x++) {
        const masked = hasMask && ((b[row + (x >> 3)] ?? 0) >> (7 - (x & 7))) & 1;
        rgba[(y * width + x) * 4 + 3] = masked ? 0 : 255;
      }
    }
  }
  return { width, height, rgba };
}

/** One icon image as PNG bytes. */
export function iconToPng(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  if (isPngData(bytes)) return bytes;
  const { width, height, rgba } = decodeDib(bytes);
  return encodePng(width, height, rgba);
}

export interface IcoImage {
  width: number;
  height: number;
  bitCount: number;
  data: Uint8Array;
}

/** A `.ico` file: ICONDIR, one 16-byte entry per image, then the image data. */
export function buildIco(images: IcoImage[]): Uint8Array<ArrayBuffer> {
  const head = new Uint8Array(6 + images.length * 16);
  const dv = new DataView(head.buffer);
  dv.setUint16(2, 1, true);
  dv.setUint16(4, images.length, true);
  let offset = head.length;
  images.forEach((img, i) => {
    const e = 6 + i * 16;
    head[e] = img.width >= 256 ? 0 : img.width;
    head[e + 1] = img.height >= 256 ? 0 : img.height;
    dv.setUint16(e + 4, 1, true);
    dv.setUint16(e + 6, img.bitCount, true);
    dv.setUint32(e + 8, img.data.length, true);
    dv.setUint32(e + 12, offset, true);
    offset += img.data.length;
  });
  return concat([head, ...images.map(i => i.data)]);
}
