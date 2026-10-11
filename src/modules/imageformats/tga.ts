/** Truevision TGA: colour-mapped, true-colour and grayscale, raw or RLE. */

import type { StatRow } from '../../core/types';
import { DecodeError, need, newRaster, previewStep, scaled, type Raster } from './raster';

export interface TgaInfo {
  width: number;
  height: number;
  type: number;
  depth: number;
  alphaBits: number;
  topDown: boolean;
  rightToLeft: boolean;
}

const TYPES: Record<number, string> = {
  1: 'Colour-mapped',
  2: 'True colour',
  3: 'Grayscale',
  9: 'Colour-mapped',
  10: 'True colour',
  11: 'Grayscale',
};

const u16 = (b: Uint8Array, o: number) => (b[o] ?? 0) | ((b[o + 1] ?? 0) << 8);

export function readTga(b: Uint8Array): TgaInfo {
  need(b, 18, 'TGA header');
  const descriptor = b[17] ?? 0;
  return {
    width: u16(b, 12),
    height: u16(b, 14),
    type: b[2] ?? 0,
    depth: b[16] ?? 0,
    alphaBits: descriptor & 15,
    topDown: (descriptor & 0x20) !== 0,
    rightToLeft: (descriptor & 0x10) !== 0,
  };
}

export function tgaStats(t: TgaInfo): StatRow[] {
  return [
    { label: 'Colour space', value: TYPES[t.type] ?? `Type ${t.type}` },
    { label: 'Bit depth', value: `${t.depth}-bit` },
    { label: 'Compression', value: t.type >= 9 ? 'RLE' : 'None' },
  ];
}

/** Reads one pixel of `depth` bits at `o` into RGBA. */
function readPixel(b: Uint8Array, o: number, depth: number, gray: boolean, out: number[]): void {
  if (gray || depth === 8) {
    const v = b[o] ?? 0;
    out[0] = out[1] = out[2] = v;
    out[3] = 255;
  } else if (depth === 15 || depth === 16) {
    const v = u16(b, o);
    out[0] = (((v >> 10) & 31) * 255) / 31;
    out[1] = (((v >> 5) & 31) * 255) / 31;
    out[2] = ((v & 31) * 255) / 31;
    out[3] = depth === 16 && !(v & 0x8000) ? 0 : 255;
  } else {
    out[0] = b[o + 2] ?? 0;
    out[1] = b[o + 1] ?? 0;
    out[2] = b[o] ?? 0;
    out[3] = depth === 32 ? (b[o + 3] ?? 0) : 255;
  }
}

export function decodeTga(b: Uint8Array, t: TgaInfo, maxPixels?: number): Raster {
  const { width: w, height: h, type, depth } = t;
  if (w === 0 || h === 0) throw new DecodeError('Invalid TGA dimensions');
  const mapped = type === 1 || type === 9;
  const gray = type === 3 || type === 11;
  const rle = type >= 9;
  const bytesPer = Math.ceil(depth / 8);

  let pos = 18 + (b[0] ?? 0);
  // Colour map: entries of cmDepth bits, starting at index cmFirst
  const palette: number[][] = [];
  const cmFirst = u16(b, 3);
  if ((b[1] ?? 0) === 1) {
    const cmLength = u16(b, 5);
    const cmDepth = b[7] ?? 24;
    const cmBytes = Math.ceil(cmDepth / 8);
    need(b, pos + cmLength * cmBytes, 'TGA colour map');
    for (let i = 0; i < cmLength; i++) {
      const px: number[] = [0, 0, 0, 255];
      readPixel(b, pos + i * cmBytes, cmDepth, false, px);
      palette.push(px);
    }
    pos += cmLength * cmBytes;
  }
  if (mapped && palette.length === 0) throw new DecodeError('The TGA colour map is missing');

  // Decode the whole pixel stream into RGBA (sampled to the preview cap) in file order
  const step = previewStep(w, h, maxPixels);
  const out = newRaster(scaled(w, step), scaled(h, step));
  const px = out.data;
  const pixel = [0, 0, 0, 255];
  let anyAlpha = false;
  const put = (i: number) => {
    const x = i % w;
    const fileRow = Math.floor(i / w);
    const y = t.topDown ? fileRow : h - 1 - fileRow;
    const xx = t.rightToLeft ? w - 1 - x : x;
    if (xx % step || y % step) return;
    const o = ((y / step) * out.width + xx / step) * 4;
    const c = mapped ? (palette[(pixel[0] ?? 0) - cmFirst] ?? [0, 0, 0, 255]) : pixel;
    px[o] = c[0] ?? 0;
    px[o + 1] = c[1] ?? 0;
    px[o + 2] = c[2] ?? 0;
    px[o + 3] = c[3] ?? 255;
    if ((c[3] ?? 255) !== 0) anyAlpha = true;
  };
  const read = (o: number) => {
    if (mapped) {
      // Indexes are 8 or 16 bits
      pixel[0] = depth === 16 ? u16(b, o) : (b[o] ?? 0);
    } else {
      readPixel(b, o, depth, gray, pixel);
    }
  };
  const total = w * h;
  if (!rle) {
    need(b, pos + total * bytesPer, 'TGA image data');
    for (let i = 0; i < total; i++) {
      read(pos + i * bytesPer);
      put(i);
    }
  } else {
    let i = 0;
    while (i < total && pos < b.length) {
      const head = b[pos++] ?? 0;
      const count = (head & 0x7f) + 1;
      if (head & 0x80) {
        read(pos);
        pos += bytesPer;
        for (let k = 0; k < count && i < total; k++) put(i++);
      } else {
        for (let k = 0; k < count && i < total; k++) {
          read(pos);
          pos += bytesPer;
          put(i++);
        }
      }
    }
  }
  // Many writers leave a 32-bit image's alpha all zero: show it opaque instead of invisible
  if (!anyAlpha) for (let o = 3; o < px.length; o += 4) px[o] = 255;
  return out;
}
