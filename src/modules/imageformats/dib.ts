/**
 * Device-independent bitmaps as metafiles embed them (BITMAPINFO plus bits): 1/4/8/16/24/32-bit,
 * BI_RGB, BI_BITFIELDS, BI_RLE8/RLE4, and BI_JPEG/BI_PNG passed through as encoded bytes.
 */

import { DecodeError, newRaster, type Raster } from './raster';

/** A decoded DIB, or one holding a JPEG/PNG the browser decodes. */
export type Dib =
  | { type: 'raster'; raster: Raster }
  | {
      type: 'encoded';
      bytes: Uint8Array<ArrayBuffer>;
      mime: string;
      width: number;
      height: number;
    };

export interface DibOptions {
  /** Keep a 32-bit bitmap's fourth byte as alpha (AlphaBlend with AC_SRC_ALPHA, premultiplied). */
  alpha?: boolean;
}

/** Rough upper bound on DIB pixels we decode (they're scaled when drawn anyway). */
const MAX_DIB_PIXELS = 40_000_000;

const shiftOf = (mask: number) => {
  if (!mask) return { shift: 0, max: 1 };
  let shift = 0;
  while (((mask >>> shift) & 1) === 0) shift++;
  return { shift, max: mask >>> shift };
};

/**
 * `info` is the BITMAPINFO (header and colour table); `bits` the pixel data. Both are views
 * into the record.
 */
