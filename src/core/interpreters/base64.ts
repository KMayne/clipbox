import { base64Shape, decodeBase64, printableText, type Base64Variant } from '../base64';
import { createMemo } from '../content';
import { formatBytes, formatCount } from '../format';
import { hasKind } from '../guards';
import { unsupportedSlice, type Interpreter } from '../interpreter';
import { detectMagic, isImageMagic, type MagicType } from '../magic';

export interface Base64Value {
  kind: 'base64';
  variant: Base64Variant;
  padded: boolean;
  bytes: Uint8Array<ArrayBuffer>;
  /** Declared by a data URL, otherwise detected from the decoded bytes. */
  mime: string;
  /** Decoded UTF-8 when it is printable text, else null. */
  text: string | null;
  /** Extra context for stats and labels. */
  encodedLength: number;
  dataUrl: boolean;
  magic: MagicType | null;
  json: boolean;
  /** The pasted text, trimmed (base64 or a data URL). */
  source: string;
}

const MAGIC_MIME: Record<MagicType, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  zip: 'application/zip',
  gzip: 'application/gzip',
  wasm: 'application/wasm',
  elf: 'application/x-elf',
};

const MIN_LENGTH = 16;
/** Shorter tokens are only accepted when they decode to word-like ASCII (see `wordy`). */
const MIN_SHORT_LENGTH = 12;
const DATA_URL = /^data:([^,;]*)((?:;[^,;]*)*);base64,([\s\S]*)$/i;
const HEX = /^[0-9a-fA-F]+$/;

function isJsonContainer(text: string): boolean {
  const t = text.trim();
  if (!/^[[{]/.test(t)) return false;
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
}

/** Opaque binary must at least look random: words and identifiers rarely mix all three classes. */
const looksRandom = (s: string) =>
  /\d/.test(s) && /[a-z]/.test(s) && /[A-Z]/.test(s) && (s.length >= 24 || /[+/=]/.test(s));

/**
 * Decoded text that reads like words or credentials: plain ASCII, mostly letters and spaces, with
 * a vowel. Identifiers and English words almost never decode to this by chance (none of ~20k
 * identifiers from the TypeScript DOM typings did), so it's safe for short tokens such as
 * `aGVsbG8gd29ybGQ` ("hello world").
 */
function wordy(text: string): boolean {
  return (
    /^[A-Za-z0-9 ,.'!?:;()@#&_/-]+$/.test(text) &&
    (text.match(/[A-Za-z ]/g)?.length ?? 0) >= text.length * 0.8 &&
    /[aeiou]/i.test(text)
  );
}

function build(
  encoded: string,
  declaredMime: string | null,
  source: string,
): Base64Value | null {
  const shape = base64Shape(encoded);
  const bytes = decodeBase64(encoded);
  if (!shape || !bytes || bytes.length === 0) return null;
  const magic = detectMagic(bytes);
  const text = magic && magic !== 'svg' ? null : printableText(bytes);
  const json = text !== null && isJsonContainer(text);
  const detectedMime = magic
    ? MAGIC_MIME[magic]
    : json
      ? 'application/json'
      : text !== null
        ? 'text/plain'
        : 'application/octet-stream';
  return {
    kind: 'base64',
    variant: shape.variant,
    padded: shape.padded,
    bytes,
    mime: declaredMime || detectedMime,
    text,
    encodedLength: shape.compact.length,
    dataUrl: declaredMime !== null,
    magic,
    json,
    source,
  };
}

const parseBase64 = createMemo((c): { value: Base64Value; confidence: number } | null => {
  const t = c.text?.trim();
  if (!t) return null;

  const dataUrl = DATA_URL.exec(t);
  if (dataUrl) {
    const encoded = (dataUrl[3] ?? '').replace(/\s+/g, '');
    const value = build(encoded, (dataUrl[1] ?? '').toLowerCase(), t);
    // data:;base64,… defaults to text/plain (RFC 2397)
    if (value && value.mime === '') value.mime = 'text/plain';
    return value ? { value, confidence: 0.95 } : null;
  }

  const compact = t.replace(/\r?\n/g, '');
  if (compact.length < MIN_SHORT_LENGTH || HEX.test(compact)) return null;
  const value = build(t, null, t);
  if (!value) return null;
  if (compact.length < MIN_LENGTH) {
    return value.text !== null && wordy(value.text) ? { value, confidence: 0.5 } : null;
  }
  if (value.magic || value.json) return { value, confidence: 0.85 };
  if (value.text !== null) return { value, confidence: 0.6 };
  return looksRandom(compact) ? { value, confidence: 0.4 } : null;
});

export function contentType(v: Base64Value): string {
  if (v.magic) return v.magic.toUpperCase();
  if (v.json) return 'JSON';
  if (v.text !== null) return 'text';
  return v.dataUrl ? v.mime : 'binary';
}

const isImage = (v: Base64Value) => isImageMagic(v.magic) || v.mime.startsWith('image/');

export const base64Interpreter: Interpreter<Base64Value> = {
  kind: 'base64',
  isValue: (v): v is Base64Value => hasKind(v, 'base64'),
  detect: c => parseBase64(c)?.confidence ?? 0,
  parse(c) {
    const r = parseBase64(c);
    if (!r) throw new Error('Not base64');
    return r.value;
  },
  label: v => `Base64 · ${contentType(v)} · ${formatBytes(v.bytes.byteLength)}`,
  summarise(v) {
    const lines = v.text?.split(/\r?\n/).length;
    return {
      // Drives the preview: text (Monaco when available) vs image or hex
      language: v.text === null || isImage(v) ? undefined : v.json ? 'json' : 'plaintext',
      stats: [
        { label: 'Source', value: v.dataUrl ? 'data URL' : 'base64 text' },
        { label: 'Encoded size', value: `${formatCount(v.encodedLength)} chars` },
        { label: 'Decoded size', value: formatBytes(v.bytes.byteLength) },
        { label: 'Variant', value: v.variant === 'url' ? 'URL-safe' : 'standard' },
        { label: 'Padding', value: v.padded ? 'yes' : 'no' },
        { label: 'Content type', value: contentType(v) },
        { label: 'MIME', value: v.mime },
        ...(lines === undefined ? [] : [{ label: 'Decoded lines', value: formatCount(lines) }]),
      ],
      extent: v.bytes.byteLength,
    };
  },
  slice(v, req) {
    if (req.type === 'bytes') return v.bytes.slice(req.from, req.to);
    if (req.type === 'text' && v.text !== null) return v.text;
    if (req.type === 'image' && isImage(v)) return { bytes: v.bytes, mime: v.mime };
    return unsupportedSlice('base64', req);
  },
  // Decoded text or image; other bytes can't go on the clipboard, so copy the base64 itself
  // (Open as → Decode gives the bytes as a capture)
  export(v) {
    if (v.text !== null) return { text: v.text };
    if (isImage(v)) return { image: { bytes: v.bytes, mime: v.mime } };
    return { text: v.source };
  },
  derivations: () => [{ id: 'decode', label: 'Decode' }],
  derive: v => ({ mime: v.mime, bytes: v.bytes }),
};
