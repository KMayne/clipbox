/** Zip listing from the central directory (nothing is decompressed) and single-entry extraction. */

import { Inflate } from 'fflate';
import { capExceeded, concat, outputCap, type ArchiveEntry, type ZipRecord } from './types';

const EOCD = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_EOCD = 0x06064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const MAX_COMMENT = 0xffff;

export interface ZipListing {
  entries: ArchiveEntry[];
  records: ZipRecord[];
}

/** PK\3\4 (local file header) or PK\5\6 (empty archive). */
export const hasZipSignature = (b: Uint8Array) =>
  b.length >= 4 &&
  b[0] === 0x50 &&
  b[1] === 0x4b &&
  ((b[2] === 3 && b[3] === 4) || (b[2] === 5 && b[3] === 6));

const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

function findEocd(dv: DataView): number {
  const min = Math.max(0, dv.byteLength - 22 - MAX_COMMENT);
  for (let i = dv.byteLength - 22; i >= min; i--) {
    if (dv.getUint32(i, true) === EOCD) return i;
  }
  return -1;
}

/** DOS date/time (local time, no zone) as ISO 8601 without a zone. */
function dosDate(date: number, time: number): string | undefined {
  if (date === 0) return undefined;
  const p = (n: number) => String(n).padStart(2, '0');
  const y = 1980 + (date >> 9);
  return `${y}-${p((date >> 5) & 0xf)}-${p(date & 0x1f)}T${p(time >> 11)}:${p((time >> 5) & 0x3f)}:${p((time & 0x1f) * 2)}`;
}

/** Reads the central directory; throws when it is missing or malformed. */
export function listZip(b: Uint8Array): ZipListing {
  const dv = view(b);
  const eocd = findEocd(dv);
  if (eocd < 0) throw new Error('No zip end-of-central-directory record');
  let count = dv.getUint16(eocd + 10, true);
  let cdOffset = dv.getUint32(eocd + 16, true);
  if (count === 0xffff || cdOffset === 0xffffffff) {
    const loc = eocd - 20;
    if (loc < 0 || dv.getUint32(loc, true) !== ZIP64_LOCATOR)
      throw new Error('Missing zip64 locator');
    const z = Number(dv.getBigUint64(loc + 8, true));
    if (z + 56 > b.length || dv.getUint32(z, true) !== ZIP64_EOCD)
      throw new Error('Bad zip64 record');
    count = Number(dv.getBigUint64(z + 32, true));
    cdOffset = Number(dv.getBigUint64(z + 48, true));
  }

  const decoder = new TextDecoder('utf-8');
  const entries: ArchiveEntry[] = [];
  const records: ZipRecord[] = [];
  let at = cdOffset;
  for (let i = 0; i < count; i++) {
    if (at + 46 > b.length || dv.getUint32(at, true) !== CENTRAL) {
      throw new Error(`Bad zip central directory entry ${i}`);
    }
    const flags = dv.getUint16(at + 8, true);
    const method = dv.getUint16(at + 10, true);
    const time = dv.getUint16(at + 12, true);
    const date = dv.getUint16(at + 14, true);
    let compressedSize = dv.getUint32(at + 20, true);
    let size = dv.getUint32(at + 24, true);
    const nameLen = dv.getUint16(at + 28, true);
    const extraLen = dv.getUint16(at + 30, true);
    const commentLen = dv.getUint16(at + 32, true);
    let localOffset = dv.getUint32(at + 42, true);
    const name = decoder.decode(b.subarray(at + 46, at + 46 + nameLen));
    let modified = dosDate(date, time);

    // Extra fields: zip64 sizes (0x0001) and the Unix extended timestamp (0x5455)
    const extraEnd = at + 46 + nameLen + extraLen;
    for (let e = at + 46 + nameLen; e + 4 <= extraEnd;) {
      const id = dv.getUint16(e, true);
      const len = dv.getUint16(e + 2, true);
      let f = e + 4;
      if (id === 0x0001) {
        const u64 = () => {
          const v = f + 8 <= e + 4 + len ? Number(dv.getBigUint64(f, true)) : 0;
          f += 8;
          return v;
        };
        if (size === 0xffffffff) size = u64();
        if (compressedSize === 0xffffffff) compressedSize = u64();
        if (localOffset === 0xffffffff) localOffset = u64();
      } else if (id === 0x5455 && len >= 5 && (dv.getUint8(f) & 1) !== 0) {
        modified = new Date(dv.getUint32(f + 1, true) * 1000).toISOString().replace('.000Z', 'Z');
      }
      e += 4 + len;
    }

    const isDir = name.endsWith('/');
    entries.push({ path: name, size, compressedSize, ...(modified ? { modified } : {}), isDir });
    records.push({ localOffset, method, flags });
    at = extraEnd + commentLen;
  }
  return { entries, records };
}

