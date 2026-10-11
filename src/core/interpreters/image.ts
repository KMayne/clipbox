import { formatBytes } from '../format';
import { unsupportedSlice, type Interpreter } from '../interpreter';
import { imageDimensions, isImageMagic, type MagicType } from '../magic';

export interface ImageValue {
  format: MagicType;
  mime: string;
  width: number | null;
  height: number | null;
  bytes: Uint8Array;
}

const FORMAT_MIME: Partial<Record<MagicType, string>> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
};

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

function aspect(w: number, h: number): string {
  const g = gcd(w, h);
  const [rw, rh] = [w / g, h / g];
  return rw <= 50 && rh <= 50 ? `${rw}:${rh}` : `${(w / h).toFixed(2)}:1`;
}

export const imageInterpreter: Interpreter<ImageValue> = {
  kind: 'image',
  detect: c => (!isImageMagic(c.magic) ? 0 : c.magic === 'svg' ? 0.8 : 1),
  parse(c) {
    const format = c.magic!;
    const dims = imageDimensions(format, c.bytes);
    return {
      format,
      mime: FORMAT_MIME[format] ?? c.mime,
      width: dims?.width ?? null,
      height: dims?.height ?? null,
      bytes: c.bytes,
    };
  },
  label: v => `${v.format.toUpperCase()}${v.width !== null ? ` ${v.width}×${v.height}` : ''}`,
  summarise(v) {
    const dims = v.width !== null && v.height !== null;
    return {
      stats: [
        { label: 'Format', value: v.format.toUpperCase() },
        { label: 'MIME', value: v.mime },
        { label: 'Dimensions', value: dims ? `${v.width} × ${v.height}` : 'unknown' },
        ...(dims && v.height! > 0
          ? [
              { label: 'Aspect ratio', value: aspect(v.width!, v.height!) },
              { label: 'Megapixels', value: ((v.width! * v.height!) / 1e6).toFixed(2) },
            ]
          : []),
        { label: 'Bytes', value: formatBytes(v.bytes.byteLength) },
      ],
      extent: v.bytes.byteLength,
    };
  },
  slice(v, req) {
    if (req.type === 'full') return { bytes: v.bytes, mime: v.mime };
    if (req.type === 'bytes') return v.bytes.slice(req.from, req.to);
    return unsupportedSlice('image', req);
  },
  export: v => ({ image: { bytes: v.bytes, mime: v.mime } }),
};
