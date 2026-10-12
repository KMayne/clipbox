/**
 * MIME structure (RFC 2045–2049): the part tree, built with an explicit stack, transfer decoding
 * (base64, quoted-printable) and the facts each part's headers give (type, charset, disposition,
 * file name, Content-ID). Nested `message/rfc822` parts are kept whole, as attachments.
 */

import {
  byteString,
  decodeCharset,
  decodeWords,
  header,
  headerEnd,
  headerText,
  parseHeaderBlock,
  parseParams,
  type Header,
} from './headers';

/** Parts read from one message; the rest are left out (and a warning says so). */
export const MAX_PARTS = 500;
/** Multipart nesting deeper than this is kept as one opaque part. */
export const MAX_DEPTH = 16;
/** Header blocks longer than this are cut short. */
export const MAX_HEADER_BYTES = 1024 * 1024;

export interface MimePart {
  /** Position in document order (depth-first). */
  index: number;
  parent: number | null;
  depth: number;
  headers: Header[];
  /** Lower-case `type/subtype`; text/plain when absent. */
  type: string;
  params: Record<string, string>;
  charset: string | null;
  disposition: 'inline' | 'attachment' | null;
  /** From Content-Disposition's filename, else Content-Type's name. Decoded. */
  filename: string | null;
  /** Without angle brackets. */
  contentId: string | null;
  /** Lower-case, e.g. "base64"; "7bit" when absent. */
  encoding: string;
  /** Children's indexes (multiparts only). */
  children: number[];
  /** Transfer-decoded body; empty for multiparts. */
  bytes: Uint8Array<ArrayBuffer>;
}

export interface MimeTree {
  /** parts[0] is the message itself. */
  parts: MimePart[];
  warnings: string[];
}

// --- Transfer decoding ---

export function decodeBase64Body(s: string): Uint8Array<ArrayBuffer> {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
  const usable = clean.slice(0, clean.length - (clean.length % 4 === 1 ? 1 : 0));
  const out = new Uint8Array(Math.floor((usable.length * 3) / 4));
  let o = 0;
  // In chunks, so atob never sees a huge string
  const CHUNK = 4 * 16384;
  for (let i = 0; i < usable.length; i += CHUNK) {
    let piece = usable.slice(i, i + CHUNK);
    if (piece.length % 4) piece += '='.repeat(4 - (piece.length % 4));
    const bin = atob(piece);
    for (let j = 0; j < bin.length; j++) out[o++] = bin.charCodeAt(j);
  }
  return out.slice(0, o);
}

/** Index of the first character at or after `i` that isn't a space or tab. */
function skipBlanks(s: string, i: number): number {
  while (s.charCodeAt(i) === 0x20 || s.charCodeAt(i) === 0x09) i++;
  return i;
}

/** Length of the line break at `i` (CRLF or LF), 0 if there is none. */
const lineBreak = (s: string, i: number) =>
  s.charCodeAt(i) === 0x0a ? 1 : s.charCodeAt(i) === 0x0d && s.charCodeAt(i + 1) === 0x0a ? 2 : 0;

const hexDigit = (c: number) =>
  c >= 48 && c <= 57 ? c - 48 : c >= 65 && c <= 70 ? c - 55 : c >= 97 && c <= 102 ? c - 87 : -1;

/** Quoted-printable: `=XX` escapes, `=` soft line breaks, trailing whitespace dropped. */
export function decodeQuotedPrintable(s: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(s.length);
  let o = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x3d) {
      const a = hexDigit(s.charCodeAt(i + 1));
      const b = hexDigit(s.charCodeAt(i + 2));
      if (a >= 0 && b >= 0) {
        out[o++] = a * 16 + b;
        i += 2;
        continue;
      }
      // Soft line break: "=", optional whitespace, then the line ending (or the end)
      const j = skipBlanks(s, i + 1);
      const nl = lineBreak(s, j);
      if (nl > 0 || j === s.length) {
        i = j + nl - 1;
        continue;
      }
      out[o++] = c;
    } else if (c === 0x20 || c === 0x09) {
      // Whitespace at the end of a line was added in transport
      const j = skipBlanks(s, i);
      if (lineBreak(s, j) > 0 || j === s.length) i = j - 1;
      else out[o++] = c;
    } else out[o++] = c & 0xff;
  }
  return out.slice(0, o);
}

function transferDecode(bytes: Uint8Array<ArrayBuffer>, encoding: string): Uint8Array<ArrayBuffer> {
  if (encoding === 'base64') return decodeBase64Body(byteString(bytes));
  if (encoding === 'quoted-printable') return decodeQuotedPrintable(byteString(bytes));
  return bytes.slice();
}

// --- The part tree ---

