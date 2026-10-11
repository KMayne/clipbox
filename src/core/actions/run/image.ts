import { z } from 'zod';
import { toBase64 } from '../../format';
import { palette, resizeTarget, transformTarget } from '../../image/ops';
import { imageInterpreter, type ImageValue } from '../../interpreters/image';
// Only the module's light types: jsQR stays in the module's chunk
import { isQrService } from '../../../modules/qr/service';
import {
  imageConvert,
  imageDataUrl,
  imagePagesAsPng,
  imagePalette,
  imageReadCodes,
  imageResize,
  imageRotate,
} from '../catalog/image';
import { implement } from '../types';
import { textResult, withExtension } from './util';

// Workers can't decode SVG (it needs a DOM)
const decodable = ({ value }: { value: ImageValue }) => value.format !== 'svg';

const decode = (value: ImageValue, options?: ImageBitmapOptions) =>
  createImageBitmap(new Blob([value.bytes], { type: value.mime }), options);

function context(canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas in this browser');
  return ctx;
}

/** Formats kept when re-encoding a resized or rotated image; anything else becomes PNG. */
const KEEP = new Set(['image/png', 'image/jpeg', 'image/webp']);
const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/** Encodes in the source's format where possible (JPEG/WebP at 92%), else PNG. */
async function encode(
  canvas: OffscreenCanvas,
  value: ImageValue,
  name: string | undefined,
  suffix: string,
) {
  const wanted = KEEP.has(value.mime) ? value.mime : 'image/png';
  let blob = await canvas.convertToBlob({ type: wanted, quality: 0.92 });
  // Chromium falls back to PNG for types it can't encode
  if (blob.type !== wanted) blob = await canvas.convertToBlob({ type: 'image/png' });
  const mime = blob.type;
  const stem = (name ?? '').replace(/\.[^./\\]*$/, '') || 'image';
  return {
    mime,
    name: `${stem} (${suffix}).${EXT[mime] ?? 'png'}`,
    bytes: new Uint8Array(await blob.arrayBuffer()),
  };
}

