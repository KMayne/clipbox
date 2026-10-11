/** Printable strings in binary data, like the Unix `strings` tool (ASCII and UTF-16LE). */
import { checkpoint, type TaskContext } from '../progress';

export interface FoundString {
  offset: number;
  text: string;
  encoding: 'ascii' | 'utf16';
}

export interface StringsOptions {
  minLength: number;
  encoding: 'both' | 'ascii' | 'utf16';
  /** Stop after this many strings. */
  max: number;
}

/** Bytes scanned between progress yields. */
const STEP = 1 << 20;

/** Longest single string kept; longer runs are cut. */
const MAX_STRING = 4096;

const printable = (c: number) => (c >= 0x20 && c < 0x7f) || c === 0x09;

/** Scanners yield the bytes scanned so far every STEP bytes, so callers can report and cancel. */
function* scanAscii(b: Uint8Array, min: number, max: number, out: FoundString[]) {
  let start = -1;
  let count = 0;
  const flush = (end: number) => {
    if (start >= 0 && end - start >= min) {
      let s = '';
      for (let i = start; i < Math.min(end, start + MAX_STRING); i++)
        s += String.fromCharCode(b[i] ?? 0);
      out.push({ offset: start, text: s, encoding: 'ascii' });
      count++;
    }
    start = -1;
  };
  for (let i = 0; i < b.length && count <= max; i++) {
    if (i % STEP === 0 && i > 0) yield i;
    if (printable(b[i] ?? 0)) {
      if (start < 0) start = i;
    } else flush(i);
  }
  if (count <= max) flush(b.length);
}

function* scanUtf16(b: Uint8Array, min: number, max: number, out: FoundString[]) {
  let count = 0;
  for (let parity = 0; parity < 2; parity++) {
    let start = -1;
    let s = '';
    const flush = () => {
      if (start >= 0 && s.length >= min) {
        out.push({ offset: start, text: s.slice(0, MAX_STRING), encoding: 'utf16' });
        count++;
      }
      start = -1;
      s = '';
    };
    for (let i = parity; i + 1 < b.length && count <= max; i += 2) {
      if (i % STEP < 2 && i > 1) yield (parity * b.length + i) / 2;
      const c = b[i] ?? 0;
      if (b[i + 1] === 0 && printable(c)) {
        if (start < 0) start = i;
        if (s.length < MAX_STRING) s += String.fromCharCode(c);
      } else flush();
    }
    if (count <= max) flush();
  }
}

interface StringsResult {
  strings: FoundString[];
  truncated: boolean;
}

/**
 * Runs the scanners, yielding progress (0..1) every STEP bytes and finally returning the
 * strings in file order; `truncated` when more than `max` were found.
 */
function* scan(
  b: Uint8Array,
  { minLength, encoding, max }: StringsOptions,
): Generator<number, StringsResult> {
  const min = Math.max(1, Math.floor(minLength));
  const found: FoundString[] = [];
  const passes = encoding === 'both' ? 2 : 1;
  const total = Math.max(1, b.length * passes);
  if (encoding !== 'utf16') for (const at of scanAscii(b, min, max, found)) yield at / total;
  if (encoding !== 'ascii') {
    const before = encoding === 'both' ? b.length : 0;
    for (const at of scanUtf16(b, min, max, found)) yield (before + at) / total;
  }
  if (encoding === 'both' || encoding === 'utf16') found.sort((x, y) => x.offset - y.offset);
  return { strings: found.slice(0, max), truncated: found.length > max };
}

/** Strings in file order; `truncated` when more than `max` were found. */
export function findStrings(b: Uint8Array, options: StringsOptions): StringsResult {
  const it = scan(b, options);
  for (;;) {
    const step = it.next();
    if (step.done) return step.value;
  }
}

/** `findStrings` for big files: reports progress and stops on cancel, yielding between steps. */
export async function findStringsAsync(
  b: Uint8Array,
  options: StringsOptions,
  task: TaskContext,
): Promise<StringsResult> {
  const it = scan(b, options);
  for (;;) {
    await checkpoint(task.signal);
    const step = it.next();
    if (step.done) return step.value;
    task.progress(step.value, 'Scanning');
  }
}
