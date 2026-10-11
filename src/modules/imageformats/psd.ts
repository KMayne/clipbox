/**
 * Photoshop PSD/PSB: only the merged composite image at the end of the file, which Photoshop
 * writes unless "Maximize compatibility" was turned off (then it's blank or missing).
 */

import { unzlibSync } from 'fflate';
import type { StatRow } from '../../core/types';
import { DecodeError, need, newRaster, previewStep, scaled, type Raster } from './raster';

const MODES: Record<number, string> = {
  0: 'Bitmap',
  1: 'Grayscale',
  2: 'Indexed',
  3: 'RGB',
  4: 'CMYK',
  7: 'Multichannel',
  8: 'Duotone',
  9: 'Lab',
};

const COMPRESSION = ['Raw', 'RLE (PackBits)', 'ZIP', 'ZIP with prediction'];

export interface PsdInfo {
  width: number;
  height: number;
  channels: number;
  depth: number;
  mode: number;
  psb: boolean;
  compression: number;
  dpi: { x: number; y: number } | null;
  /** The merged image's first extra channel is transparency (the layer count is negative). */
  alpha: boolean;
  palette: Uint8Array | null;
  /** Offset of the image data section (after its compression word). */
  dataOffset: number;
}

class Reader {
  private b: Uint8Array;
  private dv: DataView;
  pos: number;
  constructor(b: Uint8Array, pos = 0) {
    this.b = b;
    this.dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    this.pos = pos;
  }
  u8() {
    need(this.b, this.pos + 1, 'PSD');
    return this.dv.getUint8(this.pos++);
  }
  u16() {
    need(this.b, this.pos + 2, 'PSD');
    const v = this.dv.getUint16(this.pos);
    this.pos += 2;
    return v;
  }
  i16() {
    need(this.b, this.pos + 2, 'PSD');
    const v = this.dv.getInt16(this.pos);
    this.pos += 2;
    return v;
  }
  u32() {
    need(this.b, this.pos + 4, 'PSD');
    const v = this.dv.getUint32(this.pos);
    this.pos += 4;
    return v;
  }
  /** PSB widens some lengths to 64 bits. */
  len(wide: boolean) {
    return wide ? this.u32() * 2 ** 32 + this.u32() : this.u32();
  }
}

/** Image resource 1005 (ResolutionInfo): 16.16 fixed-point pixels per inch or per cm. */
function resolution(b: Uint8Array, from: number, to: number): PsdInfo['dpi'] {
  const r = new Reader(b, from);
  while (r.pos + 12 <= to) {
    if (String.fromCharCode(r.u8(), r.u8(), r.u8(), r.u8()) !== '8BIM') return null;
    const id = r.u16();
    const nameLen = r.u8();
    r.pos += nameLen + ((nameLen + 1) % 2); // Pascal string padded to even
    const size = r.u32();
    const start = r.pos;
    if (id === 0x03ed && size >= 16) {
      const x = r.u32() / 65536;
      const xUnit = r.u16();
      r.pos += 2;
      const y = r.u32() / 65536;
      const k = xUnit === 2 ? 2.54 : 1;
      return { x: Math.round(x * k), y: Math.round(y * k) };
    }
    r.pos = start + size + (size % 2);
  }
  return null;
}

