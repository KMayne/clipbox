/** Minimal tar reader: ustar, GNU long names ('L') and pax path/size records ('x'). */

import { normalisePath, type ArchiveValue } from './types';

export interface TarEntry {
  path: string;
  size: number;
  modified?: string;
  isDir: boolean;
  /** Offset of the entry's data in the tar bytes. */
  offset: number;
}

const BLOCK = 512;

const latin1 = new TextDecoder('latin1');
const utf8 = new TextDecoder('utf-8');

function cstr(b: Uint8Array, from: number, len: number, decoder = utf8): string {
  const field = b.subarray(from, from + len);
  const end = field.indexOf(0);
  return decoder.decode(end === -1 ? field : field.subarray(0, end));
}

/** Octal number field, or GNU base-256 when the high bit of the first byte is set. */
function num(b: Uint8Array, from: number, len: number): number {
  const first = b[from] ?? 0;
  if (first & 0x80) {
    let n = first & 0x7f;
    for (let i = 1; i < len; i++) n = n * 256 + (b[from + i] ?? 0);
    return n;
  }
  const s = cstr(b, from, len, latin1).trim();
  return s === '' ? 0 : parseInt(s, 8);
}

function checksumOk(h: Uint8Array): boolean {
  const stored = num(h, 148, 8);
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : (h[i] ?? 0);
  return Number.isFinite(stored) && sum === stored;
}

/** 'ustar' magic at offset 257 and a valid header checksum. */
export function isTar(b: Uint8Array): boolean {
  if (b.length < BLOCK) return false;
  if (latin1.decode(b.subarray(257, 262)) !== 'ustar') return false;
  return checksumOk(b.subarray(0, BLOCK));
}

/** pax extended header records: "<len> <key>=<value>\n". */
function paxRecords(data: Uint8Array): Map<string, string> {
  const out = new Map<string, string>();
  const text = utf8.decode(data);
  let i = 0;
  while (i < text.length) {
    const space = text.indexOf(' ', i);
    if (space === -1) break;
    const len = parseInt(text.slice(i, space), 10);
    if (!Number.isFinite(len) || len <= 0) break;
    // Lengths count bytes; records are almost always ASCII, so treat as characters
    const record = text.slice(space + 1, i + len - 1);
    const eq = record.indexOf('=');
    if (eq > 0) out.set(record.slice(0, eq), record.slice(eq + 1));
    i += len;
  }
  return out;
}

const isoFromUnix = (s: number) => new Date(s * 1000).toISOString().replace('.000Z', 'Z');

/** Lists regular files and directories; links and devices are skipped. Stops at a truncated entry. */
export function readTar(b: Uint8Array): TarEntry[] {
  const entries: TarEntry[] = [];
  let longName: string | null = null;
  let pax = new Map<string, string>();
  for (let at = 0; at + BLOCK <= b.length;) {
    const h = b.subarray(at, at + BLOCK);
    if (h.every(x => x === 0)) break;
    if (!checksumOk(h)) throw new Error(`Corrupt tar header at offset ${at}`);
    const type = String.fromCharCode(h[156] ?? 0);
    const size = pax.has('size') ? Number(pax.get('size')) : num(h, 124, 12);
    const data = at + BLOCK;
    if (data + size > b.length) break;
    const next = data + Math.ceil(size / BLOCK) * BLOCK;

    if (type === 'L') {
      longName = cstr(b, data, size);
    } else if (type === 'x') {
      pax = paxRecords(b.subarray(data, data + size));
    } else if (type === 'g') {
      // Global pax header: nothing we use
    } else {
      const prefix = latin1.decode(h.subarray(257, 262)) === 'ustar' ? cstr(h, 345, 155) : '';
      const name = cstr(h, 0, 100);
      const raw = pax.get('path') ?? longName ?? (prefix ? `${prefix}/${name}` : name);
      const isDir = type === '5' || ((type === '0' || type === '\0') && raw.endsWith('/'));
      const isFile = !isDir && (type === '0' || type === '\0' || type === '7');
      const path = normalisePath(raw, isDir);
      if ((isDir || isFile) && path !== '') {
        const mtime = pax.has('mtime') ? Number(pax.get('mtime')) : num(h, 136, 12);
        entries.push({
          path,
          size: isDir ? 0 : size,
          ...(mtime > 0 && Number.isFinite(mtime)
            ? { modified: isoFromUnix(Math.floor(mtime)) }
            : {}),
          isDir,
          offset: data,
        });
      }
      longName = null;
      pax = new Map();
    }
    at = next;
  }
  return entries;
}

/** An archive value for tar bytes (plain, or already decompressed from tar.gz etc.). */
export function tarValue(
  bytes: Uint8Array<ArrayBuffer>,
  format: ArchiveValue['format'],
  archiveBytes: number,
): ArchiveValue {
  const entries = readTar(bytes);
  return {
    kind: 'archive',
    format,
    archiveBytes,
    entries: entries.map(e => ({
      path: e.path,
      size: e.size,
      ...(e.modified ? { modified: e.modified } : {}),
      isDir: e.isDir,
    })),
    source: { type: 'tar', bytes, offsets: entries.map(e => e.offset) },
  };
}
