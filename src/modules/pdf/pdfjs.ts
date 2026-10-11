/**
 * pdf.js set up to run inside our engine worker.
 *
 * - Its "worker" half runs in this thread (pdf.js's fake-worker mode, picked up from
 *   `globalThis.pdfjsWorker`). We're already off the main thread, and a statically imported
 *   worker module needs no extra URL plumbing, so it bundles into this module's chunks.
 * - There is no `document` here, so canvases come from OffscreenCanvas, SVG filters are skipped,
 *   and fonts are drawn as paths (`disableFontFace`) instead of being registered as FontFaces.
 * - CMaps, standard fonts and the JPX/JBIG2 decoder wasm are bundled with `?url` (so the module manifest
 *   lists them under `pdf`) and served through our own BinaryDataFactory.
 */
import { getDocument, VerbosityLevel, type PDFDocumentProxy } from 'pdfjs-dist';
import * as pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs';

Object.assign(globalThis, { pdfjsWorker: pdfWorker });

type UrlMap = Record<string, string>;

const byBasename = (files: UrlMap): Map<string, string> =>
  new Map(Object.entries(files).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1), url]));

const bundled: Record<string, Map<string, string>> = {
  cMapUrl: byBasename(
    import.meta.glob<string>('/node_modules/pdfjs-dist/cmaps/*.bcmap', {
      query: '?url',
      import: 'default',
      eager: true,
    }),
  ),
  standardFontDataUrl: byBasename(
    import.meta.glob<string>('/node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}', {
      query: '?url',
      import: 'default',
      eager: true,
    }),
  ),
  wasmUrl: byBasename(
    import.meta.glob<string>('/node_modules/pdfjs-dist/wasm/{openjpeg,jbig2}.wasm', {
      query: '?url',
      import: 'default',
      eager: true,
    }),
  ),
};

/** Serves CMaps, fonts and wasm from the bundled files; pdf.js calls `fetch({ kind, filename })`. */
class BundledDataFactory {
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const url = bundled[kind]?.get(filename);
    if (!url) throw new Error(`No bundled ${kind} file '${filename}'`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Fetching ${filename} failed: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
}

interface CanvasEntry {
  canvas: OffscreenCanvas | null;
  context: OffscreenCanvasRenderingContext2D | null;
}

/** pdf.js's scratch canvases (patterns, masks, groups), without a document. */
class OffscreenCanvasFactory {
  create(width: number, height: number): CanvasEntry {
    if (width <= 0 || height <= 0) throw new Error('Invalid canvas size');
    const canvas = new OffscreenCanvas(width, height);
    return { canvas, context: canvas.getContext('2d', { willReadFrequently: true }) };
  }
  reset(entry: CanvasEntry, width: number, height: number): void {
    if (!entry.canvas) throw new Error('Canvas is not specified');
    entry.canvas.width = width;
    entry.canvas.height = height;
  }
  destroy(entry: CanvasEntry): void {
    if (entry.canvas) entry.canvas.width = entry.canvas.height = 0;
    entry.canvas = null;
    entry.context = null;
  }
}

/** pdf.js's DOMFilterFactory builds SVG filters in the document; without one, filters are no-ops. */
class NoFilterFactory {
  addFilter() {
    return 'none';
  }
  addHCMFilter() {
    return 'none';
  }
  addAlphaFilter() {
    return 'none';
  }
  addLuminosityFilter() {
    return 'none';
  }
  addKnockoutFilter() {
    return 'none';
  }
  addHighlightHCMFilter() {
    return 'none';
  }
  addSelectionHCMFilter() {
    return 'none';
  }
  addSelectionFilter() {
    return 'none';
  }
  createSelectionStyle() {
    return null;
  }
  destroy() {}
}

/** Opens a document. Throws pdf.js's PasswordException / InvalidPDFException on failure. */
export function openDocument(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  return getDocument({
    // pdf.js transfers the buffer to its worker side; give it a copy so the entry keeps its bytes
    data: bytes.slice(),
    CanvasFactory: OffscreenCanvasFactory,
    FilterFactory: NoFilterFactory,
    BinaryDataFactory: BundledDataFactory,
    useWorkerFetch: false,
    disableFontFace: true,
    useSystemFonts: false,
    // Only checked for a trailing slash; BundledDataFactory resolves the files
    cMapUrl: 'bundled:/cmaps/',
    standardFontDataUrl: 'bundled:/standard_fonts/',
    wasmUrl: 'bundled:/wasm/',
    verbosity: VerbosityLevel.ERRORS,
  }).promise;
}

/** OffscreenCanvasRenderingContext2D has everything pdf.js draws with; its typings want the DOM one. */
function isRenderContext(c: unknown): c is CanvasRenderingContext2D {
  return typeof c === 'object' && c !== null && 'drawImage' in c && 'getTransform' in c;
}

/** Renders one page (0-based) to PNG at `scale` × 72 dpi. */
export async function renderPage(
  doc: PDFDocumentProxy,
  index: number,
  scale: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const page = await doc.getPage(index + 1);
  const viewport = page.getViewport({ scale });
  const canvas = new OffscreenCanvas(
    Math.max(1, Math.ceil(viewport.width)),
    Math.max(1, Math.ceil(viewport.height)),
  );
  const context: unknown = canvas.getContext('2d');
  if (!isRenderContext(context)) throw new Error('OffscreenCanvas 2D is not available');
  await page.render({ canvas: null, canvasContext: context, viewport, background: '#ffffff' })
    .promise;
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return new Uint8Array(await blob.arrayBuffer());
}