export function readPsd(b: Uint8Array): PsdInfo {
  const r = new Reader(b);
  r.pos = 4;
  const version = r.u16();
  const psb = version === 2;
  r.pos += 6;
  const channels = r.u16();
  const height = r.u32();
  const width = r.u32();
  const depth = r.u16();
  const mode = r.u16();
  if (width === 0 || height === 0) throw new DecodeError('Invalid PSD dimensions');

  const modeLen = r.u32();
  const palette = mode === 2 && modeLen >= 768 ? b.subarray(r.pos, r.pos + 768) : null;
  r.pos += modeLen;

  const resLen = r.u32();
  const dpi = resolution(b, r.pos, r.pos + resLen);
  r.pos += resLen;

  const layerLen = r.len(psb);
  const layerStart = r.pos;
  let alpha = false;
  if (layerLen > 0) {
    const infoLen = r.len(psb);
    if (infoLen > 0) alpha = r.i16() < 0;
  }
  r.pos = layerStart + layerLen;
  need(b, r.pos + 2, 'PSD image data');
  const compression = r.u16();
  return {
    width,
    height,
    channels,
    depth,
    mode,
    psb,
    compression,
    dpi,
    alpha,
    palette,
    dataOffset: r.pos,
  };
}

export function psdStats(p: PsdInfo): StatRow[] {
  return [
    { label: 'Colour mode', value: MODES[p.mode] ?? `Mode ${p.mode}` },
    { label: 'Bit depth', value: `${p.depth}-bit × ${p.channels}` },
    { label: 'Compression', value: COMPRESSION[p.compression] ?? `Unknown (${p.compression})` },
    ...(p.dpi ? [{ label: 'DPI', value: `${p.dpi.x}` }] : []),
    ...(p.psb ? [{ label: 'Variant', value: 'Large document (PSB)' }] : []),
  ];
}

/** PackBits-decodes one row into `out`; returns the input position after it. */
function unpackRow(b: Uint8Array, pos: number, end: number, out: Uint8Array): void {
  let o = 0;
  while (pos < end && o < out.length) {
    const n = b[pos++] ?? 0;
    if (n < 128) {
      for (let i = 0; i <= n && o < out.length; i++) out[o++] = b[pos++] ?? 0;
    } else if (n > 128) {
      const v = b[pos++] ?? 0;
      for (let i = 0; i < 257 - n && o < out.length; i++) out[o++] = v;
    }
  }
}

/** Undoes ZIP-with-prediction (per-row deltas) for 8- and 16-bit data. */
function unpredict(data: Uint8Array, width: number, rows: number, depth: number): void {
  if (depth === 8) {
    for (let y = 0; y < rows; y++) {
      const o = y * width;
      for (let x = 1; x < width; x++)
        data[o + x] = ((data[o + x] ?? 0) + (data[o + x - 1] ?? 0)) & 255;
    }
  } else if (depth === 16) {
    for (let y = 0; y < rows; y++) {
      const o = y * width * 2;
      let prev = ((data[o] ?? 0) << 8) | (data[o + 1] ?? 0);
      for (let x = 1; x < width; x++) {
        const i = o + x * 2;
        prev = (prev + (((data[i] ?? 0) << 8) | (data[i + 1] ?? 0))) & 0xffff;
        data[i] = prev >> 8;
        data[i + 1] = prev & 255;
      }
    }
  } else {
    throw new DecodeError('ZIP prediction is only supported for 8- and 16-bit images');
  }
}