/** RGBA pixels of the image, scaled down so its longer side is at most `max`. */
async function pixels(value: ImageValue, max: number) {
  const probe = await decode(value);
  const { width, height } = probe;
  probe.close();
  const scale = Math.min(1, max / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const bitmap = await decode(value, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
  try {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = context(canvas);
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, w, h);
  } finally {
    bitmap.close();
  }
}

// --- Barcodes ---

interface BarcodeDetectorLike {
  detect(source: ImageBitmapSource): Promise<unknown>;
}
interface BarcodeDetectorClass {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats(): Promise<unknown>;
}

const isDetectorClass = (v: unknown): v is BarcodeDetectorClass =>
  typeof v === 'function' && 'getSupportedFormats' in v;

const detectedSchema = z.array(z.object({ rawValue: z.string(), format: z.string() }));

/** Chromium's BarcodeDetector, if this platform has one (macOS, ChromeOS, Android). */
async function barcodeDetector(): Promise<BarcodeDetectorLike | null> {
  const ctor: unknown = Reflect.get(globalThis, 'BarcodeDetector');
  if (!isDetectorClass(ctor)) return null;
  const formats = z.array(z.string()).safeParse(await ctor.getSupportedFormats());
  if (!formats.success || formats.data.length === 0) return null;
  return new ctor({ formats: formats.data });
}

const MAX_QR_SIDE = 2048;

/** Each code's text: BarcodeDetector (every format, every code) or jsQR (one QR code). */
async function readCodes(
  value: ImageValue,
  qr: () => Promise<((rgba: Uint8ClampedArray, w: number, h: number) => string | null) | null>,
): Promise<{ format: string; text: string }[]> {
  const detector = await barcodeDetector();
  if (detector) {
    const bitmap = await decode(value);
    try {
      const found = detectedSchema.parse(await detector.detect(bitmap));
      if (!found.length) throw new Error('No QR codes or barcodes found');
      return found.map(c => ({ format: c.format, text: c.rawValue }));
    } finally {
      bitmap.close();
    }
  }
  const decodeQr = await qr();
  if (!decodeQr) throw new Error("The QR codes module isn't available");
  const image = await pixels(value, MAX_QR_SIDE);
  const text = decodeQr(image.data, image.width, image.height);
  if (text === null) {
    throw new Error(
      "No QR code found. Other barcode types need the browser's BarcodeDetector, which isn't " +
        'available in this browser',
    );
  }
  return [{ format: 'qr_code', text }];
}

export const imageImpls = [
  /** Decodes and re-encodes in the worker; re-encoding also drops metadata (EXIF etc). */
  implement(imageConvert, {
    value: imageInterpreter.isValue,
    applies: decodable,
    async run({ value, content }, { format, quality }) {
      const bitmap = await decode(value);
      try {
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = context(canvas);
        if (format === 'jpeg') {
          // JPEG has no alpha: flatten onto white rather than black
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        ctx.drawImage(bitmap, 0, 0);
        const mime = `image/${format}`;
        const blob = await canvas.convertToBlob({ type: mime, quality: quality / 100 });
        // Chromium falls back to PNG for types it can't encode
        if (blob.type !== mime)
          throw new Error(`This browser can't encode ${format.toUpperCase()}`);
        return {
          mime,
          name: withExtension(content.name, format === 'jpeg' ? 'jpg' : format, 'image'),
          bytes: new Uint8Array(await blob.arrayBuffer()),
        };
      } finally {
        bitmap.close();
      }
    },
  }),
  implement(imageResize, {
    value: imageInterpreter.isValue,
    applies: decodable,
    async run({ value, content }, params) {
      const probe = await decode(value);
      const target = resizeTarget(probe, params);
      probe.close();
      // The browser's high-quality resampler, rather than a single bilinear draw
      const bitmap = await decode(value, {
        resizeWidth: target.width,
        resizeHeight: target.height,
        resizeQuality: 'high',
      });
      try {
        const canvas = new OffscreenCanvas(target.width, target.height);
        const ctx = context(canvas);
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bitmap, 0, 0, target.width, target.height);
        return encode(canvas, value, content.name, `${target.width}×${target.height}`);
      } finally {
        bitmap.close();
      }
    },
  }),
  implement(imageRotate, {
    value: imageInterpreter.isValue,
    applies: decodable,
    async run({ value, content }, { op }) {
      const bitmap = await decode(value);
      try {
        const t = transformTarget(bitmap, op);
        const canvas = new OffscreenCanvas(t.width, t.height);
        const ctx = context(canvas);
        ctx.setTransform(...t.matrix);
        ctx.drawImage(bitmap, 0, 0);
        const suffix = { cw: 'rotated 90°', '180': 'rotated 180°', ccw: 'rotated 270°' };
        return encode(
          canvas,
          value,
          content.name,
          op === 'flipH' || op === 'flipV' ? 'flipped' : suffix[op],
        );
      } finally {
        bitmap.close();
      }
    },
  }),
  implement(imageDataUrl, {
    value: imageInterpreter.isValue,
    run: ({ value, content }) =>
      textResult(
        `data:${value.mime};base64,${toBase64(value.bytes)}`,
        'text/plain',
        withExtension(content.name, 'txt', 'image'),
      ),
  }),
  implement(imageReadCodes, {
    value: imageInterpreter.isValue,
    applies: decodable,
    async run({ value }, _params, ctx) {
      const codes = await readCodes(value, async () => {
        const service = await ctx.service('qr', isQrService);
        return service && ((rgba, w, h) => service.decode(rgba, w, h));
      });
      return codes.map((c, i) =>
        textResult(
          c.text,
          'text/plain',
          codes.length === 1 ? `${c.format}.txt` : `${c.format}-${i + 1}.txt`,
        ),
      );
    },
  }),
  implement(imagePalette, {
    value: imageInterpreter.isValue,
    applies: decodable,
    async run({ value }, { count }) {
      // A downsample is plenty for dominant colours
      const image = await pixels(value, 96);
      const colours = palette(image.data, count);
      if (!colours.length) throw new Error('The image is fully transparent');
      return colours.map((hex, i) => textResult(hex, 'text/plain', `colour-${i + 1}.txt`));
    },
  }),
  // Multi-page images (TIFF): every page, rendered by the imageformats module that decoded it
  implement(imagePagesAsPng, {
    value: imageInterpreter.isValue,
    applies: ({ value }) => (value.decoded?.pages.length ?? 1) > 1,
    async run({ value, content }) {
      const { decoded } = value;
      if (!decoded) throw new Error('This image has one page');
      const stem = withExtension(content.name, '', 'page').slice(0, -1);
      const pad = String(decoded.pages.length).length;
      const pages = [];
      for (let i = 0; i < decoded.pages.length; i++) {
        pages.push({
          mime: 'image/png',
          name: `${stem}-page${String(i + 1).padStart(Math.max(2, pad), '0')}.png`,
          bytes: i === 0 ? value.bytes : await decoded.renderPage(i),
        });
      }
      return pages;
    },
  }),
];
