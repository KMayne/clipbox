/**
 * Bounds-checked reads over untrusted bytes. Every read checks its range and throws a
 * `FormatError` (never a bare RangeError), so parsers can catch per-structure failures and keep
 * what they already have.
 */

export class FormatError extends Error {
  override name = 'FormatError';
}

const hex = (n: number) => `0x${n.toString(16)}`;

export class Reader {
  readonly dv: DataView;
  readonly length: number;

  constructor(
    readonly bytes: Uint8Array<ArrayBuffer>,
    /** Little-endian unless told otherwise. */
    readonly little = true,
  ) {
    this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.length = bytes.byteLength;
  }

  /** A reader over the same bytes with different endianness. */
  withEndian(little: boolean): Reader {
    return little === this.little ? this : new Reader(this.bytes, little);
  }

  has(offset: number, size: number): boolean {
    return (
      Number.isSafeInteger(offset) &&
      Number.isSafeInteger(size) &&
      offset >= 0 &&
      size >= 0 &&
      offset + size <= this.length
    );
  }

  check(offset: number, size: number, what = 'data'): void {
    if (!this.has(offset, size)) {
      throw new FormatError(`${what} at ${hex(offset)} runs past the end of the file`);
    }
  }

  u8(o: number): number {
    this.check(o, 1);
    return this.dv.getUint8(o);
  }
  u16(o: number): number {
    this.check(o, 2);
    return this.dv.getUint16(o, this.little);
  }
  u32(o: number): number {
    this.check(o, 4);
    return this.dv.getUint32(o, this.little);
  }
  i32(o: number): number {
    this.check(o, 4);
    return this.dv.getInt32(o, this.little);
  }
  /** As a number; values past 2^53 lose precision (only used for addresses and sizes). */
  u64(o: number): number {
    this.check(o, 8);
    return Number(this.dv.getBigUint64(o, this.little));
  }
  /** Exact 64-bit value, for display as hex. */
  u64big(o: number): bigint {
    this.check(o, 8);
    return this.dv.getBigUint64(o, this.little);
  }

  /** A copy of `size` bytes (bounds-checked). */
  slice(o: number, size: number, what?: string): Uint8Array<ArrayBuffer> {
    this.check(o, size, what);
    return this.bytes.slice(o, o + size);
  }

  /** A view (no copy); clamped to the end of the file. */
  view(o: number, size: number): Uint8Array<ArrayBuffer> {
    const from = Math.max(0, Math.min(o, this.length));
    return this.bytes.subarray(from, Math.min(this.length, from + Math.max(0, size)));
  }

  /** NUL-terminated Latin-1/ASCII string, at most `max` bytes; '' when out of range. */
  cstr(o: number, max = 1024): string {
    if (!this.has(o, 0)) return '';
    const end = Math.min(this.length, o + max);
    let i = o;
    while (i < end && this.bytes[i] !== 0) i++;
    return latin1(this.bytes.subarray(o, i));
  }

  /** NUL-terminated UTF-8 string, at most `max` bytes. */
  cstrUtf8(o: number, max = 1024): string {
    if (!this.has(o, 0)) return '';
    const end = Math.min(this.length, o + max);
    let i = o;
    while (i < end && this.bytes[i] !== 0) i++;
    return new TextDecoder().decode(this.bytes.subarray(o, i));
  }

  /** Fixed-size field padded with NULs, e.g. a section name. */
  fixedStr(o: number, size: number): string {
    this.check(o, size);
    return this.cstr(o, size);
  }

  /** UTF-16LE string of `chars` code units. */
  utf16(o: number, chars: number): string {
    this.check(o, chars * 2);
    return new TextDecoder('utf-16le').decode(this.bytes.subarray(o, o + chars * 2));
  }

  /** NUL-terminated UTF-16LE string; returns the text and the offset after the terminator. */
  utf16z(o: number, maxChars = 1024): { text: string; end: number } {
    let i = o;
    const limit = Math.min(this.length - 1, o + maxChars * 2);
    while (i < limit && (this.bytes[i] !== 0 || this.bytes[i + 1] !== 0)) i += 2;
    const text = new TextDecoder('utf-16le').decode(this.bytes.subarray(o, Math.max(o, i)));
    return { text, end: i + 2 };
  }
}

export function latin1(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x2000) {
    s += String.fromCharCode(...b.subarray(i, Math.min(b.length, i + 0x2000)));
  }
  return s;
}

/** Runs `f`, recording its error message in `warnings` instead of throwing. */
export function attempt<T>(warnings: string[], what: string, f: () => T): T | null {
  try {
    return f();
  } catch (e) {
    warnings.push(`${what}: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

export const toHexAddress = (n: number | bigint, width = 8) =>
  `0x${n.toString(16).toUpperCase().padStart(width, '0')}`;

export const align = (n: number, to: number) => Math.ceil(n / to) * to;

/** Shannon entropy in bits per byte (0–8). */
export function entropy(b: Uint8Array): number {
  if (b.length === 0) return 0;
  const counts = new Uint32Array(256);
  for (const x of b) counts[x] = (counts[x] ?? 0) + 1;
  let h = 0;
  for (const c of counts) {
    if (c === 0) continue;
    const p = c / b.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/** Entropy above this suggests compressed or encrypted contents. */
export const PACKED_ENTROPY = 7.2;
