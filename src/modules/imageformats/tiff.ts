/**
 * TIFF via UTIF (utif2): it parses the IFDs and decompresses (none, LZW, PackBits, Deflate, JPEG,
 * old-style JPEG, CCITT RLE/G3/G4). Turning the samples into RGBA is ours, so we can handle bit
 * depths, planar data and alpha consistently and sample huge pages down to the preview cap.
 */

import UTIF, { type IFD } from 'utif2';
import type { StatRow } from '../../core/types';
import { DecodeError, newRaster, previewStep, scaled, type Raster } from './raster';

const COMPRESSION: Record<number, string> = {
  1: 'None',
  2: 'CCITT RLE',
  3: 'CCITT Group 3',
  4: 'CCITT Group 4',
  5: 'LZW',
  6: 'JPEG (old-style)',
  7: 'JPEG',
  8: 'Deflate',
  32946: 'Deflate',
  32773: 'PackBits',
  34712: 'JPEG 2000',
  34887: 'LERC',
  50000: 'Zstandard',
  50001: 'WebP',
};

/** Compressions UTIF can decode. */
const DECODABLE = new Set([1, 2, 3, 4, 5, 6, 7, 8, 32946, 32773]);

const PHOTOMETRIC: Record<number, string> = {
  0: 'Grayscale (white is zero)',
  1: 'Grayscale',
  2: 'RGB',
  3: 'Palette',
  4: 'Transparency mask',
  5: 'CMYK',
  6: 'YCbCr',
  8: 'CIE L*a*b*',
};

/** Raw samples (before RGBA) larger than this aren't decoded. */
const MAX_RAW_BYTES = 400_000_000;

export interface TiffPage {
  ifd: IFD;
  width: number;
  height: number;
  compression: number;
  photometric: number;
  bitsPerSample: number;
  samplesPerPixel: number;
  dpi: { x: number; y: number } | null;
}

export interface TiffFile {
  /** The file as its own ArrayBuffer (UTIF indexes into the buffer from offset 0). */
  buffer: ArrayBuffer;
  pages: TiffPage[];
}

/** A tag's values as numbers (rationals divided out); empty if absent or not numeric. */
function tag(ifd: IFD, id: number): number[] {
  const v = ifd[`t${id}`];
  if (v instanceof Uint8Array) return Array.from(v);
  if (!Array.isArray(v)) return typeof v === 'number' ? [v] : [];
  const out: number[] = [];
  for (const item of v) {
    if (typeof item === 'number') out.push(item);
    else if (Array.isArray(item)) {
      const [num, den] = item;
      if (typeof num === 'number' && typeof den === 'number' && den !== 0) out.push(num / den);
    }
  }
  return out;
}

const first = (ifd: IFD, id: number, fallback: number) => tag(ifd, id)[0] ?? fallback;

function dpiOf(ifd: IFD): TiffPage['dpi'] {
  const x = tag(ifd, 282)[0];
  const y = tag(ifd, 283)[0] ?? x;
  const unit = first(ifd, 296, 2);
  if (!x || !y || unit === 1) return null;
  const k = unit === 3 ? 2.54 : 1;
  return { x: Math.round(x * k), y: Math.round(y * k) };
}

/** Parses the IFD chain; reduced-resolution images (thumbnails) aren't pages. */
export function readTiff(bytes: Uint8Array<ArrayBuffer>): TiffFile {
  const buffer =
    bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
      ? bytes.buffer
      : bytes.slice().buffer;
  let ifds: IFD[];
  try {
    ifds = UTIF.decode(buffer);
  } catch (err) {
    throw new DecodeError(`Unreadable TIFF: ${err instanceof Error ? err.message : String(err)}`);
  }
  const pages = ifds
    .filter(ifd => tag(ifd, 256).length > 0 && tag(ifd, 257).length > 0)
    .filter(ifd => (first(ifd, 254, 0) & 1) === 0)
    .map((ifd): TiffPage => ({
      ifd,
      width: first(ifd, 256, 0),
      height: first(ifd, 257, 0),
      compression: first(ifd, 259, 1),
      photometric: first(ifd, 262, first(ifd, 258, 1) === 1 ? 0 : 2),
      bitsPerSample: first(ifd, 258, 1),
      samplesPerPixel: first(ifd, 277, 1),
      dpi: dpiOf(ifd),
    }));
  if (pages.length === 0) throw new DecodeError('The TIFF has no images');
  return { buffer, pages };
}

