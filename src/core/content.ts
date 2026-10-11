import { detectMagic, type MagicType } from './magic';

/** Decoded view of a raw entry shared by all interpreters. */
export interface EntryContent {
  mime: string;
  name?: string;
  size: number;
  bytes: Uint8Array<ArrayBuffer>;
  /** UTF-8 text if the bytes are textual, otherwise null. */
  text: string | null;
  magic: MagicType | null;
}

const TEXTUAL_MIME = /^text\/|[/+](json|xml|javascript|ecmascript|yaml|csv|x-sh)\b/;

export function makeContent(
  mime: string,
  bytes: Uint8Array<ArrayBuffer>,
  name?: string,
): EntryContent {
  const magic = detectMagic(bytes);
  return {
    mime,
    name,
    size: bytes.byteLength,
    bytes,
    text: decodeText(mime, bytes, magic),
    magic,
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

/**
 * A per-content memo: each memo has its own typed cache, so interpreters can share parse
 * results (e.g. JSON parsed once for both the json and records kinds) without casts.
 */
export function createMemo<T>(compute: (c: EntryContent) => T): (c: EntryContent) => T {
  const cache = new WeakMap<EntryContent, { value: T }>();
  return c => {
    let hit = cache.get(c);
    if (!hit) {
      hit = { value: compute(c) };
      cache.set(c, hit);
    }
    return hit.value;
  };
}