/** Feeds `data` to a streaming decompressor in small chunks, stopping once output passes `cap`. */
export function inflateCapped(
  data: Uint8Array,
  cap: number,
  path: string,
  make: (ondata: (chunk: Uint8Array) => void) => { push(chunk: Uint8Array, final?: boolean): void },
): Uint8Array<ArrayBuffer> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const stream = make(chunk => {
    total += chunk.byteLength;
    if (total > cap) throw capExceeded(path);
    chunks.push(chunk);
  });
  const STEP = 16 * 1024;
  if (data.byteLength === 0) stream.push(data, true);
  for (let i = 0; i < data.byteLength; i += STEP) {
    stream.push(data.subarray(i, i + STEP), i + STEP >= data.byteLength);
  }
  return concat(chunks, total);
}

/** Extracts one entry; the caller has already applied the size/ratio guard. */
export function extractZipEntry(
  b: Uint8Array,
  entry: ArchiveEntry,
  record: ZipRecord,
  force: boolean,
): Uint8Array<ArrayBuffer> {
  if (record.flags & 1) throw new Error(`${entry.path} is encrypted`);
  const dv = view(b);
  const at = record.localOffset;
  if (at + 30 > b.length || dv.getUint32(at, true) !== LOCAL) {
    throw new Error(`Bad local header for ${entry.path}`);
  }
  const start = at + 30 + dv.getUint16(at + 26, true) + dv.getUint16(at + 28, true);
  const compressed = entry.compressedSize ?? 0;
  if (start + compressed > b.length) throw new Error(`${entry.path} is truncated`);
  const data = b.subarray(start, start + compressed);
  if (record.method === 0) return data.slice();
  if (record.method !== 8) {
    throw new Error(`${entry.path} uses unsupported compression method ${record.method}`);
  }
  return inflateCapped(data, outputCap(compressed, force), entry.path, ondata => {
    const s = new Inflate();
    s.ondata = chunk => ondata(chunk);
    return s;
  });
}

/** Offset of the central directory (zip64-aware), or null when there's no EOCD record. */
export function zipCentralDirectoryOffset(b: Uint8Array): number | null {
  const dv = view(b);
  const eocd = findEocd(dv);
  if (eocd < 0) return null;
  const offset = dv.getUint32(eocd + 16, true);
  if (offset !== 0xffffffff) return offset;
  const loc = eocd - 20;
  if (loc < 0 || dv.getUint32(loc, true) !== ZIP64_LOCATOR) return null;
  const z = Number(dv.getBigUint64(loc + 8, true));
  if (z + 56 > b.length || dv.getUint32(z, true) !== ZIP64_EOCD) return null;
  return Number(dv.getBigUint64(z + 48, true));
}

/**
 * The first `n` bytes of an entry (fewer if it's shorter), inflating only as much as needed;
 * null when the entry can't be read (encrypted, unknown method, corrupt).
 */
export function readZipPrefix(
  b: Uint8Array,
  entry: ArchiveEntry,
  record: ZipRecord,
  n: number,
): Uint8Array<ArrayBuffer> | null {
  if (record.flags & 1) return null;
  const dv = view(b);
  const at = record.localOffset;
  if (at + 30 > b.length || dv.getUint32(at, true) !== LOCAL) return null;
  const start = at + 30 + dv.getUint16(at + 26, true) + dv.getUint16(at + 28, true);
  const data = b.subarray(start, Math.min(b.length, start + (entry.compressedSize ?? 0)));
  if (record.method === 0) return data.slice(0, n);
  if (record.method !== 8) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  const s = new Inflate();
  s.ondata = chunk => {
    chunks.push(chunk);
    total += chunk.byteLength;
  };
  const STEP = 256;
  try {
    for (let i = 0; i < data.byteLength && total < n; i += STEP) {
      s.push(data.subarray(i, i + STEP), i + STEP >= data.byteLength);
    }
  } catch {
    return null;
  }
  return concat(chunks, total).slice(0, n);
}