interface Pending {
  start: number;
  end: number;
  parent: number | null;
  depth: number;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Body ranges of a multipart's parts: between delimiter lines `--boundary`, ignoring the preamble
 * before the first and the epilogue after `--boundary--`. A missing close delimiter ends the last
 * part at the end of the body.
 */
function splitMultipart(text: string, start: number, end: number, boundary: string) {
  const parts: { start: number; end: number }[] = [];
  const delimiter = new RegExp(
    `(^|\\r?\\n)--${escapeRegex(boundary)}(--)?[ \\t]*(?=\\r?\\n|$)`,
    'g',
  );
  const body = text.slice(start, end);
  let partStart: number | null = null;
  for (const m of body.matchAll(delimiter)) {
    if (partStart !== null) parts.push({ start: start + partStart, end: start + m.index });
    if (m[2] === '--') return { parts, closed: true };
    // The part starts after the delimiter line's line break
    const after = m.index + m[0].length;
    const nl = /^\r?\n/.exec(body.slice(after, after + 2));
    partStart = after + (nl?.[0].length ?? 0);
    if (parts.length >= MAX_PARTS) break;
  }
  if (partStart !== null) parts.push({ start: start + partStart, end });
  return { parts, closed: false };
}

/** Parses a message (or a part of one) into its MIME parts, in document order. */
export function parseMime(bytes: Uint8Array<ArrayBuffer>): MimeTree {
  const text = byteString(bytes);
  const parts: MimePart[] = [];
  const warnings = new Set<string>();
  const stack: Pending[] = [{ start: 0, end: text.length, parent: null, depth: 0 }];
  for (let item = stack.pop(); item; item = stack.pop()) {
    if (parts.length >= MAX_PARTS) {
      warnings.add(`Only the first ${MAX_PARTS} parts were read`);
      break;
    }
    const { start, end, parent, depth } = item;
    const h = headerEnd(text, start, end);
    let headerBytesEnd = h.end;
    if (headerBytesEnd - start > MAX_HEADER_BYTES) {
      headerBytesEnd = start + MAX_HEADER_BYTES;
      warnings.add('A header block was too long and was cut short');
    }
    const { headers } = parseHeaderBlock(headerText(bytes.subarray(start, headerBytesEnd)));
    const ct = parseParams(header(headers, 'content-type') ?? '');
    const type = /^[\w.+-]+\/[\w.+-]+$/.test(ct.value)
      ? ct.value
      : parent !== null && parts[parent]?.type === 'multipart/digest'
        ? 'message/rfc822'
        : 'text/plain';
    const cd = parseParams(header(headers, 'content-disposition') ?? '');
    const disposition =
      cd.value === 'attachment' || cd.value === 'inline'
        ? cd.value
        : cd.value
          ? 'attachment'
          : null;
    const rawName = cd.params.filename ?? ct.params.name ?? null;
    const encoding = (header(headers, 'content-transfer-encoding') ?? '7bit').trim().toLowerCase();
    const cid = header(headers, 'content-id');
    const index = parts.length;
    const part: MimePart = {
      index,
      parent,
      depth,
      headers,
      type,
      params: ct.params,
      charset: ct.params.charset ?? null,
      disposition,
      filename: rawName === null ? null : decodeWords(rawName).trim() || null,
      contentId: cid ? cid.replace(/^\s*<|>\s*$/g, '').trim() || null : null,
      encoding,
      children: [],
      bytes: new Uint8Array(0),
    };
    parts.push(part);
    if (parent !== null) parts[parent]?.children.push(index);

    const boundary = ct.params.boundary;
    if (type.startsWith('multipart/') && boundary) {
      if (depth >= MAX_DEPTH) {
        warnings.add(`Parts nested deeper than ${MAX_DEPTH} levels were kept whole`);
        part.bytes = bytes.slice(h.bodyStart, end);
        continue;
      }
      const { parts: ranges, closed } = splitMultipart(text, h.bodyStart, end, boundary);
      if (!closed && ranges.length > 0) warnings.add('A multipart has no closing boundary');
      if (ranges.length >= MAX_PARTS) warnings.add(`Only the first ${MAX_PARTS} parts were read`);
      // Reversed, so they come off the stack in document order
      for (let i = ranges.length - 1; i >= 0; i--) {
        const r = ranges[i];
        if (r) stack.push({ start: r.start, end: r.end, parent: index, depth: depth + 1 });
      }
      continue;
    }
    part.bytes = transferDecode(bytes.slice(h.bodyStart, end), encoding);
  }
  return { parts, warnings: [...warnings] };
}

/** A text part's content in its charset (UTF-8, else windows-1252, when it names none). */
export function partText(part: MimePart): string {
  return part.charset === null ? headerText(part.bytes) : decodeCharset(part.bytes, part.charset);
}
