import { describe, expect, it } from 'vitest';
import { register } from '../../src/core/interpreter';
import { imageInterpreter, type ImageValue } from '../../src/core/interpreters/image';
import { Engine } from '../../src/engine/engine';
import { pngHeader } from './helpers';
import { decodeDib } from '../../src/modules/imageformats/dib';
import { sniffLegacyImage } from '../../src/modules/imageformats/detect';
import { emfLayout, readEmfHeader, renderEmf } from '../../src/modules/imageformats/emf';
import type {
  Clip,
  Font,
  ImageDraw,
  Paint,
  Painter,
  Path,
  Stroke,
  TextRun,
} from '../../src/modules/imageformats/painter';
import { decodePcx, readPcx } from '../../src/modules/imageformats/pcx';
import { decodePsd, readPsd } from '../../src/modules/imageformats/psd';
import type { Raster } from '../../src/modules/imageformats/raster';
import { decodeTga, readTga } from '../../src/modules/imageformats/tga';
import { decodeTiffPage, readTiff, tiffStats } from '../../src/modules/imageformats/tiff';
import { playWmf, readWmfHeader, wmfLayout } from '../../src/modules/imageformats/wmf';
import {
  colorRef,
  deflate,
  emf,
  g3,
  g4,
  lzw,
  makeEmf,
  makePcx,
  makePsd,
  makeTga,
  makeTiff,
  makeWmf,
  packBits,
  packBits1,
  plus,
  plusRecord,
  samples,
  samples16,
  SAMPLE_EMF_RECORDS,
  wmf,
} from '../fixtures/images';

const px = (r: Raster, x: number, y: number) => [
  ...r.data.subarray((y * r.width + x) * 4, (y * r.width + x) * 4 + 4),
];

/** 16 × 12: red left half, blue right half, a green 4 × 4 square at (2, 2). */
const W = 16;
const H = 12;
const rgb = (x: number, y: number): [number, number, number] =>
  x >= 2 && x < 6 && y >= 2 && y < 6 ? [0, 200, 0] : x < 8 ? [220, 20, 30] : [10, 40, 230];

function checkRgb(r: Raster) {
  expect([r.width, r.height]).toEqual([W, H]);
  expect(px(r, 0, 0)).toEqual([220, 20, 30, 255]);
  expect(px(r, 3, 3)).toEqual([0, 200, 0, 255]);
  expect(px(r, 15, 11)).toEqual([10, 40, 230, 255]);
}

const rgbPage = (compression: number, encode: (d: Uint8Array) => Uint8Array) => ({
  width: W,
  height: H,
  data: encode(samples(W, H, 3, rgb)),
  compression,
  photometric: 2,
  bitsPerSample: [8, 8, 8],
});

/** A bilevel 'X'-ish pattern: black where x == y or x == 15 - y. */
const bilevel = (x: number, y: number) => (x === y || x === 15 - y ? 1 : 0);

function checkBilevel(r: Raster) {
  expect(px(r, 0, 0)).toEqual([0, 0, 0, 255]);
  expect(px(r, 1, 0)).toEqual([255, 255, 255, 255]);
  expect(px(r, 15, 0)).toEqual([0, 0, 0, 255]);
  expect(px(r, 5, 5)).toEqual([0, 0, 0, 255]);
  expect(px(r, 5, 6)).toEqual([255, 255, 255, 255]);
}

