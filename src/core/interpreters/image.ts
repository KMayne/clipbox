import { z } from 'zod';
import { formatBytes, plural } from '../format';
import { hasKind } from '../guards';
import { unsupportedSlice, type Interpreter } from '../interpreter';
import {
  imageDimensions,
  isImageMagic,
  MAGIC_MIME,
  type Dimensions,
  type MagicType,
} from '../magic';
import type { StatRow } from '../types';

export interface ImageValue {
  kind: 'image';
  /** Format of `bytes`: PNG when the image was decoded from a format the browser can't show. */
  format: MagicType;
  mime: string;
  dims: Dimensions | null;
  bytes: Uint8Array<ArrayBuffer>;
  /** Set by the `imageformats` module for TIFF, EMF, WMF and the like; `bytes` is page 1. */
  decoded?: DecodedImage;
}

/** A TIFF, EMF, WMF, PSD, TGA or PCX image, rendered to PNG by the `imageformats` module. */
export interface DecodedImage {
  /** Display name of the source format, e.g. "TIFF". */
  format: string;
  /** MIME type of the original file. */
  mime: string;
  /** Vector metafiles (EMF, WMF) are rendered at 96 dpi rather than decoded. */
  vector: boolean;
  /** Each page's size in the source; the PNGs may be scaled down to fit the pixel cap. */
  pages: Dimensions[];
  /** Format-specific stats: compression, DPI, colour space and so on. */
  stats: StatRow[];
  /** PNG of page `index` (0-based); page 0 is the value's `bytes`. */
  renderPage(index: number): Promise<Uint8Array<ArrayBuffer>>;
}

/** The `json` slice of an image: its page sizes, for the preview's page picker. */
export interface ImageLayout {
  pages: Dimensions[];
}

export const imageLayoutSchema: z.ZodType<ImageLayout> = z.object({
  pages: z.array(z.object({ width: z.number(), height: z.number() })),
});

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

function aspect({ width: w, height: h }: Dimensions): string {
  const g = gcd(w, h);
  const [rw, rh] = [w / g, h / g];
  return rw <= 50 && rh <= 50 ? `${rw}:${rh}` : `${(w / h).toFixed(2)}:1`;
}

const size = (d: Dimensions) => `${d.width}×${d.height}`;

/** "TIFF 2480×3508 · 3 pages", "EMF 800×600 (vector)" or "PNG 64×64". */
export function imageLabel(v: ImageValue): string {
  const { decoded } = v;
  if (decoded) {
    const first = decoded.pages[0];
    const vector = decoded.vector ? ' (vector)' : '';
    const pages = decoded.pages.length > 1 ? ` · ${plural(decoded.pages.length, 'page')}` : '';
    return `${decoded.format}${first ? ` ${size(first)}` : ''}${vector}${pages}`;
  }
  return `${v.format.toUpperCase()}${v.dims ? ` ${size(v.dims)}` : ''}`;
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
  label: imageLabel,
  summarise({ format, mime, dims: own, bytes, decoded }) {
    const dims = decoded?.pages[0] ?? own;
    return {
      stats: [
        { label: 'Format', value: decoded?.format ?? format.toUpperCase() },
        { label: 'MIME', value: decoded?.mime ?? mime },
        {
          label: decoded?.vector ? 'Rendered size' : 'Dimensions',
          value: dims ? `${dims.width} × ${dims.height}` : 'unknown',
        },
        ...(dims && dims.height > 0
          ? [
              { label: 'Aspect ratio', value: aspect(dims) },
              ...(decoded?.vector
                ? []
                : [{ label: 'Megapixels', value: ((dims.width * dims.height) / 1e6).toFixed(2) }]),
            ]
          : []),
        // A decoded image's `bytes` are the PNG render; the entry's own size is shown elsewhere
        ...(decoded ? decoded.stats : [{ label: 'Bytes', value: formatBytes(bytes.byteLength) }]),
      ],
      extent: bytes.byteLength,
    };
  },
  async slice(v, req) {
    if (req.type === 'image') return { bytes: v.bytes, mime: v.mime };
    if (req.type === 'bytes') return v.bytes.slice(req.from, req.to);
    if (req.type === 'json') {
      const pages = v.decoded?.pages ?? (v.dims ? [v.dims] : []);
      return { pages: pages.map(({ width, height }) => ({ width, height })) } satisfies ImageLayout;
    }
    if (req.type === 'page') {
      const count = v.decoded?.pages.length ?? 1;
      if (req.index < 0 || req.index >= count) throw new Error(`No page ${req.index + 1}`);
      if (!v.decoded || req.index === 0) return { bytes: v.bytes, mime: v.mime };
      return { bytes: await v.decoded.renderPage(req.index), mime: 'image/png' };
    }
    return unsupportedSlice('image', req);
  },
  export: v => ({ image: { bytes: v.bytes, mime: v.mime } }),
};
