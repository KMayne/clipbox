/** Reads the few entries a package recogniser needs, by path, with a size cap. */

import { isRecord } from '../../guards';
import type { ArchiveEntry, ArchiveValue } from '../types';
import { extractZipEntry, readZipPrefix } from '../zip';

/** Manifests are small; anything bigger than this is ignored rather than inflated. */
export const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;

export interface EntryReader {
  /** File paths (directories left out), in archive order. */
  files: string[];
  has(path: string): boolean;
  /** The entry's bytes, or null if missing, too big or unreadable. */
  bytes(path: string, cap?: number): Uint8Array<ArrayBuffer> | null;
  text(path: string, cap?: number): string | null;
  /** Parsed JSON object (a leading BOM is allowed), or null. */
  json(path: string): Record<string, unknown> | null;
  /** The first `n` bytes only (cheap for deflated zip entries). */
  prefix(path: string, n: number): Uint8Array<ArrayBuffer> | null;
}

const decoder = new TextDecoder();

/** A reader over a zip or tar archive value; null for other sources. */
export function entryReader(v: ArchiveValue): EntryReader | null {
  const src = v.source;
  if (src.type !== 'zip' && src.type !== 'tar') return null;
  const index = new Map<string, number>();
  v.entries.forEach((e, i) => {
    if (!e.isDir && !index.has(e.path)) index.set(e.path, i);
  });
  const entry = (path: string): { e: ArchiveEntry; i: number } | null => {
    const i = index.get(path);
    const e = i === undefined ? undefined : v.entries[i];
    return i === undefined || !e ? null : { e, i };
  };
  const bytes = (path: string, cap = MAX_MANIFEST_BYTES): Uint8Array<ArrayBuffer> | null => {
    const found = entry(path);
    if (!found || found.e.size > cap) return null;
    try {
      if (src.type === 'zip') {
        const record = src.records[found.i];
        return record ? extractZipEntry(src.bytes, found.e, record, false) : null;
      }
      const offset = src.offsets[found.i];
      return offset === undefined ? null : src.bytes.slice(offset, offset + found.e.size);
    } catch {
      return null;
    }
  };
  const text = (path: string, cap?: number) => {
    const b = bytes(path, cap);
    return b ? decoder.decode(b) : null;
  };
  return {
    files: [...index.keys()],
    has: path => index.has(path),
    bytes,
    text,
    json(path) {
      const t = text(path);
      if (t === null) return null;
      try {
        const parsed: unknown = JSON.parse(t.replace(/^\uFEFF/, ''));
        return isRecord(parsed) ? parsed : null;
      } catch {
        return null;
      }
    },
    prefix(path, n) {
      const found = entry(path);
      if (!found) return null;
      if (src.type === 'tar') {
        const offset = src.offsets[found.i];
        return offset === undefined
          ? null
          : src.bytes.slice(offset, offset + Math.min(n, found.e.size));
      }
      const record = src.records[found.i];
      return record ? readZipPrefix(src.bytes, found.e, record, n) : null;
    },
  };
}

/** A string property, or null. */
export const str = (o: Record<string, unknown>, key: string): string | null => {
  const v = o[key];
  return typeof v === 'string' ? v : null;
};

/** A string array property (non-strings dropped), or []. */
export const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
