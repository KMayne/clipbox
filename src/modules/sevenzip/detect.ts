import { createMemo, type EntryContent } from '../../core/content';
import type { Detector } from '../types';

/** The file systems a disc image carries, from its volume descriptors. */
export interface DiscSniff {
  /** An ISO 9660 primary volume descriptor (CD001). */
  iso9660: boolean;
  /** A UDF volume recognition sequence (BEA01, then NSR02 or NSR03). */
  udf: boolean;
}

export const SECTOR = 2048;
/** Volume descriptors start at sector 16; the 32 KB before is the system area (MBR, boot code). */
export const FIRST_DESCRIPTOR = 16 * SECTOR;
/** How many descriptor sectors the sniffer reads: real discs have a handful. */
const MAX_DESCRIPTORS = 32;

const ascii = (b: Uint8Array, at: number, length: number) => {
  let s = '';
  for (let i = 0; i < length; i++) s += String.fromCharCode(b[at + i] ?? 0);
  return s;
};

/** The 5-byte standard identifier of the descriptor in sector `n` (CD001, BEA01, NSR02…). */
export const descriptorId = (b: Uint8Array, n: number) => ascii(b, n * SECTOR + 1, 5);

/**
 * ISO 9660 (`CD001` at 0x8001, 0x8801 or 0x9001) or UDF (`BEA01` then `NSR02`/`NSR03` in the
 * volume recognition sequence from 0x8000). The system area before 0x8000 is ignored, so hybrid
 * images with an MBR or a boot sector still match.
 */
export function sniffDisc(b: Uint8Array): DiscSniff | null {
  if (b.length < FIRST_DESCRIPTOR + SECTOR) return null;
  const iso9660 = [16, 17, 18].some(n => descriptorId(b, n) === 'CD001');
  let udf = false;
  let extended = false;
  for (let n = 16; n < 16 + MAX_DESCRIPTORS && (n + 1) * SECTOR <= b.length; n++) {
    const id = descriptorId(b, n);
    if (id === 'BEA01') extended = true;
    else if (extended && (id === 'NSR02' || id === 'NSR03')) {
      udf = true;
      break;
    } else if (id === 'TEA01') extended = false;
    // A blank sector ends the recognition sequence
    else if (id !== 'CD001' && id !== 'BOOT2' && id !== 'CDW02') break;
  }
  return iso9660 || udf ? { iso9660, udf } : null;
}

export const sniff = createMemo((c: EntryContent) => sniffDisc(c.bytes));

/**
 * Owns the same `archive` kind as the core and libarchive interpreters. Their signatures all sit
 * at offset 0 (tar's at 257) and never overlap a disc's descriptors at 32 KB, and an image's
 * system area is zeros or boot code, so each entry has one `archive` candidate.
 */
export const sevenzipDetector: Detector = {
  kind: 'archive',
  module: 'sevenzip',
  detect: c => (sniff(c) ? 0.8 : 0),
};
