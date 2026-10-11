import { describe, expect, it } from 'vitest';
import { ImageKind, OPS } from 'pdfjs-dist';
import type { EntryId } from '../../src/core/types';
import { Engine } from '../../src/engine/engine';
import {
  extractPdfImages,
  rawImage,
  toRgba,
  type ImageEncoder,
  type ImagePage,
} from '../../src/modules/pdf/images';
import { parsePdf, pdfInterpreter } from '../../src/modules/pdf/pdf';
import type { PdfImageService } from '../../src/modules/pdf/types';
import { makePdf, pdfBytes, type PdfImage } from '../fixtures/pdf';

/**
 * Node has no OffscreenCanvas, so this encoder stands in for PNG: it writes the size and the
 * first pixel, which is enough to tell the images apart (and identical ones collide).
 */
const fakeEncoder: ImageEncoder = async img => {
  const px = toRgba(img).subarray(0, 4);
  return new TextEncoder().encode(`${img.width}x${img.height} ${[...px].join(',')}`);
};
const td = new TextDecoder();

const RED: PdfImage = { width: 50, height: 40, color: [220, 30, 30] };
const images: PdfImage[] = [
  RED,
  { width: 8, height: 8, color: [0, 0, 255] }, // below the default minimum size
  { ...RED }, // another object with the same pixels
  { width: 40, height: 40, color: [128] }, // DeviceGray
  { width: 48, height: 48, color: [], mask: true },
];
// p1: red + tiny · p2: red again + gray · p3: red copy + mask
const deck = () =>
  pdfBytes(
    makePdf({
      pages: [['one'], ['two'], ['three']],
      images,
      pageImages: [
        [0, 1],
        [0, 3],
        [2, 4],
      ],
    }),
  );

async function openDeck() {
  const v = await parsePdf(deck(), 'deck.pdf');
  if (!v.doc) throw new Error(v.info.error ?? 'not open');
  return v.doc;
}

const describeOut = (out: { name?: string; mime: string; bytes: Uint8Array }[]) =>
  out.map(o => [o.name, o.mime, td.decode(o.bytes)]);