const colourSpace = (p: TiffPage) =>
  p.bitsPerSample === 1 && p.photometric <= 1
    ? 'Bilevel (black and white)'
    : (PHOTOMETRIC[p.photometric] ?? `Photometric ${p.photometric}`);

const compressionName = (c: number) => COMPRESSION[c] ?? `Unknown (${c})`;

const depth = (p: TiffPage) =>
  `${p.bitsPerSample}-bit${p.samplesPerPixel > 1 ? ` × ${p.samplesPerPixel}` : ''}`;

export function tiffStats(file: TiffFile): StatRow[] {
  const [p] = file.pages;
  if (!p) return [];
  const pageRows: StatRow[] =
    file.pages.length > 1
      ? [
          {
            label: 'Pages',
            value: String(file.pages.length),
            children: file.pages.map((q, i) => ({
              label: `Page ${i + 1}`,
              value: `${q.width} × ${q.height} · ${compressionName(q.compression)} · ${colourSpace(q)}`,
            })),
          },
        ]
      : [];
  return [
    ...pageRows,
    { label: 'Compression', value: compressionName(p.compression) },
    { label: 'Colour space', value: colourSpace(p) },
    { label: 'Bit depth', value: depth(p) },
    ...(p.dpi
      ? [{ label: 'DPI', value: p.dpi.x === p.dpi.y ? `${p.dpi.x}` : `${p.dpi.x} × ${p.dpi.y}` }]
      : []),
  ];
}

