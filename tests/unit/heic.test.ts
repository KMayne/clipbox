import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { heicDetector, sniffHeif } from '../../src/modules/heic/detect';
import { createHeif, type Heif } from '../../src/modules/heic/heif';
import { heifStats } from '../../src/modules/heic/interpreter';
import { sniffMedia } from '../../src/modules/media/detect';
import { ftyp, mp4 } from '../fixtures/media';
import { bytesContent } from './helpers';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../fixtures/heic/${name}`, import.meta.url)));

describe('HEIC detection', () => {
  it.each([
    ['iPhone HEIC', ftyp('heic', 'mif1', 'heic'), 'HEIC', 'image/heic'],
    ['generic HEIF major, HEIC compatible', ftyp('mif1', 'mif1', 'heic'), 'HEIC', 'image/heic'],
    ['heix (10-bit)', ftyp('heix', 'mif1', 'heix'), 'HEIC', 'image/heic'],
    ['HEIF without an HEVC brand', ftyp('mif1', 'mif1', 'miaf'), 'HEIF', 'image/heif'],
    ['HEVC image sequence', ftyp('hevc', 'msf1', 'hevc'), 'HEIC', 'image/heic-sequence'],
    ['HEIF image sequence', ftyp('msf1', 'msf1', 'iso8'), 'HEIF', 'image/heif-sequence'],
    ['the halves fixture', fixture('halves.heic'), 'HEIC', 'image/heic'],
  ])('accepts %s', (_, bytes, format, mime) => {
    expect(sniffHeif(bytes)).toEqual({ format, mime });
    expect(heicDetector.detect(bytesContent(bytes))).toBe(1);
    // …and the media module leaves them alone
    expect(sniffMedia(bytes)).toBeNull();
  });

  it.each([
    ['AVIF', ftyp('avif', 'mif1', 'miaf', 'MA1B')],
    ['AVIF sequence', ftyp('avis', 'msf1', 'avis')],
    ['AVIF as a compatible brand', ftyp('mif1', 'mif1', 'avif')],
    ['plain MP4', mp4()],
    ['MP4 isom', ftyp('isom', 'isom', 'avc1')],
    ['M4A', ftyp('M4A ', 'M4A ', 'mp42')],
    ['QuickTime', ftyp('qt  ', 'qt  ')],
    ['too short', new Uint8Array([0, 0, 0, 12, 0x66, 0x74, 0x79, 0x70])],
    ['PNG', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0])],
  ])('rejects %s', (_, bytes) => {
    expect(sniffHeif(bytes)).toBeNull();
    expect(heicDetector.detect(bytesContent(bytes))).toBe(0);
  });
});

describe('libheif', () => {
  const require = createRequire(import.meta.url);
  const wasm = readFileSync(require.resolve('libheif-js/libheif-wasm/libheif.wasm'));
  let lib: Promise<Heif> | null = null;
  const load = () => (lib ??= createHeif(wasm));

  const pixel = (r: { width: number; data: Uint8ClampedArray }, x: number, y: number) => [
    ...r.data.subarray((y * r.width + x) * 4, (y * r.width + x) * 4 + 4),
  ];
  const near = (got: number[], want: number[], tolerance = 8) =>
    expect(
      got.every((v, i) => Math.abs(v - (want[i] ?? 0)) <= tolerance),
      `${got} ≈ ${want}`,
    ).toBe(true);

  it('reads and decodes a single-image HEIC', async () => {
    const heif = await load();
    const bytes = fixture('halves.heic');
    const images = heif.read(bytes);
    expect(images).toEqual([
      { id: 1, width: 64, height: 48, primary: true, alpha: false, bitDepth: 8 },
    ]);
    const r = heif.decode(bytes, 1);
    expect([r.width, r.height]).toEqual([64, 48]);
    near(pixel(r, 2, 2), [220, 20, 30, 255]);
    near(pixel(r, 60, 40), [10, 40, 230, 255]);
  });

  it('lists every top-level image of a burst, primary first', async () => {
    const heif = await load();
    const bytes = fixture('burst.heic');
    const images = heif.read(bytes);
    expect(images.map(i => [i.width, i.height, i.primary])).toEqual([
      [64, 48, true],
      [32, 32, false],
      [16, 24, false],
    ]);
    const green = heif.decode(bytes, images[1]?.id ?? 0);
    expect([green.width, green.height]).toEqual([32, 32]);
    near(pixel(green, 5, 5), [20, 200, 40, 255]);
    const blue = heif.decode(bytes, images[2]?.id ?? 0);
    expect([blue.width, blue.height]).toEqual([16, 24]);
    near(pixel(blue, 15, 23), [10, 40, 230, 255]);

    expect(heifStats(images)).toEqual([
      {
        label: 'Images',
        value: '3',
        children: [
          { label: 'Image 1', value: '64 × 48 · primary' },
          { label: 'Image 2', value: '32 × 32' },
          { label: 'Image 3', value: '16 × 24' },
        ],
      },
      { label: 'Bit depth', value: '8-bit' },
      { label: 'Alpha', value: 'No' },
    ]);
  });

  it('samples a decode down to the pixel cap', async () => {
    const heif = await load();
    const r = heif.decode(fixture('halves.heic'), 1, 64 * 48 / 4);
    expect([r.width, r.height]).toEqual([32, 24]);
    near(pixel(r, 1, 1), [220, 20, 30, 255]);
    near(pixel(r, 30, 20), [10, 40, 230, 255]);
  });

  it('rejects broken files and unknown images with a clear error', async () => {
    const heif = await load();
    const bytes = fixture('halves.heic');
    expect(() => heif.read(bytes.slice(0, 200))).toThrow(/HEIF/);
    expect(() => heif.decode(bytes, 99)).toThrow(/image 99/);
    // libheif still works afterwards: every context and handle was freed
    expect(heif.read(bytes)).toHaveLength(1);
  });
});
