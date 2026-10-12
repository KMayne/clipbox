/**
 * RPM's on-disk structure: a 96-byte lead, the signature header (padded to 8 bytes), the main
 * header, then the payload. Both headers are "8E AD E8 01", reserved bytes, an index of
 * (tag, type, offset, count) entries and a data store, all big-endian. Kept small and free of
 * other imports: the libarchive module's detector (loaded on both threads) uses it to sniff the
 * payload compressor.
 */

const LEAD_SIZE = 96;
const HEADER_MAGIC = [0x8e, 0xad, 0xe8, 0x01];
/** Index entries one header may hold; real packages have a few hundred. */
const MAX_INDEX = 100_000;

export const RPM_TAG_PAYLOADCOMPRESSOR = 1125;

/**
 * Payload compressors the libarchive module handles (its detector owns these RPMs); core reads
 * gzip and uncompressed payloads.
 */
export const LIBARCHIVE_RPM_COMPRESSORS = new Set(['xz', 'lzma', 'bzip2', 'zstd']);

// Header value types
export const RPM_INT16 = 3;
export const RPM_INT32 = 4;
export const RPM_INT64 = 5;
export const RPM_STRING = 6;
export const RPM_BIN = 7;
export const RPM_STRING_ARRAY = 8;
export const RPM_I18NSTRING = 9;

export interface RpmIndexEntry {
  tag: number;
  type: number;
  offset: number;
  count: number;
}

export interface RpmHeader {
  /** Offset of the header's magic in the file. */
  start: number;
  /** Offset just past its data store. */
  end: number;
  entries: Map<number, RpmIndexEntry>;
  /** The data store. */
  store: Uint8Array;
}

/** The lead magic "ED AB EE DB". */
export const hasRpmLead = (b: Uint8Array) =>
  b.length >= LEAD_SIZE && b[0] === 0xed && b[1] === 0xab && b[2] === 0xee && b[3] === 0xdb;

/** Parses the header at `at`; throws when it's malformed. */
export function readRpmHeader(b: Uint8Array, at: number): RpmHeader {
  if (at + 16 > b.length || HEADER_MAGIC.some((m, i) => b[at + i] !== m)) {
    throw new Error('Bad RPM header magic');
  }
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const count = dv.getUint32(at + 8);
  const size = dv.getUint32(at + 12);
  const storeAt = at + 16 + count * 16;
  if (count > MAX_INDEX || storeAt + size > b.length) throw new Error('Truncated RPM header');
  const entries = new Map<number, RpmIndexEntry>();
  for (let i = 0; i < count; i++) {
    const e = at + 16 + i * 16;
    const entry = {
      tag: dv.getUint32(e),
      type: dv.getUint32(e + 4),
      offset: dv.getUint32(e + 8),
      count: dv.getUint32(e + 12),
    };
    if (entry.offset <= size && !entries.has(entry.tag)) entries.set(entry.tag, entry);
  }
  return { start: at, end: storeAt + size, entries, store: b.subarray(storeAt, storeAt + size) };
}

/** Signature and main headers, and where the payload starts. */
export function readRpmHeaders(b: Uint8Array): {
  signature: RpmHeader;
  main: RpmHeader;
  payloadOffset: number;
} {
  if (!hasRpmLead(b)) throw new Error('Not an RPM');
  const signature = readRpmHeader(b, LEAD_SIZE);
  const mainAt = Math.ceil(signature.end / 8) * 8;
  const main = readRpmHeader(b, mainAt);
  return { signature, main, payloadOffset: main.end };
}

const latin1 = new TextDecoder('latin1');

/** A NUL-terminated string in the store at `at`, and where the next one starts. */
function cstring(store: Uint8Array, at: number): { s: string; next: number } {
  const end = store.indexOf(0, at);
  const stop = end === -1 ? store.length : end;
  const raw = store.subarray(at, stop);
  let s: string;
  try {
    s = new TextDecoder('utf-8', { fatal: true }).decode(raw);
  } catch {
    s = latin1.decode(raw);
  }
  return { s, next: stop + 1 };
}

/** STRING, I18NSTRING (first locale) or STRING_ARRAY values of a tag; [] when absent. */
export function rpmStrings(h: RpmHeader, tag: number): string[] {
  const e = h.entries.get(tag);
  if (!e || (e.type !== RPM_STRING && e.type !== RPM_STRING_ARRAY && e.type !== RPM_I18NSTRING)) {
    return [];
  }
  const n = e.type === RPM_STRING ? 1 : Math.min(e.count, h.store.length);
  const out: string[] = [];
  let at = e.offset;
  for (let i = 0; i < n && at <= h.store.length; i++) {
    const { s, next } = cstring(h.store, at);
    out.push(s);
    at = next;
  }
  return out;
}

export const rpmString = (h: RpmHeader, tag: number): string | null =>
  rpmStrings(h, tag)[0] ?? null;

/** INT16/INT32/INT64 values of a tag (unsigned); [] when absent. */
export function rpmInts(h: RpmHeader, tag: number): number[] {
  const e = h.entries.get(tag);
  if (!e) return [];
  const width = e.type === RPM_INT16 ? 2 : e.type === RPM_INT32 ? 4 : e.type === RPM_INT64 ? 8 : 0;
  if (width === 0 || e.offset + e.count * width > h.store.length) return [];
  const dv = new DataView(h.store.buffer, h.store.byteOffset, h.store.byteLength);
  const out: number[] = [];
  for (let i = 0; i < e.count; i++) {
    const at = e.offset + i * width;
    out.push(
      width === 2 ? dv.getUint16(at) : width === 4 ? dv.getUint32(at) : Number(dv.getBigUint64(at)),
    );
  }
  return out;
}

/** Raw BIN bytes of a tag, or null. */
export function rpmBin(h: RpmHeader, tag: number): Uint8Array | null {
  const e = h.entries.get(tag);
  if (!e || e.type !== RPM_BIN || e.offset + e.count > h.store.length) return null;
  return h.store.subarray(e.offset, e.offset + e.count);
}

/** The payload compressor ("gzip" when the header doesn't say), or null if this isn't an RPM. */
export function rpmPayloadCompressor(b: Uint8Array): string | null {
  if (!hasRpmLead(b)) return null;
  try {
    return rpmString(readRpmHeaders(b).main, RPM_TAG_PAYLOADCOMPRESSOR) ?? 'gzip';
  } catch {
    return null;
  }
}