/** Decodes the merged composite to RGBA, sampled down to the preview cap. */
export function decodePsd(b: Uint8Array, p: PsdInfo, maxPixels?: number): Raster {
  const { width: w, height: h, depth, mode } = p;
  if (![1, 8, 16, 32].includes(depth)) throw new DecodeError(`${depth}-bit PSDs aren't supported`);
  if (mode === 9) throw new DecodeError('Lab colour PSDs aren’t supported');
  const colourChannels = mode === 3 ? 3 : mode === 4 ? 4 : 1;
  if (p.channels < colourChannels) throw new DecodeError('The PSD is missing colour channels');
  const used = Math.min(p.channels, colourChannels + (p.alpha ? 1 : 0));
  const rowBytes = Math.ceil((w * depth) / 8);
  const step = previewStep(w, h, maxPixels);

  // Each used channel's sampled rows, decoded on demand
  const rowsOf: ((y: number) => Uint8Array)[] = [];
  if (p.compression === 0) {
    for (let c = 0; c < used; c++) {
      const start = p.dataOffset + c * rowBytes * h;
      need(b, start + rowBytes * h, 'PSD image data');
      rowsOf.push(y => b.subarray(start + y * rowBytes, start + (y + 1) * rowBytes));
    }
  } else if (p.compression === 1) {
    const countBytes = p.psb ? 4 : 2;
    const counts = p.dataOffset;
    const total = p.channels * h;
    need(b, counts + total * countBytes, 'PSD row lengths');
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const offsets = new Float64Array(total + 1);
    offsets[0] = counts + total * countBytes;
    for (let i = 0; i < total; i++) {
      const n = p.psb ? dv.getUint32(counts + i * 4) : dv.getUint16(counts + i * 2);
      offsets[i + 1] = (offsets[i] ?? 0) + n;
    }
    const row = new Uint8Array(rowBytes);
    for (let c = 0; c < used; c++) {
      rowsOf.push(y => {
        const i = c * h + y;
        row.fill(0);
        unpackRow(b, offsets[i] ?? 0, offsets[i + 1] ?? 0, row);
        return row;
      });
    }
  } else if (p.compression === 2 || p.compression === 3) {
    // ZIP data has no per-channel lengths: inflate it all (it holds every channel)
    const all = unzlibSync(b.subarray(p.dataOffset));
    if (p.compression === 3) {
      for (let c = 0; c < p.channels; c++) {
        unpredict(all.subarray(c * rowBytes * h, (c + 1) * rowBytes * h), w, h, depth);
      }
    }
    for (let c = 0; c < used; c++) {
      const start = c * rowBytes * h;
      rowsOf.push(y => all.subarray(start + y * rowBytes, start + (y + 1) * rowBytes));
    }
  } else {
    throw new DecodeError(`Unknown PSD compression ${p.compression}`);
  }

  const value = (row: Uint8Array, x: number): number => {
    switch (depth) {
      case 1:
        return ((row[x >> 3] ?? 0) >> (7 - (x & 7))) & 1 ? 0 : 255; // 1 = black
      case 16:
        return row[x * 2] ?? 0; // high byte
      case 32: {
        const dv = new DataView(row.buffer, row.byteOffset + x * 4, 4);
        return Math.round(Math.max(0, Math.min(1, dv.getFloat32(0))) * 255);
      }
      default:
        return row[x] ?? 0;
    }
  };

  const out = newRaster(scaled(w, step), scaled(h, step));
  const px = out.data;
  const channelRows = Array.from({ length: used }, () => new Uint8Array(out.width));
  for (let y = 0, oy = 0; y < h; y += step, oy++) {
    channelRows.forEach((dest, c) => {
      const row = rowsOf[c]?.(y) ?? new Uint8Array(rowBytes);
      for (let x = 0, ox = 0; x < w; x += step, ox++) dest[ox] = value(row, x);
    });
    for (let ox = 0; ox < out.width; ox++) {
      const o = (oy * out.width + ox) * 4;
      const ch = (c: number) => channelRows[c]?.[ox] ?? 0;
      if (mode === 3) {
        px[o] = ch(0);
        px[o + 1] = ch(1);
        px[o + 2] = ch(2);
      } else if (mode === 4) {
        // Stored inverted: 255 is no ink
        const k = ch(3) / 255;
        px[o] = ch(0) * k;
        px[o + 1] = ch(1) * k;
        px[o + 2] = ch(2) * k;
      } else if (mode === 2 && p.palette) {
        const i = ch(0);
        px[o] = p.palette[i] ?? 0;
        px[o + 1] = p.palette[256 + i] ?? 0;
        px[o + 2] = p.palette[512 + i] ?? 0;
      } else {
        px[o] = px[o + 1] = px[o + 2] = ch(0);
      }
      px[o + 3] = p.alpha && used > colourChannels ? ch(colourChannels) : 255;
    }
  }
  return out;
}
