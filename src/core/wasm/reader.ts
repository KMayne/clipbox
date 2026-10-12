/**
 * A cursor over untrusted WebAssembly bytes: LEB128 integers, names and vectors, every read
 * bounds-checked against the cursor's end (a section's payload, or the file). Failures throw a
 * `FormatError` with the offset, so the parser can record a warning and keep what it has.
 */
import { FormatError } from '../executable/reader';

export { FormatError };

/** Most entries any one vector may declare; real modules stay far below it. */
export const MAX_ITEMS = 1_000_000;

const hex = (n: number) => `0x${n.toString(16)}`;

const utf8 = new TextDecoder();

export class WasmReader {
  pos: number;

  constructor(
    readonly bytes: Uint8Array<ArrayBuffer>,
    start = 0,
    /** Exclusive; reads never go past it. */
    readonly end = bytes.byteLength,
  ) {
    this.pos = start;
  }

  get remaining(): number {
    return this.end - this.pos;
  }

  get done(): boolean {
    return this.pos >= this.end;
  }

  /** A reader over the next `size` bytes, which this one skips. */
  sub(size: number, what = 'data'): WasmReader {
    this.need(size, what);
    const r = new WasmReader(this.bytes, this.pos, this.pos + size);
    this.pos += size;
    return r;
  }

  need(size: number, what = 'data'): void {
    if (!Number.isSafeInteger(size) || size < 0 || size > this.remaining) {
      throw new FormatError(`${what} at ${hex(this.pos)} runs past the end`);
    }
  }

  u8(what = 'byte'): number {
    this.need(1, what);
    const b = this.bytes[this.pos++];
    if (b === undefined) throw new FormatError(`${what} at ${hex(this.pos - 1)} is missing`);
    return b;
  }

  skip(size: number, what?: string): void {
    this.need(size, what);
    this.pos += size;
  }

  /** A view (no copy) of the next `size` bytes. */
  take(size: number, what?: string): Uint8Array<ArrayBuffer> {
    this.need(size, what);
    const v = this.bytes.subarray(this.pos, this.pos + size);
    this.pos += size;
    return v;
  }

  /** Unsigned LEB128 of at most 32 bits (5 bytes). */
  u32(what = 'integer'): number {
    const at = this.pos;
    let result = 0;
    for (let i = 0; i < 5; i++) {
      const b = this.u8(what);
      if (i === 4 && b & 0x70) throw new FormatError(`${what} at ${hex(at)} is over 32 bits`);
      result += (b & 0x7f) * 2 ** (7 * i);
      if ((b & 0x80) === 0) return result;
    }
    throw new FormatError(`${what} at ${hex(at)} is over 5 bytes`);
  }

  /** Unsigned LEB128 of at most 64 bits, as a number (exact below 2^53). */
  u64(what = 'integer'): number {
    const at = this.pos;
    let result = 0n;
    for (let i = 0; i < 10; i++) {
      const b = this.u8(what);
      result |= BigInt(b & 0x7f) << BigInt(7 * i);
      if ((b & 0x80) === 0) return Number(BigInt.asUintN(64, result));
    }
    throw new FormatError(`${what} at ${hex(at)} is over 10 bytes`);
  }

  /** Signed LEB128 of at most 32 bits. */
  s32(what = 'integer'): number {
    return Number(this.signed(32, what));
  }

  /** Signed LEB128 of at most 33 bits (heap types and block types). */
  s33(what = 'integer'): number {
    return Number(this.signed(33, what));
  }

  /** Signed LEB128 of at most 64 bits. */
  s64(what = 'integer'): bigint {
    return this.signed(64, what);
  }

  private signed(bits: number, what: string): bigint {
    const at = this.pos;
    const max = Math.ceil(bits / 7);
    let result = 0n;
    let shift = 0n;
    for (let i = 0; i < max; i++) {
      const b = this.u8(what);
      result |= BigInt(b & 0x7f) << shift;
      shift += 7n;
      if ((b & 0x80) === 0) {
        if (shift < 64n && b & 0x40) result -= 1n << shift;
        return BigInt.asIntN(bits, result);
      }
    }
    throw new FormatError(`${what} at ${hex(at)} is over ${max} bytes`);
  }

  /** A UTF-8 name: a length then its bytes (malformed sequences decode as U+FFFD). */
  name(what = 'name'): string {
    const n = this.u32(`${what} length`);
    return utf8.decode(this.take(n, what));
  }

  /**
   * A vector's length, checked against the bytes left (each entry takes at least `minBytes`) and
   * `MAX_ITEMS`, so a bogus count fails at once instead of looping or allocating.
   */
  count(what: string, minBytes = 1): number {
    const at = this.pos;
    const n = this.u32(`${what} count`);
    if (n > MAX_ITEMS) throw new FormatError(`${what} at ${hex(at)}: ${n} entries is too many`);
    if (n * minBytes > this.remaining) {
      throw new FormatError(
        `${what} at ${hex(at)} declares ${n} entries but only ${this.remaining} byte${this.remaining === 1 ? ' is' : 's are'} left`,
      );
    }
    return n;
  }
}