export function decodeDib(info: Uint8Array, bits: Uint8Array, opts: DibOptions = {}): Dib {
  if (info.length < 12) throw new DecodeError('Truncated bitmap header');
  const dv = new DataView(info.buffer, info.byteOffset, info.byteLength);
  const headerSize = dv.getUint32(0, true);
  const core = headerSize === 12;
  const width = core ? dv.getUint16(4, true) : dv.getInt32(4, true);
  const rawHeight = core ? dv.getInt16(6, true) : dv.getInt32(8, true);
  const bitCount = core ? dv.getUint16(10, true) : dv.getUint16(14, true);
  const compression = core ? 0 : dv.getUint32(16, true);
  const clrUsed = core || headerSize < 36 ? 0 : dv.getUint32(32, true);
  const height = Math.abs(rawHeight);
  const topDown = rawHeight < 0;
  if (width <= 0 || height <= 0) throw new DecodeError('Invalid bitmap size');

  if (compression === 4 || compression === 5) {
    const mime = compression === 4 ? 'image/jpeg' : 'image/png';
    return { type: 'encoded', bytes: bits.slice(), mime, width, height };
  }
  if (width * height > MAX_DIB_PIXELS) throw new DecodeError('Bitmap too large');

  // Colour masks: after a 40-byte header for BI_BITFIELDS, or inside V4/V5 headers
  let masks: [number, number, number, number] | null = null;
  let tableAt = headerSize;
  if (compression === 3 || compression === 6) {
    if (headerSize === 40) {
      if (info.length >= 52) {
        masks = [dv.getUint32(40, true), dv.getUint32(44, true), dv.getUint32(48, true), 0];
        if (compression === 6 && info.length >= 56) masks[3] = dv.getUint32(52, true);
      }
      tableAt += compression === 6 ? 16 : 12;
    } else if (headerSize >= 56) {
      masks = [
        dv.getUint32(40, true),
        dv.getUint32(44, true),
        dv.getUint32(48, true),
        dv.getUint32(52, true),
      ];
    }
  }
  const entrySize = core ? 3 : 4;
  const tableLen = clrUsed || (bitCount <= 8 ? 1 << bitCount : 0);
  const palette: number[][] = [];
  for (let i = 0; i < tableLen && tableAt + i * entrySize + 3 <= info.length; i++) {
    const o = tableAt + i * entrySize;
    palette.push([info[o + 2] ?? 0, info[o + 1] ?? 0, info[o] ?? 0]);
  }
  if (bitCount <= 8 && palette.length === 0) {
    // DIB_PAL_COLORS or a missing table: fall back to a grayscale ramp
    const n = 1 << bitCount;
    for (let i = 0; i < n; i++) {
      const v = Math.round((i * 255) / (n - 1));
      palette.push([v, v, v]);
    }
  }

  const out = newRaster(width, height);
  const px = out.data;
  const set = (x: number, row: number, r: number, g: number, b: number, a = 255) => {
    if (x < 0 || x >= width || row < 0 || row >= height) return;
    const y = topDown ? row : height - 1 - row;
    const o = (y * width + x) * 4;
    px[o] = r;
    px[o + 1] = g;
    px[o + 2] = b;
    px[o + 3] = a;
  };
  const index = (x: number, row: number, i: number) => {
    const c = palette[i] ?? [0, 0, 0];
    set(x, row, c[0] ?? 0, c[1] ?? 0, c[2] ?? 0);
  };

  if (compression === 1 || compression === 2) {
    decodeRle(bits, compression === 2, width, height, index);
    return { type: 'raster', raster: out };
  }

  const stride = ((width * bitCount + 31) >> 5) << 2;
  const bdv = new DataView(bits.buffer, bits.byteOffset, bits.byteLength);
  const rows = Math.min(height, Math.floor(bits.length / stride));
  const m = masks ?? (bitCount === 16 ? [0x7c00, 0x3e0, 0x1f, 0] : [0xff0000, 0xff00, 0xff, 0]);
  const ch = m.map(shiftOf);
  const field = (v: number, i: number) => {
    const c = ch[i];
    return c && m[i] ? Math.round((((v & (m[i] ?? 0)) >>> c.shift) * 255) / c.max) : 0;
  };
  for (let row = 0; row < rows; row++) {
    const base = row * stride;
    for (let x = 0; x < width; x++) {
      switch (bitCount) {
        case 1:
        case 2:
        case 4:
        case 8: {
          const bit = x * bitCount;
          const byte = bits[base + (bit >> 3)] ?? 0;
          index(x, row, (byte >> (8 - bitCount - (bit & 7))) & ((1 << bitCount) - 1));
          break;
        }
        case 16: {
          const v = bdv.getUint16(base + x * 2, true);
          set(x, row, field(v, 0), field(v, 1), field(v, 2), m[3] ? field(v, 3) : 255);
          break;
        }
        case 24: {
          const o = base + x * 3;
          set(x, row, bits[o + 2] ?? 0, bits[o + 1] ?? 0, bits[o] ?? 0);
          break;
        }
        case 32: {
          if (masks) {
            const v = bdv.getUint32(base + x * 4, true);
            set(x, row, field(v, 0), field(v, 1), field(v, 2), m[3] ? field(v, 3) : 255);
          } else {
            const o = base + x * 4;
            const a = opts.alpha ? (bits[o + 3] ?? 0) : 255;
            // AlphaBlend bitmaps are premultiplied
            const k = opts.alpha && a > 0 ? 255 / a : 1;
            set(x, row, (bits[o + 2] ?? 0) * k, (bits[o + 1] ?? 0) * k, (bits[o] ?? 0) * k, a);
          }
          break;
        }
        default:
          throw new DecodeError(`${bitCount}-bit bitmaps aren't supported`);
      }
    }
  }
  return { type: 'raster', raster: out };
}

/** BI_RLE8 / BI_RLE4: rows run bottom-up in file order (row 0 is the first decoded). */
function decodeRle(
  b: Uint8Array,
  four: boolean,
  width: number,
  height: number,
  put: (x: number, row: number, i: number) => void,
): void {
  let pos = 0;
  let x = 0;
  let row = 0;
  while (pos + 1 < b.length && row < height) {
    const count = b[pos++] ?? 0;
    const value = b[pos++] ?? 0;
    if (count > 0) {
      for (let i = 0; i < count; i++) {
        put(x++, row, four ? (i % 2 ? value & 15 : value >> 4) : value);
      }
    } else if (value === 0) {
      x = 0;
      row++;
    } else if (value === 1) {
      return;
    } else if (value === 2) {
      x += b[pos++] ?? 0;
      row += b[pos++] ?? 0;
    } else {
      // Absolute run of `value` pixels, padded to a 16-bit boundary
      const bytes = four ? Math.ceil(value / 2) : value;
      for (let i = 0; i < value; i++) {
        const byte = b[pos + (four ? i >> 1 : i)] ?? 0;
        put(x++, row, four ? (i % 2 ? byte & 15 : byte >> 4) : byte);
      }
      pos += bytes + (bytes % 2);
    }
    if (x > width * 2) x = width; // corrupt data: don't loop wide
  }
}
