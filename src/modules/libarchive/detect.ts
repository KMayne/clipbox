import type { Detector } from '../types';

export type LibarchiveFormat = '7z' | 'rar' | 'xz' | 'bz2' | 'zstd';

const startsWith = (b: Uint8Array, sig: number[], offset = 0) =>
  b.length >= offset + sig.length && sig.every((v, i) => b[offset + i] === v);

/** Formats handled by the lazily-loaded libarchive module, from their signatures. */
export function sniffLibarchive(b: Uint8Array): LibarchiveFormat | null {
  if (startsWith(b, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return '7z';
  // RAR 4 (Rar!\x1a\x07\x00) and RAR 5 (Rar!\x1a\x07\x01\x00)
  if (startsWith(b, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07])) return 'rar';
  if (startsWith(b, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])) return 'xz';
  if (startsWith(b, [0x28, 0xb5, 0x2f, 0xfd])) return 'zstd';
  // "BZh" + block size digit, then a block (π) or end-of-stream (√π) magic: rules out text
  const level = b[3] ?? 0;
  if (
    startsWith(b, [0x42, 0x5a, 0x68]) &&
    level >= 0x31 &&
    level <= 0x39 &&
    (startsWith(b, [0x31, 0x41, 0x59, 0x26, 0x53, 0x59], 4) ||
      startsWith(b, [0x17, 0x72, 0x45, 0x38, 0x50, 0x90], 4))
  ) {
    return 'bz2';
  }
  return null;
}

/**
 * Owns the same `archive` kind as the core zip/gzip/tar interpreter. The two detectors never both
 * match the same bytes, so each entry has one `archive` candidate, owned by whichever can read it.
 */
export const libarchiveDetector: Detector = {
  kind: 'archive',
  module: 'libarchive',
  detect: c => (sniffLibarchive(c.bytes) ? 0.8 : 0),
};