describe('legacy image detection', () => {
  it('sniffs each format', () => {
    const tiff = makeTiff([rgbPage(1, d => d)]);
    expect(sniffLegacyImage(tiff)).toBe('tiff');
    expect(sniffLegacyImage(makeTiff([rgbPage(1, d => d)], true))).toBe('tiff');
    expect(sniffLegacyImage(makeEmf(10, 10, []))).toBe('emf');
    expect(sniffLegacyImage(makeWmf(100, 100, 96, []))).toBe('wmf');
    expect(sniffLegacyImage(makePsd(4, 4, rgb))).toBe('psd');
    expect(sniffLegacyImage(makePcx(4, 4, () => 1, [[1, 2, 3]]))).toBe('pcx');
    // TGA has no magic: the footer (or a .tga name) identifies it
    expect(sniffLegacyImage(makeTga(4, 4, rgb))).toBe('tga');
    expect(sniffLegacyImage(makeTga(4, 4, rgb).slice(0, -26), 'x.tga')).toBe('tga');
    expect(sniffLegacyImage(makeTga(4, 4, rgb).slice(0, -26))).toBeNull();
    expect(sniffLegacyImage(new TextEncoder().encode('hello world, not an image'))).toBeNull();
  });
});

describe('TIFF', () => {
  it.each([
    ['none', 1, (d: Uint8Array) => d],
    ['LZW', 5, lzw],
    ['PackBits', 32773, packBits],
    ['Deflate', 8, deflate],
  ])('decodes %s RGB', (_, compression, encode) => {
    const file = readTiff(makeTiff([rgbPage(compression, encode)]));
    checkRgb(decodeTiffPage(file, 0));
  });

  it('decodes LZW data long enough to widen the codes', () => {
    const big = (x: number, y: number) => [(x * 7 + y * 13) & 255, (x ^ y) & 255, (x * y) & 255];
    const page = {
      width: 200,
      height: 50,
      data: lzw(samples(200, 50, 3, big)),
      compression: 5,
      photometric: 2,
      bitsPerSample: [8, 8, 8],
    };
    const r = decodeTiffPage(readTiff(makeTiff([page])), 0);
    for (const [x, y] of [
      [0, 0],
      [199, 49],
      [123, 31],
    ] as const) {
      expect(px(r, x, y)).toEqual([...big(x, y), 255]);
    }
  });

  it('reads big-endian 16-bit grayscale', () => {
    const values = Array.from({ length: W * H }, (_, i) => (i % W) * 4096);
    const page = {
      width: W,
      height: H,
      data: samples16(values, true),
      compression: 1,
      photometric: 1,
      bitsPerSample: [16],
    };
    const r = decodeTiffPage(readTiff(makeTiff([page], true)), 0);
    expect(px(r, 0, 0)).toEqual([0, 0, 0, 255]);
    expect(px(r, 8, 0)).toEqual([128, 128, 128, 255]);
    expect(px(r, 15, 3)).toEqual([239, 239, 239, 255]);
  });

  it('reads palette, CMYK and RGBA images', () => {
    const map = new Array(3 * 256).fill(0);
    map[1] = 0xffff; // index 1: red
    map[256 + 2] = 0xffff; // index 2: green
    const palette = makeTiff([
      {
        width: 4,
        height: 1,
        data: new Uint8Array([0, 1, 2, 1]),
        compression: 1,
        photometric: 3,
        bitsPerSample: [8],
        colorMap: map,
      },
    ]);
    const p = decodeTiffPage(readTiff(palette), 0);
    expect(px(p, 1, 0)).toEqual([255, 0, 0, 255]);
    expect(px(p, 2, 0)).toEqual([0, 255, 0, 255]);

    const cmyk = makeTiff([
      {
        width: 2,
        height: 1,
        data: new Uint8Array([0, 255, 255, 0, 0, 0, 0, 255]),
        compression: 1,
        photometric: 5,
        bitsPerSample: [8, 8, 8, 8],
      },
    ]);
    const c = decodeTiffPage(readTiff(cmyk), 0);
    expect(px(c, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(px(c, 1, 0)).toEqual([0, 0, 0, 255]);

    const rgba = makeTiff([
      {
        width: 1,
        height: 1,
        data: new Uint8Array([10, 20, 30, 128]),
        compression: 1,
        photometric: 2,
        bitsPerSample: [8, 8, 8, 8],
        extraSamples: [2],
      },
    ]);
    expect(px(decodeTiffPage(readTiff(rgba), 0), 0, 0)).toEqual([10, 20, 30, 128]);
  });

  it.each([
    ['uncompressed', 1, () => packBits1(16, 16, bilevel)],
    ['CCITT G3', 3, () => g3(16, 16, bilevel)],
    ['CCITT G4', 4, () => g4(16, 16, bilevel)],
  ])('decodes %s bilevel scans', (_, compression, data) => {
    const file = readTiff(
      makeTiff([
        {
          width: 16,
          height: 16,
          data: data(),
          compression,
          photometric: 0,
          bitsPerSample: [1],
          dpi: 200,
        },
      ]),
    );
    checkBilevel(decodeTiffPage(file, 0));
  });

  it('lists every page with its compression, DPI and colour space', () => {
    const file = readTiff(
      makeTiff([
        { ...rgbPage(5, lzw), dpi: 300 },
        {
          width: 16,
          height: 16,
          data: g4(16, 16, bilevel),
          compression: 4,
          photometric: 0,
          bitsPerSample: [1],
        },
        rgbPage(32773, packBits),
      ]),
    );
    expect(file.pages).toHaveLength(3);
    const stats = tiffStats(file);
    const row = (label: string) => stats.find(s => s.label === label);
    expect(row('Pages')?.value).toBe('3');
    expect(row('Pages')?.children?.[1]?.value).toBe(
      '16 × 16 · CCITT Group 4 · Bilevel (black and white)',
    );
    expect(row('Compression')?.value).toBe('LZW');
    expect(row('Colour space')?.value).toBe('RGB');
    expect(row('DPI')?.value).toBe('300');
    checkBilevel(decodeTiffPage(file, 1));
    checkRgb(decodeTiffPage(file, 2));
  });

  it('samples huge pages down to the pixel cap', () => {
    const file = readTiff(makeTiff([rgbPage(1, d => d)]));
    const r = decodeTiffPage(file, 0, 50);
    expect([r.width, r.height]).toEqual([8, 6]);
    expect(px(r, 0, 0)).toEqual([220, 20, 30, 255]);
    expect(px(r, 7, 5)).toEqual([10, 40, 230, 255]);
  });

  it('says which compressions it can’t decode', () => {
    const file = readTiff(makeTiff([rgbPage(34712, d => d)]));
    expect(() => decodeTiffPage(file, 0)).toThrow("JPEG 2000 compression isn't supported");
  });
});

describe('PSD, TGA and PCX', () => {
  it('decodes the PSD composite (RLE and raw)', () => {
    for (const rle of [true, false]) {
      const bytes = makePsd(W, H, rgb, rle);
      checkRgb(decodePsd(bytes, readPsd(bytes)));
    }
  });

  it('decodes raw and RLE TGA', () => {
    for (const rle of [false, true]) {
      const bytes = makeTga(W, H, rgb, rle);
      checkRgb(decodeTga(bytes, readTga(bytes)));
    }
  });

  it('decodes a 256-colour PCX', () => {
    const bytes = makePcx(5, 3, (x, y) => (x + y) % 3, [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
    ]);
    const info = readPcx(bytes);
    expect([info.width, info.height, info.dpi?.x]).toEqual([5, 3, 300]);
    const r = decodePcx(bytes, info);
    expect(px(r, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(px(r, 1, 0)).toEqual([0, 255, 0, 255]);
    expect(px(r, 4, 2)).toEqual([255, 0, 0, 255]);
    expect(px(r, 4, 1)).toEqual([0, 0, 255, 255]);
  });

  it('decodes bottom-up 24-bit DIBs', () => {
    const info = new Uint8Array(40);
    const dv = new DataView(info.buffer);
    dv.setUint32(0, 40, true);
    dv.setInt32(4, 2, true);
    dv.setInt32(8, 2, true);
    dv.setUint16(12, 1, true);
    dv.setUint16(14, 24, true);
    // Rows are bottom-up, BGR, padded to 4 bytes: bottom row red/green, top row blue/white
    const bits = new Uint8Array([0, 0, 255, 0, 255, 0, 0, 0, 255, 0, 0, 255, 255, 255, 0, 0]);
    const dib = decodeDib(info, bits);
    if (dib.type !== 'raster') throw new Error('expected pixels');
    expect(px(dib.raster, 0, 1)).toEqual([255, 0, 0, 255]);
    expect(px(dib.raster, 1, 1)).toEqual([0, 255, 0, 255]);
    expect(px(dib.raster, 0, 0)).toEqual([0, 0, 255, 255]);
  });
});

/** Records what a metafile draws. */
class Recorder implements Painter {
  fills: { path: Path; paint: Paint; clip: Clip[] }[] = [];
  strokes: { path: Path; stroke: Stroke }[] = [];
  texts: TextRun[] = [];
  images: ImageDraw[] = [];
  fill(path: Path, _rule: CanvasFillRule, paint: Paint, clip: Clip[]) {
    this.fills.push({ path, paint, clip });
  }
  stroke(path: Path, stroke: Stroke) {
    this.strokes.push({ path, stroke });
  }
  text(run: TextRun) {
    this.texts.push(run);
  }
  measure(text: string, font: Font) {
    return text.length * font.size * 0.5;
  }
  async image(d: ImageDraw) {
    this.images.push(d);
  }
}

/** Corner points of a path (M and L commands). */
const corners = (p: Path) =>
  p.flatMap(c => (c.op === 'M' || c.op === 'L' ? [[Math.round(c.x), Math.round(c.y)]] : []));

/** Bounding box of a path's points, Béziers included. */
function box(p: Path) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const c of p) {
    if (c.op === 'Z') continue;
    xs.push(c.x);
    ys.push(c.y);
  }
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map(Math.round);
}

const RED = colorRef(255, 0, 0);
const BLUE = colorRef(0, 0, 255);
const GREEN = colorRef(0, 160, 0);

describe('EMF', () => {
  it('sizes the picture from its frame at 96 dpi', () => {
    const header = readEmfHeader(makeEmf(800, 600, SAMPLE_EMF_RECORDS));
    const layout = emfLayout(header);
    expect([layout.width, layout.height]).toEqual([800, 600]);
    expect(layout.base.map(v => Math.round(v * 1000) / 1000 + 0)).toEqual([1, 0, 0, 1, 0, 0]);
    expect(emfLayout(header, 400).width).toBe(400);
  });

  it('plays shapes, brushes, fonts and text', async () => {
    const bytes = makeEmf(800, 600, SAMPLE_EMF_RECORDS);
    const { painter, from } = await renderEmf(bytes, readEmfHeader(bytes), () => new Recorder());
    expect(from).toBe('EMF');
    const [rect, ellipse, triangle] = painter.fills;
    expect(rect?.paint).toBe('rgb(255 0 0)');
    expect(corners(rect?.path ?? [])).toEqual([
      [100, 100],
      [300, 100],
      [300, 250],
      [100, 250],
    ]);
    expect(ellipse?.paint).toBe('rgb(0 0 255)');
    expect(box(ellipse?.path ?? [])).toEqual([400, 100, 600, 300]);
    expect(triangle?.paint).toBe('rgb(0 160 0)');
    expect(corners(triangle?.path ?? [])).toEqual([
      [100, 500],
      [200, 350],
      [300, 500],
    ]);
    // NULL_PEN: nothing stroked
    expect(painter.strokes).toHaveLength(0);
    const [text] = painter.texts;
    expect(text?.text).toBe('Hello');
    expect(text?.font).toMatchObject({ family: 'Arial', size: 40, weight: 700 });
    expect(text?.baseline).toBe('alphabetic');
    expect(text?.matrix.slice(4)).toEqual([400, 450]);
  });

  it('maps HIMETRIC (y up) and anisotropic coordinates to the device', async () => {
    const himetric = [
      emr17(3), // MM_HIMETRIC: 0.01 mm, y up
      emf.select(0x80000008),
      emf.createBrush(1, RED),
      emf.select(1),
      emf.rectangle(0, 0, 2540, -2540), // one inch square
    ];
    const bytes = makeEmf(200, 200, himetric);
    const { painter } = await renderEmf(bytes, readEmfHeader(bytes), () => new Recorder());
    expect(box(painter.fills[0]?.path ?? [])).toEqual([0, 0, 96, 96]);
  });

  it('draws EMF+ instead of the GDI fallback, and falls back when EMF+ is unsupported', async () => {
    const gdiRect = [
      emf.select(0x80000008),
      emf.createBrush(1, RED),
      emf.select(1),
      emf.rectangle(0, 0, 50, 50),
    ];
    const good = makeEmf(100, 100, [
      emf.plus([plus.header(true)]),
      emf.plus([
        plus.fillRect(0xff00ff00, 10, 10, 30, 20),
        plus.solidBrush(2, 0x800000ff),
        plus.fillEllipse(2, 50, 50, 40, 40),
      ]),
      ...gdiRect,
      emf.plus([plus.eof()]),
    ]);
    const header = readEmfHeader(good);
    expect(header.plus).toEqual({ dual: true });
    const ok = await renderEmf(good, header, () => new Recorder());
    expect(ok.from).toBe('EMF+');
    expect(ok.painter.fills.map(f => f.paint)).toEqual(['rgb(0 255 0)', 'rgb(0 0 255 / 0.502)']);
    expect(corners(ok.painter.fills[0]?.path ?? [])).toEqual([
      [10, 10],
      [40, 10],
      [40, 30],
      [10, 30],
    ]);
    expect(box(ok.painter.fills[1]?.path ?? [])).toEqual([50, 50, 90, 90]);

    const unsupported = makeEmf(100, 100, [
      emf.plus([plus.header(true)]),
      emf.plus([plus.fillRect(0xff00ff00, 10, 10, 30, 20), plusRecord(0x40ff, 0, w => w.u32(0))]),
      ...gdiRect,
    ]);
    const fb = await renderEmf(unsupported, readEmfHeader(unsupported), () => new Recorder());
    expect(fb.from).toBe('EMF fallback');
    expect(fb.painter.fills.map(f => f.paint)).toEqual(['rgb(255 0 0)']);
  });
});

/** EMR_SETMAPMODE. */
function emr17(mode: number) {
  const b = new Uint8Array(12);
  const dv = new DataView(b.buffer);
  dv.setUint32(0, 17, true);
  dv.setUint32(4, 12, true);
  dv.setUint32(8, mode, true);
  return b;
}

describe('WMF', () => {
  it('maps the window onto the placeable box at 96 dpi and plays the records', async () => {
    // 1500 × 1125 units at 180 per inch = 800 × 600 px
    const bytes = makeWmf(1500, 1125, 180, [
      wmf.nullPen(),
      wmf.select(0),
      wmf.brush(RED),
      wmf.select(1),
      wmf.rectangle(150, 150, 450, 375),
      wmf.brush(BLUE),
      wmf.select(2),
      wmf.ellipse(750, 150, 1050, 450),
      wmf.font(-60, 'Times New Roman'),
      wmf.select(3),
      wmf.textColor(GREEN),
      wmf.textOut(150, 600, 'Hi'),
    ]);
    const header = readWmfHeader(bytes);
    const layout = wmfLayout(header);
    expect([layout.width, layout.height]).toEqual([800, 600]);
    const painter = new Recorder();
    await playWmf(bytes, painter, header, layout);
    expect(painter.fills.map(f => f.paint)).toEqual(['rgb(255 0 0)', 'rgb(0 0 255)']);
    expect(corners(painter.fills[0]?.path ?? [])).toEqual([
      [80, 80],
      [240, 80],
      [240, 200],
      [80, 200],
    ]);
    expect(box(painter.fills[1]?.path ?? [])).toEqual([400, 80, 560, 240]);
    expect(painter.strokes).toHaveLength(0);
    expect(painter.texts[0]).toMatchObject({ text: 'Hi', color: 'rgb(0 160 0)', baseline: 'top' });
    expect(painter.texts[0]?.font).toMatchObject({ family: 'Times New Roman', size: 32 });
    expect(painter.texts[0]?.matrix.slice(4)).toEqual([80, 320]);
  });
});

describe('decoded images in the engine', () => {
  /** Stand-in PNGs (Node has no OffscreenCanvas to render real ones). */
  const fakePng = (n: number) => {
    const b = pngHeader(16, 12);
    b[32] = n;
    return b;
  };
  /** The module with its interpreter's rendering faked. */
  const fakeModule = async () => ({
    interpreters: [
      register<ImageValue>({
        ...imageInterpreter,
        detect: () => 1,
        parse: () => ({
          kind: 'image',
          format: 'png',
          mime: 'image/png',
          dims: { width: 16, height: 12 },
          bytes: fakePng(0),
          decoded: {
            format: 'TIFF',
            mime: 'image/tiff',
            vector: false,
            pages: [
              { width: 2480, height: 3508 },
              { width: 2480, height: 3508 },
              { width: 100, height: 50 },
            ],
            stats: [{ label: 'Compression', value: 'CCITT Group 4' }],
            renderPage: async (i: number) => fakePng(i),
          },
        }),
      }),
    ],
  });

  async function engine() {
    const e = new Engine({ loaders: { imageformats: fakeModule } });
    const blob = new Blob([makeTiff([rgbPage(1, d => d)])], { type: 'image/tiff' });
    const ingest = await e.ingest({
      id: 'en-1',
      mime: 'image/tiff',
      name: 'scan.tif',
      size: blob.size,
      blob,
    });
    expect(ingest.interpretations[0]).toMatchObject({
      kind: 'image',
      status: 'loading',
      module: 'imageformats',
    });
    expect(await e.resolve('en-1', 'image')).toMatchObject({
      status: 'ready',
      label: 'TIFF 2480×3508 · 3 pages',
    });
    return e;
  }

  it('labels, summarises and slices pages', async () => {
    const e = await engine();
    const summary = await e.summary('en-1', 'image');
    const stat = (label: string) => summary.stats.find(s => s.label === label)?.value;
    expect(stat('Format')).toBe('TIFF');
    expect(stat('MIME')).toBe('image/tiff');
    expect(stat('Dimensions')).toBe('2480 × 3508');
    expect(stat('Compression')).toBe('CCITT Group 4');
    expect(await e.slice('en-1', 'image', { type: 'json' })).toEqual({
      pages: [
        { width: 2480, height: 3508 },
        { width: 2480, height: 3508 },
        { width: 100, height: 50 },
      ],
    });
    expect(await e.slice('en-1', 'image', { type: 'page', index: 2, scale: 1 })).toEqual({
      bytes: fakePng(2),
      mime: 'image/png',
    });
  });

  it('offers Convert and Pages as PNG', async () => {
    const e = await engine();
    expect(await e.actions('en-1', 'image')).toEqual(
      expect.arrayContaining(['image.convert', 'image.pagesAsPng']),
    );
    const out = await e.runAction('en-1', 'image', 'image.pagesAsPng', {});
    expect(out.map(o => o.name)).toEqual(['scan-page01.png', 'scan-page02.png', 'scan-page03.png']);
    expect(out[1]?.bytes).toEqual(fakePng(1));
  });
});
