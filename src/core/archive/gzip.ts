/** gzip header parsing and capped decompression of a single member. */

import { Gunzip } from 'fflate';
import { outputCap } from './types';
import { inflateCapped } from './zip';

export interface GzipHeader {
  /** Original filename from the FNAME field. */
  name?: string;
  /** ISO 8601, from MTIME when set. */
  modified?: string;
  /** ISIZE: uncompressed size mod 2^32, as declared by the trailer. */
  declaredSize: number;
}

const FEXTRA = 4;
const FNAME = 8;

/** Null unless the bytes start with a plausible gzip header (1f 8b, deflate, no reserved flags). */
export function parseGzipHeader(b: Uint8Array): GzipHeader | null {
  if (b.length < 18 || b[0] !== 0x1f || b[1] !== 0x8b || b[2] !== 8) return null;
  const flags = b[3] ?? 0;
  if (flags & 0xe0) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const mtime = dv.getUint32(4, true);
  let at = 10;
  if (flags & FEXTRA) at += 2 + dv.getUint16(at, true);
  let name: string | undefined;
  if (flags & FNAME) {
    const end = b.indexOf(0, at);
    if (end > at) name = new TextDecoder('latin1').decode(b.subarray(at, end));
  }
  return {
    ...(name ? { name } : {}),
    ...(mtime > 0 ? { modified: new Date(mtime * 1000).toISOString().replace('.000Z', 'Z') } : {}),
    declaredSize: dv.getUint32(b.length - 4, true),
  };
}

/** Decompresses, throwing an ExtractionGuardError once output passes the size/ratio cap. */
export function gunzipCapped(b: Uint8Array, path: string, force: boolean): Uint8Array<ArrayBuffer> {
  return inflateCapped(b, outputCap(b.byteLength, force), path, ondata => {
    const s = new Gunzip();
    s.ondata = chunk => ondata(chunk);
    return s;
  });
}

/** Name for the decompressed content: the header's FNAME, else the capture name without .gz. */
export function gunzippedName(header: GzipHeader, captureName?: string): string {
  if (header.name) return header.name;
  if (captureName) {
    if (/\.tgz$/i.test(captureName)) return captureName.replace(/\.tgz$/i, '.tar');
    if (/\.gz$/i.test(captureName)) return captureName.replace(/\.gz$/i, '');
  }
  return 'data';
}
