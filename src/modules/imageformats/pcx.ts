/** ZSoft PCX: monochrome, 16-colour (planar or packed), 256-colour and 24/32-bit, RLE. */

import type { StatRow } from '../../core/types';
import { DecodeError, newRaster, previewStep, scaled, type Raster } from './raster';

export interface PcxInfo {
  width: number;
  height: number;
  bpp: number;
  planes: number;
  bytesPerLine: number;
  dpi: { x: number; y: number } | null;
}

const u16 = (b: Uint8Array, o: number) => (b[o] ?? 0) | ((b[o + 1] ?? 0) << 8);

export function readPcx(b: Uint8Array): PcxInfo {
  const hx = u16(b, 12);
  const hy = u16(b, 14);
  return {
    width: u16(b, 8) - u16(b, 4) + 1,
    height: u16(b, 10) - u16(b, 6) + 1,
    bpp: b[3] ?? 1,
    planes: b[65] ?? 1,
    bytesPerLine: u16(b, 66),
    dpi: hx > 0 && hy > 0 ? { x: hx, y: hy } : null,
  };
}

const colourSpace = (p: PcxInfo) => {
  const bits = p.bpp * p.planes;
  if (bits === 1) return 'Monochrome';
  if (p.planes >= 3 && p.bpp === 8) return p.planes === 4 ? 'RGBA' : 'RGB';
  return `Palette (${2 ** bits} colours)`;
};

export function pcxStats(p: PcxInfo): StatRow[] {
  return [
    { label: 'Colour space', value: colourSpace(p) },
    { label: 'Bit depth', value: `${p.bpp}-bit × ${p.planes}` },
    { label: 'Compression', value: 'RLE' },
    ...(p.dpi
      ? [{ label: 'DPI', value: p.dpi.x === p.dpi.y ? `${p.dpi.x}` : `${p.dpi.x} × ${p.dpi.y}` }]
      : []),
  ];
}

/** The standard 16-colour EGA palette, for files whose header palette is empty. */
const EGA = [
  0x000000, 0x0000aa, 0x00aa00, 0x00aaaa, 0xaa0000, 0xaa00aa, 0xaa5500, 0xaaaaaa, 0x555555,
  0x5555ff, 0x55ff55, 0x55ffff, 0xff5555, 0xff55ff, 0xffff55, 0xffffff,
];

export function decodePcx(b: Uint8Array, p: PcxInfo, maxPixels?: number): Raster {
  const { width: w, height: h, bpp, planes, bytesPerLine } = p;
  if (w <= 0 || h <= 0 || bytesPerLine === 0) throw new DecodeError('Invalid PCX dimensions');
  const lineBytes = bytesPerLine * planes;
  const bits = bpp * planes;

  // Palette: 256 colours after a 0x0C marker at the end, else the 16 in the header
  let palette: number[];
  if (bits === 8 && b.length >= 769 && b[b.length - 769] === 0x0c) {
    const at = b.length - 768;
    palette = Array.from(
      { length: 256 },
      (_, i) =>
        ((b[at + i * 3] ?? 0) << 16) | ((b[at + i * 3 + 1] ?? 0) << 8) | (b[at + i * 3 + 2] ?? 0),
    );
  } else if (bits === 8) {
    palette = Array.from({ length: 256 }, (_, i) => (i << 16) | (i << 8) | i);
  } else if (bits === 1) {
    palette = [0x000000, 0xffffff];
  } else {
    const header = Array.from(
      { length: 16 },
      (_, i) => ((b[16 + i * 3] ?? 0) << 16) | ((b[17 + i * 3] ?? 0) << 8) | (b[18 + i * 3] ?? 0),
    );
    palette = header.some(c => c !== 0) ? header : EGA;
  }

  const step = previewStep(w, h, maxPixels);
  const out = newRaster(scaled(w, step), scaled(h, step));
  const px = out.data;
  const line = new Uint8Array(lineBytes);
  let pos = 128;
  // RLE runs may cross scan lines, so the decoder state carries over
  let runValue = 0;
  let runLeft = 0;
  for (let y = 0; y < h; y++) {
    for (let i = 0; i < lineBytes; i++) {
      if (runLeft === 0) {
        const c = b[pos++] ?? 0;
        if (c >= 0xc0) {
          runLeft = c & 0x3f;
          runValue = b[pos++] ?? 0;
        } else {
          runLeft = 1;
          runValue = c;
        }
      }
      line[i] = runValue;
      runLeft--;
    }
    if (y % step) continue;
    const row = (y / step) * out.width;
    for (let x = 0; x < w; x += step) {
      const o = (row + x / step) * 4;
      let rgb: number;
      if (bpp === 8 && planes >= 3) {
        rgb =
          ((line[x] ?? 0) << 16) |
          ((line[bytesPerLine + x] ?? 0) << 8) |
          (line[2 * bytesPerLine + x] ?? 0);
        px[o + 3] = planes === 4 ? (line[3 * bytesPerLine + x] ?? 255) : 255;
      } else {
        let index = 0;
        if (planes === 1) {
          const bit = x * bpp;
          index = ((line[bit >> 3] ?? 0) >> (8 - bpp - (bit & 7))) & ((1 << bpp) - 1);
        } else {
          // Bit planes: plane k contributes bit k of the index
          for (let k = 0; k < planes; k++) {
            const byte = line[k * bytesPerLine + (x >> 3)] ?? 0;
            index |= ((byte >> (7 - (x & 7))) & 1) << k;
          }
        }
        rgb = palette[index] ?? 0;
        px[o + 3] = 255;
      }
      px[o] = rgb >> 16;
      px[o + 1] = (rgb >> 8) & 255;
      px[o + 2] = rgb & 255;
    }
  }
  return out;
}
