/** Archive values shared by the core `archive` interpreter (zip/gzip/tar) and the `libarchive` module. */

import type { PackageInfo } from './packages/types';

export type ArchiveFormat =
  | 'zip'
  | 'gzip'
  | 'tar'
  | 'tar.gz'
  | '7z'
  | 'rar'
  | 'xz'
  | 'tar.xz'
  | 'bz2'
  | 'tar.bz2'
  | 'zstd'
  | 'tar.zst'
  /** A zip behind a Chrome extension header. */
  | 'crx'
  | 'rpm';

export interface ArchiveEntry {
  /** Directories end with '/'. */
  path: string;
  /** Uncompressed size in bytes (declared by the archive). */
  size: number;
  compressedSize?: number;
  /** ISO 8601; without a zone when the archive stores local time (zip DOS dates). */
  modified?: string;
  isDir: boolean;
}

/** A zip central-directory record: what extraction needs beyond the entry itself. */
export interface ZipRecord {
  localOffset: number;
  method: number;
  flags: number;
}

/** Where entry data comes from; entries[i] pairs with records[i] / offsets[i]. */
export type ArchiveSource =
  | { type: 'zip'; bytes: Uint8Array<ArrayBuffer>; records: ZipRecord[] }
  /** Tar bytes, decompressed for tar.gz etc.; offsets of each entry's data. */
  | { type: 'tar'; bytes: Uint8Array<ArrayBuffer>; offsets: number[] }
  /**
   * One compressed file (gzip, zstd). `data` is the decompressed content, or null when it was too
   * big to decompress up front (extraction then needs confirmation).
   */
  | { type: 'single'; bytes: Uint8Array<ArrayBuffer>; data: Uint8Array<ArrayBuffer> | null }
  /**
   * An RPM payload: a cpio archive, gzip-compressed or not (core); `names` are the cpio paths
   * ("./usr/bin/x"). RPMs with xz/zstd/bzip2 payloads belong to libarchive ('external').
   */
  | {
      type: 'cpio';
      bytes: Uint8Array<ArrayBuffer>;
      payloadOffset: number;
      /** From the header: core reads 'gzip' and 'none' (or ''). */
      compressor: string;
      names: string[];
    }
  /** Extracted by the owning module (libarchive) from the original bytes, by the entry's raw name. */
  | { type: 'external'; bytes: Uint8Array<ArrayBuffer>; names: string[] };

export interface ArchiveValue {
  kind: 'archive';
  format: ArchiveFormat;
  /** Size of the archive itself. */
  archiveBytes: number;
  entries: ArchiveEntry[];
  source: ArchiveSource;
  /** Set when the archive was recognised but can't be listed; the chip says "unsupported". */
  unsupported?: string;
  /** Extra information shown in stats, e.g. why a gzip wasn't decompressed up front. */
  note?: string;
  /** A package manifest recognised inside (jar, browser extension, APK, wheel, npm, RPM, …). */
  package?: PackageInfo;
}

/** Refuse to extract (without confirmation) entries bigger than this… */
export const MAX_ENTRY_BYTES = 200 * 1024 * 1024;
/** …or whose declared compression ratio is above this. */
export const MAX_RATIO = 1000;

/** Prefix added to a derivation id to skip the guard once the user has confirmed. */
export const FORCE_PREFIX = '\u0000force:';
/** Start of every guard error message, so the UI can offer to extract anyway. */
export const GUARD_MESSAGE = 'Extraction blocked:';

export class ExtractionGuardError extends Error {
  constructor(reason: string) {
    super(`${GUARD_MESSAGE} ${reason}`);
    this.name = 'ExtractionGuardError';
  }
}

export const isTarFormat = (f: ArchiveFormat) => f === 'tar' || f.startsWith('tar.');

/** Output cap while decompressing: the size limit, tightened by the ratio limit. */
export const outputCap = (compressedBytes: number, force: boolean) =>
  force ? Infinity : Math.min(MAX_ENTRY_BYTES, Math.max(compressedBytes, 1) * MAX_RATIO);

/** Throws an ExtractionGuardError when an entry looks too big or too compressed. */
export function checkGuard(e: ArchiveEntry, force: boolean): void {
  if (force) return;
  const mb = (n: number) => `${Math.round(n / 1024 / 1024)} MB`;
  if (e.size > MAX_ENTRY_BYTES) {
    throw new ExtractionGuardError(
      `${e.path} is ${mb(e.size)} uncompressed (limit ${mb(MAX_ENTRY_BYTES)}).`,
    );
  }
  if (e.compressedSize !== undefined && e.size > Math.max(e.compressedSize, 1) * MAX_RATIO) {
    const ratio = e.compressedSize > 0 ? Math.round(e.size / e.compressedSize) : Infinity;
    throw new ExtractionGuardError(
      `${e.path} declares a ${ratio}:1 compression ratio (limit ${MAX_RATIO}:1), a possible zip bomb.`,
    );
  }
}

/** Thrown by capped decompressors when output passes the cap. */
export function capExceeded(path: string): ExtractionGuardError {
  return new ExtractionGuardError(
    `${path} decompresses to more than ${MAX_ENTRY_BYTES / 1024 / 1024} MB or ${MAX_RATIO}× its compressed size.`,
  );
}

/** Concatenates chunks into one ArrayBuffer-backed array. */
export function concat(chunks: Uint8Array[], total: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

const MIME: Record<string, string> = {
  json: 'application/json',
  geojson: 'application/geo+json',
  ndjson: 'application/x-ndjson',
  jsonl: 'application/x-ndjson',
  txt: 'text/plain',
  log: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  html: 'text/html',
  htm: 'text/html',
  xml: 'application/xml',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  js: 'text/javascript',
  mjs: 'text/javascript',
  ts: 'text/plain',
  css: 'text/css',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  pdf: 'application/pdf',
  zip: 'application/zip',
  gz: 'application/gzip',
  tgz: 'application/gzip',
  tar: 'application/x-tar',
  wasm: 'application/wasm',
  pem: 'application/x-pem-file',
  crt: 'application/x-pem-file',
};

export const extension = (path: string) => {
  const base = basename(path);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
};

export const basename = (path: string) => path.replace(/\/+$/, '').split('/').pop() ?? path;

export const guessMime = (path: string) => MIME[extension(path)] ?? 'application/octet-stream';

/** Strips leading './' and '/', so tar paths look like zip paths; '' for the root itself. */
export function normalisePath(path: string, isDir: boolean): string {
  const p = path.replace(/^(\.?\/)+/, '');
  if (p === '' || p === '.') return '';
  return isDir && !p.endsWith('/') ? `${p}/` : p;
}
