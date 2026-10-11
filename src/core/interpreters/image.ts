import { formatBytes } from '../format';
import { hasKind } from '../guards';
import { unsupportedSlice, type Interpreter } from '../interpreter';
import {
  imageDimensions,
  isImageMagic,
  MAGIC_MIME,
  type Dimensions,
  type MagicType,
} from '../magic';

export interface ImageValue {
  kind: 'image';
  format: MagicType;
  mime: string;
  dims: Dimensions | null;
  bytes: Uint8Array<ArrayBuffer>;
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

function aspect({ width: w, height: h }: Dimensions): string {
  const g = gcd(w, h);
  const [rw, rh] = [w / g, h / g];
  return rw <= 50 && rh <= 50 ? `${rw}:${rh}` : `${(w / h).toFixed(2)}:1`;
}

export const imageInterpreter: Interpreter<ImageValue> = {
  kind: 'image',
  isValue: (v): v is ImageValue => hasKind(v, 'image'),
  detect: c => (!isImageMagic(c.magic) ? 0 : c.magic === 'svg' ? 0.8 : 1),
  parse(c) {
    const format = c.magic;
    if (!format) throw new Error('Not an image');
    return {
      kind: 'image',
      format,
      mime: MAGIC_MIME[format],
      dims: imageDimensions(format, c.bytes),
      bytes: c.bytes,
    };
  },
  label: v => `${v.format.toUpperCase()}${v.dims ? ` ${v.dims.width}×${v.dims.height}` : ''}`,
  summarise({ format, mime, dims, bytes }) {
    return {
      stats: [
        { label: 'Format', value: format.toUpperCase() },
        { label: 'MIME', value: mime },
        { label: 'Dimensions', value: dims ? `${dims.width} × ${dims.height}` : 'unknown' },
        ...(dims && dims.height > 0
          ? [
              { label: 'Aspect ratio', value: aspect(dims) },
              { label: 'Megapixels', value: ((dims.width * dims.height) / 1e6).toFixed(2) },
            ]
          : []),
        { label: 'Bytes', value: formatBytes(bytes.byteLength) },
      ],
      extent: bytes.byteLength,
    };
  },
  slice(v, req) {
    if (req.type === 'image') return { bytes: v.bytes, mime: v.mime };
    if (req.type === 'bytes') return v.bytes.slice(req.from, req.to);
    return unsupportedSlice('image', req);
  },
  export: v => ({ image: { bytes: v.bytes, mime: v.mime } }),
};
