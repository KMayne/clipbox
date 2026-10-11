import type { EntryContent } from '../../core/content';
import type { Detector } from '../types';

/** Image formats the browser can't decode, which the `imageformats` module renders to PNG. */
export type LegacyImageFormat = 'tiff' | 'emf' | 'wmf' | 'psd' | 'tga' | 'pcx';

export const LEGACY_IMAGE_INFO: Record<
  LegacyImageFormat,
  { name: string; mime: string; extension: string }
> = {
  tiff: { name: 'TIFF', mime: 'image/tiff', extension: 'tif' },
  emf: { name: 'EMF', mime: 'image/emf', extension: 'emf' },
  wmf: { name: 'WMF', mime: 'image/wmf', extension: 'wmf' },
  psd: { name: 'PSD', mime: 'image/vnd.adobe.photoshop', extension: 'psd' },
  tga: { name: 'TGA', mime: 'image/x-tga', extension: 'tga' },
  pcx: { name: 'PCX', mime: 'image/x-pcx', extension: 'pcx' },
};

const startsWith = (b: Uint8Array, sig: number[], offset = 0) =>
  b.length >= offset + sig.length && sig.every((v, i) => b[offset + i] === v);

const u16 = (b: Uint8Array, o: number) => (b[o] ?? 0) | ((b[o + 1] ?? 0) << 8);
const u32 = (b: Uint8Array, o: number) => (u16(b, o) | (u16(b, o + 2) << 16)) >>> 0;

const ascii = (b: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...b.subarray(from, to));

/** EMR_HEADER (type 1) with the " EMF" signature at offset 40. */
const isEmf = (b: Uint8Array) => b.length >= 88 && u32(b, 0) === 1 && ascii(b, 40, 44) === ' EMF';

/** A placeable WMF (its key), or a bare META_HEADER: type 1/2, 9-word header, version 1 or 3. */
function isWmf(b: Uint8Array): boolean {
  if (b.length < 18) return false;
  if (u32(b, 0) === 0x9ac6cdd7) return true;
  const type = u16(b, 0);
  const version = u16(b, 4);
  return (type === 1 || type === 2) && u16(b, 2) === 9 && (version === 0x100 || version === 0x300);
}

/** Truevision TGA has no magic: a TGA 2.0 footer, or a `.tga` name plus a sane header. */
function isTga(b: Uint8Array, name?: string): boolean {
  if (b.length < 18) return false;
  const colorMapType = b[1] ?? 0;
  const type = b[2] ?? 0;
  const depth = b[16] ?? 0;
  const sane =
    colorMapType <= 1 &&
    [1, 2, 3, 9, 10, 11].includes(type) &&
    [8, 15, 16, 24, 32].includes(depth) &&
    u16(b, 12) > 0 &&
    u16(b, 14) > 0;
  if (!sane) return false;
  const footer = b.length >= 26 && ascii(b, b.length - 18, b.length - 2) === 'TRUEVISION-XFILE';
  return footer || /\.(tga|icb|vda|vst|tpic)$/i.test(name ?? '');
}

/** ZSoft PCX: 0x0A, a known version, RLE encoding and a sane header. */
function isPcx(b: Uint8Array): boolean {
  if (b.length < 128 || b[0] !== 0x0a || b[2] !== 1) return false;
  const version = b[1] ?? 0xff;
  const bpp = b[3] ?? 0;
  const planes = b[65] ?? 0;
  return (
    [0, 2, 3, 4, 5].includes(version) &&
    [1, 2, 4, 8].includes(bpp) &&
    planes >= 1 &&
    planes <= 4 &&
    u16(b, 8) >= u16(b, 4) &&
    u16(b, 10) >= u16(b, 6) &&
    u16(b, 66) > 0
  );
}

/** Which legacy format the bytes are, if any. `name` helps only for TGA (it has no magic). */
export function sniffLegacyImage(b: Uint8Array, name?: string): LegacyImageFormat | null {
  // Little-endian "II*\0" or big-endian "MM\0*"
  if (startsWith(b, [0x49, 0x49, 0x2a, 0x00]) || startsWith(b, [0x4d, 0x4d, 0x00, 0x2a])) {
    return 'tiff';
  }
  if (isEmf(b)) return 'emf';
  if (ascii(b, 0, 4) === '8BPS' && (u16(b, 4) === 0x100 || u16(b, 4) === 0x200)) return 'psd';
  if (isWmf(b)) return 'wmf';
  if (isPcx(b)) return 'pcx';
  if (isTga(b, name)) return 'tga';
  return null;
}

/**
 * Owns the same `image` kind as the core interpreter, for formats the browser can't decode. The
 * core detector only matches web formats, so each entry has at most one `image` candidate.
 */
export const imageformatsDetector: Detector = {
  kind: 'image',
  module: 'imageformats',
  detect: (c: EntryContent) => (c.text === null && sniffLegacyImage(c.bytes, c.name) ? 1 : 0),
};
