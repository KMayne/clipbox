/**
 * Pulls the images out of a PDF: walks each page's operator list for image paints, takes the
 * decoded image from pdf.js's object stores and encodes it as PNG.
 */

import { throwIfAborted } from '../../core/progress';
import { ImageKind, OPS } from 'pdfjs-dist';
import { sha256 } from '../../core/hash';
import { isRecord } from '../../core/guards';
import type { DerivedContent } from '../../core/types';
import type { PdfImageOptions, PdfImageResult } from './types';

/** A decoded image as pdf.js hands it over: raw pixels (`data` + `kind`) or an ImageBitmap. */
export interface RawImage {
  width: number;
  height: number;
  /** ImageKind: 1-bit grayscale, RGB or RGBA; absent for masks. */
  kind?: number;
  data?: Uint8Array | Uint8ClampedArray;
  bitmap?: ImageBitmap;
  /** A stencil mask: 1 bit per pixel, painted where the bit is 0. */
  mask: boolean;
}

/** Turns a decoded image into PNG bytes. */
export type ImageEncoder = (img: RawImage) => Promise<Uint8Array<ArrayBuffer>>;

/** The parts of pdf.js's PDFPageProxy that extraction uses. */
export interface ImagePage {
  pageNumber: number;
  objs: ObjectStore;
  commonObjs: ObjectStore;
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[] }>;
}

interface ObjectStore {
  /** Calls back once the object is resolved (pdf.js's PDFObjects). */
  get(id: string, callback: (data: unknown) => void): unknown;
}

/** The parts of pdf.js's PDFDocumentProxy that extraction uses. */
export interface ImageDocument {
  numPages: number;
  getPage(number: number): Promise<ImagePage>;
}

/** Gives up on an image object pdf.js never resolves (e.g. it failed to decode). */
const OBJECT_TIMEOUT_MS = 10_000;

/** RGBA pixels for a `data` image, following pdf.js's own canvas code for each kind. */
export function toRgba(img: RawImage): Uint8ClampedArray<ArrayBuffer> {
  const { width, height, data } = img;
  if (!data) throw new Error('Image has no pixel data');
  const out = new Uint8ClampedArray(width * height * 4);
  const pixels = width * height;
  if (img.mask || img.kind === ImageKind.GRAYSCALE_1BPP) {
    const rowBytes = (width + 7) >> 3;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const set = ((data[y * rowBytes + (x >> 3)] ?? 0) & (0x80 >> (x & 7))) !== 0;
        const o = (y * width + x) * 4;
        if (img.mask) {
          // Black where painted, transparent elsewhere
          out[o + 3] = set ? 0 : 255;
        } else {
          const v = set ? 255 : 0;
          out[o] = out[o + 1] = out[o + 2] = v;
          out[o + 3] = 255;
        }
      }
    }
  } else if (img.kind === ImageKind.RGB_24BPP || data.length === pixels * 3) {
    for (let i = 0; i < pixels; i++) {
      out[i * 4] = data[i * 3] ?? 0;
      out[i * 4 + 1] = data[i * 3 + 1] ?? 0;
      out[i * 4 + 2] = data[i * 3 + 2] ?? 0;
      out[i * 4 + 3] = 255;
    }
  } else if (img.kind === ImageKind.RGBA_32BPP || data.length === pixels * 4) {
    out.set(data.subarray(0, pixels * 4));
  } else {
    throw new Error(`Unknown image kind ${String(img.kind)}`);
  }
  return out;
}

