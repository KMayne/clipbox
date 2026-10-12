/**
 * A streaming reader for "newc" cpio archives (magic 070701, or 070702 with checksums), as in RPM
 * payloads: a 110-byte ASCII-hex header, the name (padded to 4 bytes with the header), then the
 * data (padded to 4). Fed decompressed chunks, it records entries and keeps only the one wanted,
 * so finding a file never holds the whole payload.
 */

import { capExceeded, concat, normalisePath } from './types';

const HEADER = 110;
const TRAILER = 'TRAILER!!!';
const S_IFMT = 0o170000;
export const S_IFDIR = 0o040000;
export const S_IFREG = 0o100000;
export const S_IFLNK = 0o120000;

export interface CpioEntry {
  /** As stored, e.g. "./usr/bin/tool". */
  name: string;
  mode: number;
  size: number;
  mtime: number;
}

const latin1 = new TextDecoder('latin1');
const utf8 = new TextDecoder();
const pad4 = (n: number) => Math.ceil(n / 4) * 4;

/** Compares cpio names the way archive entries are listed ("./usr/x" and "usr/x" match). */
const sameName = (a: string, b: string) => normalisePath(a, false) === normalisePath(b, false);

export const isRegular = (mode: number) => (mode & S_IFMT) === S_IFREG;
export const isDirectory = (mode: number) => (mode & S_IFMT) === S_IFDIR;
export const isSymlink = (mode: number) => (mode & S_IFMT) === S_IFLNK;

export class CpioReader {
  readonly entries: CpioEntry[] = [];
  /** The wanted entry's data, once read. */
  found: Uint8Array<ArrayBuffer> | null = null;
  /** True after the trailer, or once the wanted entry has been read. */
  done = false;
  private pending: Uint8Array = new Uint8Array(0);
  /** Bytes of the current entry still to come (data plus padding), and of data alone. */
  private remaining = 0;
  private dataLeft = 0;
  private collect: Uint8Array[] | null = null;
  private collected = 0;
  /** A hard link to the target came without data; it follows on the last link (same inode). */
  private linkedIno: number | null = null;

  /**
   * @param target entry to keep (compared without leading "./" or "/"), or null to only list
   * @param cap most bytes the wanted entry may have
   */
  constructor(
    private readonly target: string | null = null,
    private readonly cap = Infinity,
  ) {}

  push(chunk: Uint8Array): void {
    let data = chunk;
    while (!this.done) {
      if (this.remaining > 0) {
        const take = Math.min(this.remaining, data.length);
        if (take === 0) return;
        const useful = Math.min(take, this.dataLeft);
        if (this.collect && useful > 0) {
          this.collected += useful;
          if (this.collected > this.cap) throw capExceeded(this.target ?? 'entry');
          this.collect.push(data.slice(0, useful));
        }
        this.dataLeft -= useful;
        this.remaining -= take;
        data = data.subarray(take);
        if (this.remaining === 0) this.finishEntry();
        continue;
      }
      // Gather a whole header and name before parsing (they're small)
      if (data.length > 0) {
        const joined = new Uint8Array(this.pending.length + data.length);
        joined.set(this.pending);
        joined.set(data, this.pending.length);
        this.pending = joined;
      }
      const rest = this.readHeader();
      if (rest === null) return;
      data = rest;
    }
  }

  /** Parses a header from `pending`; returns the bytes after it, or null if more are needed. */
  private readHeader(): Uint8Array | null {
    const p = this.pending;
    if (p.length < HEADER) return null;
    const magic = latin1.decode(p.subarray(0, 6));
    if (magic !== '070701' && magic !== '070702') {
      throw new Error(`Unsupported cpio format (magic ${JSON.stringify(magic)})`);
    }
    const field = (i: number) => parseInt(latin1.decode(p.subarray(6 + i * 8, 14 + i * 8)), 16);
    const ino = field(0);
    const mode = field(1);
    const nlink = field(4);
    const mtime = field(5);
    const size = field(6);
    const nameSize = field(11);
    if (![mode, size, nameSize].every(Number.isFinite) || nameSize < 1) {
      throw new Error('Corrupt cpio header');
    }
    const headerEnd = pad4(HEADER + nameSize);
    if (p.length < headerEnd) return null;
    const name = utf8.decode(p.subarray(HEADER, HEADER + nameSize - 1));
    const rest = p.subarray(headerEnd);
    this.pending = new Uint8Array(0);
    if (name === TRAILER) {
      this.done = true;
      return rest;
    }
    this.entries.push({ name, mode, size, mtime });
    this.remaining = pad4(size);
    this.dataLeft = size;
    const named = this.target !== null && sameName(name, this.target);
    if (named && size === 0 && nlink <= 1) {
      this.found = new Uint8Array(0);
      this.done = true;
      return rest;
    }
    if (named && size === 0) this.linkedIno = ino;
    const wanted = size > 0 && (named || (this.linkedIno !== null && ino === this.linkedIno));
    this.collect = wanted ? [] : null;
    this.collected = 0;
    if (this.remaining === 0) this.finishEntry();
    return rest;
  }

  private finishEntry() {
    if (this.collect) {
      this.found = concat(this.collect, this.collected);
      this.done = true;
    }
    this.collect = null;
  }
}

/** Lists an uncompressed cpio archive. */
export function listCpio(bytes: Uint8Array): CpioEntry[] {
  const r = new CpioReader();
  r.push(bytes);
  return r.entries;
}
