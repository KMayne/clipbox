export type MagicType =
  'png' | 'jpeg' | 'gif' | 'webp' | 'bmp' | 'ico' | 'svg' | 'pdf' | 'zip' | 'gzip' | 'wasm' | 'elf';

const IMAGE_TYPES = new Set<MagicType>(['png', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg']);

const startsWith = (b: Uint8Array, sig: number[], offset = 0) =>
  b.length >= offset + sig.length && sig.every((v, i) => b[offset + i] === v);

const ascii = (b: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...b.subarray(from, to));

export function detectMagic(b: Uint8Array): MagicType | null {
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(b, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (ascii(b, 0, 4) === 'GIF8') return 'gif';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'webp';
  if (ascii(b, 0, 2) === 'BM' && b.length > 26) return 'bmp';
  if (startsWith(b, [0, 0, 1, 0])) return 'ico';
  if (ascii(b, 0, 5) === '%PDF-') return 'pdf';
  if (startsWith(b, [0x50, 0x4b, 0x03, 0x04])) return 'zip';
  if (startsWith(b, [0x1f, 0x8b])) return 'gzip';
  if (startsWith(b, [0x00, 0x61, 0x73, 0x6d])) return 'wasm';
  if (startsWith(b, [0x7f, 0x45, 0x4c, 0x46])) return 'elf';
  const head = new TextDecoder().decode(b.subarray(0, 512)).trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(head)) return 'svg';
  return null;
}

export const isImageMagic = (t: MagicType | null) => t !== null && IMAGE_TYPES.has(t);

export interface Dimensions {
  width: number;
  height: number;
}

/** Reads image dimensions from headers only; no decoding, so it also runs in Node. */
export function imageDimensions(type: MagicType, b: Uint8Array): Dimensions | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  try {
    switch (type) {
      case 'png':
        return { width: dv.getUint32(16), height: dv.getUint32(20) };
      case 'gif':
        return { width: dv.getUint16(6, true), height: dv.getUint16(8, true) };
      case 'bmp':
        return { width: dv.getInt32(18, true), height: Math.abs(dv.getInt32(22, true)) };
      case 'ico':
        return { width: b[6] || 256, height: b[7] || 256 };
      case 'webp':
        return webpDimensions(b, dv);
      case 'jpeg':
        return jpegDimensions(b, dv);
      case 'svg':
        return svgDimensions(new TextDecoder().decode(b.subarray(0, 4096)));
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function webpDimensions(b: Uint8Array, dv: DataView): Dimensions | null {
  const chunk = ascii(b, 12, 16);
  if (chunk === 'VP8 ') {
    return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    const bits = dv.getUint32(21, true);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') {
    const u24 = (o: number) =>
      dv.getUint8(o) | (dv.getUint8(o + 1) << 8) | (dv.getUint8(o + 2) << 16);
    return { width: u24(24) + 1, height: u24(27) + 1 };
  }
  return null;
}

function jpegDimensions(b: Uint8Array, dv: DataView): Dimensions | null {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = dv.getUint8(i + 1);
    // SOF0..SOF15, excluding DHT (C4), JPG (C8) and DAC (CC)
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: dv.getUint16(i + 5), width: dv.getUint16(i + 7) };
    }
    i += 2 + dv.getUint16(i + 2);
  }
  return null;
}

function svgDimensions(head: string): Dimensions | null {
  const tag = /<svg[^>]*>/i.exec(head)?.[0];
  if (!tag) return null;
  const attr = (name: string) => new RegExp(`\\s${name}=["']([\\d.]+)(px)?["']`).exec(tag)?.[1];
  const w = attr('width');
  const h = attr('height');
  if (w && h) return { width: Number(w), height: Number(h) };
  const vb = /viewBox=["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(tag);
  return vb ? { width: Number(vb[1]), height: Number(vb[2]) } : null;
}
