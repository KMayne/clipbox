/** Printable strings in binary data, like the Unix `strings` tool (ASCII and UTF-16LE). */

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

/** Longest single string kept; longer runs are cut. */
const MAX_STRING = 4096;

const printable = (c: number) => (c >= 0x20 && c < 0x7f) || c === 0x09;

function scanAscii(b: Uint8Array, min: number, max: number, out: FoundString[]) {
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
    if (printable(b[i] ?? 0)) {
      if (start < 0) start = i;
    } else flush(i);
  }
  if (count <= max) flush(b.length);
}

function scanUtf16(b: Uint8Array, min: number, max: number, out: FoundString[]) {
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
      const c = b[i] ?? 0;
      if (b[i + 1] === 0 && printable(c)) {
        if (start < 0) start = i;
        if (s.length < MAX_STRING) s += String.fromCharCode(c);
      } else flush();
    }
    if (count <= max) flush();
  }
}

/** Strings in file order; `truncated` when more than `max` were found. */
export function findStrings(
  b: Uint8Array,
  { minLength, encoding, max }: StringsOptions,
): { strings: FoundString[]; truncated: boolean } {
  const min = Math.max(1, Math.floor(minLength));
  const found: FoundString[] = [];
  if (encoding !== 'utf16') scanAscii(b, min, max, found);
  if (encoding !== 'ascii') scanUtf16(b, min, max, found);
  if (encoding === 'both' || encoding === 'utf16') found.sort((x, y) => x.offset - y.offset);
  return { strings: found.slice(0, max), truncated: found.length > max };
}
