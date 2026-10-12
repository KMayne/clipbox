import { createMemo, type EntryContent } from '../../core/content';
import type { Detector } from '../types';

/** The source format of a HEIF file, for the label and Info. */
export interface HeifSniff {
  /** "HEIC" for HEVC-coded files (iPhone photos), else the generic "HEIF". */
  format: 'HEIC' | 'HEIF';
  mime: string;
}

/** ISO-BMFF brands of HEVC-coded HEIF images and image sequences. */
const HEVC_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx']);
/** Generic HEIF still images and image sequences (any codec). */
const HEIF_BRANDS = new Set(['mif1', 'msf1']);
/** AVIF is HEIF with AV1 inside, and Chromium decodes it natively. */
const AVIF_BRANDS = new Set(['avif', 'avis']);
/** Sequence brands (major), for the MIME type. */
const SEQUENCE_BRANDS = new Set(['msf1', 'hevc', 'hevx']);

const ascii = (b: Uint8Array, from: number) =>
  String.fromCharCode(b[from] ?? 0, b[from + 1] ?? 0, b[from + 2] ?? 0, b[from + 3] ?? 0);

/**
 * Reads the leading `ftyp` box: a HEIF brand (major or compatible) and no AVIF brand. Brands
 * past the first 256 bytes are ignored; real files list a handful.
 */
export function sniffHeif(b: Uint8Array): HeifSniff | null {
  if (b.length < 16 || ascii(b, 4) !== 'ftyp') return null;
  const size = (((b[0] ?? 0) << 24) | ((b[1] ?? 0) << 16) | ((b[2] ?? 0) << 8) | (b[3] ?? 0)) >>> 0;
  if (size < 16) return null;
  const major = ascii(b, 8);
  const brands = [major];
  const end = Math.min(size, b.length, 256);
  for (let i = 16; i + 4 <= end; i += 4) brands.push(ascii(b, i));
  if (brands.some(x => AVIF_BRANDS.has(x))) return null;
  const hevc = brands.some(x => HEVC_BRANDS.has(x));
  if (!hevc && !brands.some(x => HEIF_BRANDS.has(x))) return null;
  const sequence = SEQUENCE_BRANDS.has(major) ? '-sequence' : '';
  return hevc
    ? { format: 'HEIC', mime: `image/heic${sequence}` }
    : { format: 'HEIF', mime: `image/heif${sequence}` };
}

export const sniff = createMemo((c: EntryContent) => sniffHeif(c.bytes));

/**
 * Owns the same `image` kind as the core interpreter, like `imageformats`: neither the core
 * detector nor the media one matches HEIF brands, so each entry has at most one `image` candidate.
 */
export const heicDetector: Detector = {
  kind: 'image',
  module: 'heic',
  detect: c => (sniff(c) ? 1 : 0),
};