describe('pdf image extraction', () => {
  it('finds each distinct image once, skipping tiny ones', async () => {
    const doc = await openDeck();
    const { images: out, truncated } = await extractPdfImages(
      doc,
      { pages: null, minSize: 32, max: 500 },
      fakeEncoder,
    );
    expect(truncated).toBe(false);
    expect(describeOut(out)).toEqual([
      ['page-01-image1.png', 'image/png', '50x40 220,30,30,255'],
      ['page-02-image1.png', 'image/png', '40x40 128,128,128,255'],
      ['page-03-image1.png', 'image/png', '48x48 0,0,0,255'],
    ]);
  });

  it('honours the page list, minimum size and cap', async () => {
    const doc = await openDeck();
    const run = (pages: number[] | null, minSize: number, max = 500) =>
      extractPdfImages(doc, { pages, minSize, max }, fakeEncoder);

    const small = await run([1], 1);
    expect(small.images.map(i => i.name)).toEqual(['page-01-image1.png', 'page-01-image2.png']);
    expect(td.decode(small.images[1]?.bytes)).toBe('8x8 0,0,255,255');

    expect((await run([2], 32)).images.map(i => i.name)).toEqual([
      'page-02-image1.png',
      'page-02-image2.png',
    ]);

    const capped = await run(null, 32, 2);
    expect(capped.truncated).toBe(true);
    expect(capped.images).toHaveLength(2);
  });

  it('converts each pdf.js pixel kind to RGBA', () => {
    const rgba = (data: number[], kind: number | undefined, width: number, mask = false) => [
      ...toRgba({ width, height: 1, data: new Uint8Array(data), mask, ...(kind && { kind }) }),
    ];
    expect(rgba([1, 2, 3, 4, 5, 6], ImageKind.RGB_24BPP, 2)).toEqual([1, 2, 3, 255, 4, 5, 6, 255]);
    expect(rgba([1, 2, 3, 4], ImageKind.RGBA_32BPP, 1)).toEqual([1, 2, 3, 4]);
    // 1 bit per pixel, most significant first: 0b10 → white, black
    expect(rgba([0b1000_0000], ImageKind.GRAYSCALE_1BPP, 2)).toEqual([
      255, 255, 255, 255, 0, 0, 0, 255,
    ]);
    // Masks paint where the bit is 0
    expect(rgba([0b1000_0000], undefined, 2, true)).toEqual([0, 0, 0, 0, 0, 0, 0, 255]);
  });

  it('accepts only image-shaped objects from pdf.js', () => {
    expect(
      rawImage({ width: 2, height: 1, kind: 2, data: new Uint8Array(6) }, false),
    ).toMatchObject({ width: 2, height: 1, kind: 2, mask: false });
    expect(rawImage({ width: 2, height: 1 }, false)).toBeNull();
    expect(rawImage({ width: 0, height: 1, data: new Uint8Array(0) }, false)).toBeNull();
    expect(rawImage(null, true)).toBeNull();
  });

  it('reads inline images and mask groups straight from the operator list', async () => {
    const inline = {
      width: 40,
      height: 40,
      kind: ImageKind.RGB_24BPP,
      data: new Uint8Array(4800).fill(200),
    };
    const mask = { width: 40, height: 40, data: new Uint8Array(200) };
    const page: ImagePage = {
      pageNumber: 1,
      objs: { get: () => undefined },
      commonObjs: { get: () => undefined },
      getOperatorList: async () => ({
        fnArray: [OPS.paintInlineImageXObject, OPS.paintImageMaskXObjectGroup, OPS.save],
        argsArray: [[inline], [[mask]], null],
      }),
    };
    const { images: out } = await extractPdfImages(
      { numPages: 1, getPage: async () => page },
      { pages: null, minSize: 1, max: 10 },
      fakeEncoder,
    );
    expect(describeOut(out)).toEqual([
      ['page-01-image1.png', 'image/png', '40x40 200,200,200,255'],
      ['page-01-image2.png', 'image/png', '40x40 0,0,0,255'],
    ]);
  });
});

describe('pdf Extract images action', () => {
  const entry = (id: EntryId = 'en-1') => {
    const blob = new Blob([deck()], { type: 'application/pdf' });
    return { id, mime: 'application/pdf', name: 'deck.pdf', size: blob.size, blob };
  };
  // The real service, with the test encoder in place of OffscreenCanvas
  const service: PdfImageService = {
    async extractImages(value, options) {
      if (!pdfInterpreter.isValue(value) || !value.doc) throw new Error('no doc');
      return extractPdfImages(value.doc, options, fakeEncoder);
    },
  };
  const engine = () =>
    new Engine({
      loaders: {
        pdf: async () => ({ ...(await import('../../src/modules/pdf/worker')), service }),
      },
    });

  it('runs through the pdf module service and parses the page range', async () => {
    const e = engine();
    await e.ingest(entry());
    await e.resolve('en-1', 'pdf');
    expect(await e.actions('en-1', 'pdf')).toContain('pdf.extractImages');
    const out = await e.runAction('en-1', 'pdf', 'pdf.extractImages', { pages: '2-3' });
    expect(out.map(o => o.name)).toEqual([
      'page-02-image1.png',
      'page-02-image2.png',
      'page-03-image1.png',
    ]);
    await expect(
      e.runAction('en-1', 'pdf', 'pdf.extractImages', { pages: '1', minSize: 1000 }),
    ).rejects.toThrow('Extract images found nothing');
    await expect(e.runAction('en-1', 'pdf', 'pdf.extractImages', { pages: '7' })).rejects.toThrow(
      "No pages in '7' (there are 3)",
    );
  });
});