/** Decodes one page to RGBA, sampled down to the preview cap. */
export function decodeTiffPage(file: TiffFile, index: number, maxPixels?: number): Raster {
  const page = file.pages[index];
  if (!page) throw new DecodeError(`No page ${index + 1}`);
  const { ifd, width: w, height: h, compression } = page;
  if (!DECODABLE.has(compression)) {
    throw new DecodeError(`${compressionName(compression)} compression isn't supported`);
  }
  if (w <= 0 || h <= 0) throw new DecodeError('Invalid TIFF dimensions');
  if ((w * h * page.bitsPerSample * page.samplesPerPixel) / 8 > MAX_RAW_BYTES) {
    throw new DecodeError(`The page is too large to decode (${w} × ${h})`);
  }
  // UTIF caches `data` on the IFD and rewrites the photometric tag for JPEG (YCbCr → RGB)
  try {
    UTIF.decodeImage(file.buffer, ifd);
  } catch (err) {
    throw new DecodeError(`Decoding failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  const data = ifd.data;
  if (!(data instanceof Uint8Array) || data.length === 0) {
    throw new DecodeError('The page has no image data');
  }
  return toRgba(page, data, previewStep(w, h, maxPixels));
}

/** How samples are laid out after decompression. */
interface Layout {
  bps: number;
  spp: number;
  photometric: number;
  planar: boolean;
  float: boolean;
}

function layoutOf(page: TiffPage, data: Uint8Array): Layout {
  const { ifd, width: w, height: h, compression } = page;
  const spp = page.samplesPerPixel;
  const bps = page.bitsPerSample;
  if (compression === 6 || compression === 7) {
    // UTIF's JPEG decoder always produces 8-bit RGB (or gray for 1-component data)
    const rgb = data.length >= w * h * 3;
    return { bps: 8, spp: rgb ? 3 : 1, photometric: rgb ? 2 : 1, planar: false, float: false };
  }
  // CCITT decoders write runs as 1 = black, whatever the photometric tag says
  const fax = compression >= 2 && compression <= 4;
  return {
    bps,
    spp,
    photometric: fax ? 0 : first(ifd, 262, page.photometric),
    planar: first(ifd, 284, 1) === 2 && spp > 1,
    float: first(ifd, 339, 1) === 3,
  };
}

function toRgba(page: TiffPage, data: Uint8Array, step: number): Raster {
  const { ifd, width: w, height: h } = page;
  const L = layoutOf(page, data);
  const { bps, spp, photometric } = L;
  if (![1, 2, 4, 8, 16, 32].includes(bps))
    throw new DecodeError(`${bps}-bit samples aren't supported`);
  if (bps === 32 && !L.float) throw new DecodeError('32-bit integer samples aren’t supported');
  if (![0, 1, 2, 3, 5].includes(photometric)) {
    throw new DecodeError(`${PHOTOMETRIC[photometric] ?? 'This'} colour space isn't supported`);
  }

  // Bytes per row of one plane (planar) or of all samples (chunky)
  const rowSamples = L.planar ? w : w * spp;
  const rowBytes = Math.ceil((rowSamples * bps) / 8);
  const planeBytes = rowBytes * h;
  const max = (1 << Math.min(bps, 16)) - 1;
  const f32 =
    L.float && data.byteOffset % 4 === 0
      ? new Float32Array(data.buffer, data.byteOffset, Math.floor(data.length / 4))
      : null;

  /** Sample `s` of pixel (x, y), raw (palette indexes) or scaled to 0…255. */
  const raw = (x: number, y: number, s: number): number => {
    const base = L.planar ? s * planeBytes + y * rowBytes : y * rowBytes;
    const i = L.planar ? x : x * spp + s;
    switch (bps) {
      case 8:
        return data[base + i] ?? 0;
      case 16:
        // UTIF converts 16-bit samples to little-endian
        return ((data[base + i * 2 + 1] ?? 0) << 8) | (data[base + i * 2] ?? 0);
      case 32:
        return f32 ? (f32[(base >> 2) + i] ?? 0) : 0;
      default: {
        const bit = i * bps;
        const byte = data[base + (bit >> 3)] ?? 0;
        return (byte >> (8 - bps - (bit & 7))) & max;
      }
    }
  };
  const norm = (v: number) =>
    bps === 32 ? Math.round(Math.max(0, Math.min(1, v)) * 255) : bps === 8 ? v : (v * 255) / max;
  const sample = (x: number, y: number, s: number) => norm(raw(x, y, s));

  const extra = tag(ifd, 338)[0] ?? 0; // 1 associated (premultiplied) alpha, 2 unassociated
  const colours = photometric === 2 ? 3 : photometric === 5 ? 4 : 1;
  const hasAlpha = spp > colours && (extra === 1 || extra === 2 || photometric === 2);
  const premultiplied = extra === 1;

  const map = tag(ifd, 320);
  const n = 1 << Math.min(bps, 16);
  if (photometric === 3 && map.length < 3 * n) throw new DecodeError('The palette is missing');

  const out = newRaster(scaled(w, step), scaled(h, step));
  const px = out.data;
  let o = 0;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      let r: number;
      let g: number;
      let b: number;
      switch (photometric) {
        case 0:
          r = g = b = 255 - sample(x, y, 0);
          break;
        case 1:
          r = g = b = sample(x, y, 0);
          break;
        case 3: {
          const idx = raw(x, y, 0);
          r = (map[idx] ?? 0) >> 8;
          g = (map[n + idx] ?? 0) >> 8;
          b = (map[2 * n + idx] ?? 0) >> 8;
          break;
        }
        case 5: {
          const k = 255 - sample(x, y, 3);
          r = ((255 - sample(x, y, 0)) * k) / 255;
          g = ((255 - sample(x, y, 1)) * k) / 255;
          b = ((255 - sample(x, y, 2)) * k) / 255;
          break;
        }
        default:
          r = sample(x, y, 0);
          g = sample(x, y, 1);
          b = sample(x, y, 2);
      }
      const a = hasAlpha ? sample(x, y, colours) : 255;
      if (premultiplied && a > 0 && a < 255) {
        r = (r * 255) / a;
        g = (g * 255) / a;
        b = (b * 255) / a;
      }
      px[o] = r;
      px[o + 1] = g;
      px[o + 2] = b;
      px[o + 3] = a;
      o += 4;
    }
  }
  return out;
}
