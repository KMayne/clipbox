/** Base64 helpers shared by the base64 and jwt kinds. */

export type Base64Variant = 'standard' | 'url';

const STANDARD = /^[A-Za-z0-9+/]*={0,2}$/;
const URL_SAFE = /^[A-Za-z0-9_-]*={0,2}$/;

export interface Base64Shape {
  variant: Base64Variant;
  padded: boolean;
  /** Encoded characters without line breaks. */
  compact: string;
}

/**
 * Checks the alphabet, length and padding of `s` (line breaks allowed). Doesn't decode.
 * A string using neither `+/` nor `-_` counts as standard.
 */
export function base64Shape(s: string): Base64Shape | null {
  const compact = s.replace(/\r?\n/g, '');
  const urlChars = /[-_]/.test(compact);
  const stdChars = /[+/]/.test(compact);
  if (urlChars && stdChars) return null;
  const variant: Base64Variant = urlChars ? 'url' : 'standard';
  if (!(variant === 'url' ? URL_SAFE : STANDARD).test(compact)) return null;
  const padded = compact.endsWith('=');
  if (padded ? compact.length % 4 !== 0 : compact.length % 4 === 1) return null;
  return { variant, padded, compact };
}

/** Decodes standard or URL-safe base64, padded or not; null if it isn't valid. */
export function decodeBase64(s: string): Uint8Array<ArrayBuffer> | null {
  const shape = base64Shape(s);
  if (!shape) return null;
  try {
    const binary = atob(shape.compact.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(binary, ch => ch.charCodeAt(0));
  } catch {
    return null;
  }
}

/** UTF-8 text with no control characters other than tab and line breaks, else null. */
export function printableText(bytes: Uint8Array): string | null {
  if (bytes.length === 0) return null;
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f�]/.test(text) ? null : text;
}
