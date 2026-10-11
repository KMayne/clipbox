import { makeContent } from '../../src/core/content';

export const textContent = (text: string, mime = 'text/plain') =>
  makeContent(mime, new TextEncoder().encode(text));

export const bytesContent = (
  bytes: number[] | Uint8Array<ArrayBuffer>,
  mime = 'application/octet-stream',
) => makeContent(mime, bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));

export function pngHeader(width: number, height: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const dv = new DataView(b.buffer);
  dv.setUint32(16, width);
  dv.setUint32(20, height);
  return b;
}

export function gifHeader(width: number, height: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(13);
  b.set([...'GIF89a'].map(c => c.charCodeAt(0)));
  const dv = new DataView(b.buffer);
  dv.setUint16(6, width, true);
  dv.setUint16(8, height, true);
  return b;
}

export function jpegHeader(width: number, height: number): Uint8Array<ArrayBuffer> {
  // SOI, APP0 (len 16), SOF0 (len 17)
  const b = new Uint8Array(2 + 18 + 19);
  b.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const sof = 20;
  b.set([0xff, 0xc0, 0x00, 0x11, 0x08], sof);
  const dv = new DataView(b.buffer);
  dv.setUint16(sof + 5, height);
  dv.setUint16(sof + 7, width);
  return b;
}

export function webpLosslessHeader(width: number, height: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(30);
  b.set([...'RIFF'].map(c => c.charCodeAt(0)));
  b.set(
    [...'WEBPVP8L'].map(c => c.charCodeAt(0)),
    8,
  );
  const bits = (width - 1) | ((height - 1) << 14);
  new DataView(b.buffer).setUint32(21, bits, true);
  return b;
}
