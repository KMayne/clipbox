import { detectMagic, type MagicType } from './magic';

/** Decoded view of a raw entry shared by all interpreters; parse results are memoised in `memo`. */
export interface EntryContent {
  mime: string;
  name?: string;
  size: number;
  bytes: Uint8Array;
  /** UTF-8 text if the bytes are textual, otherwise null. */
  text: string | null;
  magic: MagicType | null;
  memo: Map<string, unknown>;
}

const TEXTUAL_MIME = /^text\/|[/+](json|xml|javascript|ecmascript|yaml|csv|x-sh)\b/;

export function makeContent(mime: string, bytes: Uint8Array, name?: string): EntryContent {
  const magic = detectMagic(bytes);
  return {
    mime,
    name,
    size: bytes.byteLength,
    bytes,
    text: decodeText(mime, bytes, magic),
    magic,
    memo: new Map(),
  };
}

function decodeText(mime: string, bytes: Uint8Array, magic: MagicType | null): string | null {
  if (magic && magic !== 'svg') return null;
  if (!TEXTUAL_MIME.test(mime) && bytes.subarray(0, 8192).includes(0)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export function memo<T>(c: EntryContent, key: string, compute: () => T): T {
  if (!c.memo.has(key)) c.memo.set(key, compute());
  return c.memo.get(key) as T;
}