/** PNG via OffscreenCanvas (worker or page). */
export const canvasEncoder: ImageEncoder = async img => {
  const canvas = new OffscreenCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas in this browser');
  if (img.bitmap) ctx.drawImage(img.bitmap, 0, 0);
  else ctx.putImageData(new ImageData(toRgba(img), img.width, img.height), 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return new Uint8Array(await blob.arrayBuffer());
};

const isBitmap = (v: unknown): v is ImageBitmap =>
  typeof ImageBitmap !== 'undefined' && v instanceof ImageBitmap;

/** Checks an object from pdf.js (untyped) and normalises it; null if it isn't an image. */
export function rawImage(v: unknown, mask: boolean): RawImage | null {
  if (!isRecord(v)) return null;
  const { width, height, kind, data, bitmap } = v;
  if (typeof width !== 'number' || typeof height !== 'number' || width < 1 || height < 1) {
    return null;
  }
  const pixels = data instanceof Uint8Array || data instanceof Uint8ClampedArray ? data : undefined;
  const bmp = isBitmap(bitmap) ? bitmap : undefined;
  if (!pixels && !bmp) return null;
  return {
    width,
    height,
    mask,
    ...(typeof kind === 'number' && { kind }),
    ...(pixels && { data: pixels }),
    ...(bmp && { bitmap: bmp }),
  };
}

/** An image object by id, once pdf.js has resolved it ('g_' ids live in the document's store). */
function pageObject(page: ImagePage, id: string): Promise<unknown> {
  const store = id.startsWith('g_') ? page.commonObjs : page.objs;
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), OBJECT_TIMEOUT_MS);
    store.get(id, (data: unknown) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

interface Candidate {
  /** Object id (page-scoped unless shared), to skip repeats without decoding; null if inline. */
  key: string | null;
  load(): Promise<RawImage | null>;
}

/** The images one paint operation draws. */
function candidates(page: ImagePage, fn: number, args: unknown): Candidate[] {
  const list: unknown[] = Array.isArray(args) ? args : [];
  const [first] = list;
  const scoped = (id: string) => (id.startsWith('g_') ? id : `${page.pageNumber}:${id}`);
  const byId = (id: string, mask: boolean): Candidate => ({
    key: scoped(id),
    load: async () => rawImage(await pageObject(page, id), mask),
  });
  const maskOf = (m: unknown): Candidate | null => {
    if (!isRecord(m)) return null;
    // Mask data is either an object id or the bits themselves
    if (typeof m.data === 'string') return byId(m.data, true);
    return { key: null, load: async () => rawImage(m, true) };
  };
  switch (fn) {
    case OPS.paintImageXObject:
    case OPS.paintImageXObjectRepeat:
      return typeof first === 'string' ? [byId(first, false)] : [];
    case OPS.paintInlineImageXObject:
    case OPS.paintInlineImageXObjectGroup:
      return [{ key: null, load: async () => rawImage(first, false) }];
    case OPS.paintImageMaskXObject:
    case OPS.paintImageMaskXObjectRepeat:
      return [maskOf(first)].filter(c => c !== null);
    case OPS.paintImageMaskXObjectGroup:
      return (Array.isArray(first) ? first : []).map(maskOf).filter(c => c !== null);
    default:
      return [];
  }
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Every distinct image on the chosen pages, in page order, as PNG. Repeats (a logo on every
 * page) are dropped by object id and then by content; images below `minSize` are skipped.
 */
export async function extractPdfImages(
  doc: ImageDocument,
  { pages, minSize, max, task }: PdfImageOptions,
  encode: ImageEncoder = canvasEncoder,
): Promise<PdfImageResult> {
  const numbers = (pages ?? Array.from({ length: doc.numPages }, (_, i) => i + 1)).filter(
    n => n >= 1 && n <= doc.numPages,
  );
  const seenKeys = new Set<string>();
  const seenHashes = new Set<string>();
  const images: DerivedContent[] = [];
  for (const [n, number] of numbers.entries()) {
    throwIfAborted(task?.signal);
    task?.progress(n / numbers.length, `Page ${n + 1} of ${numbers.length}`);
    const page = await doc.getPage(number);
    const ops = await page.getOperatorList();
    let onPage = 0;
    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i];
      if (fn === undefined) continue;
      for (const c of candidates(page, fn, ops.argsArray[i])) {
        if (c.key !== null) {
          if (seenKeys.has(c.key)) continue;
          seenKeys.add(c.key);
        }
        throwIfAborted(task?.signal);
        const raw = await c.load();
        if (!raw || Math.min(raw.width, raw.height) < minSize) continue;
        const bytes = await encode(raw);
        const hash = await sha256(bytes);
        if (seenHashes.has(hash)) continue;
        if (images.length >= max) return { images, truncated: true };
        seenHashes.add(hash);
        onPage++;
        images.push({
          mime: 'image/png',
          name: `page-${pad(number)}-image${onPage}.png`,
          bytes,
        });
      }
    }
  }
  return { images, truncated: false };
}
