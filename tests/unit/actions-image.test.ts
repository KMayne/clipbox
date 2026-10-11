import { describe, expect, it } from 'vitest';
import { palette, resizeTarget, transformTarget } from '../../src/core/image/ops';
import { Engine } from '../../src/engine/engine';
import { service as qrService } from '../../src/modules/qr/worker';
import { pngHeader } from './helpers';

const custom = (width: number, height: number, keepAspect = true) =>
  ({ size: 'custom', width, height, keepAspect }) as const;

describe('resize target', () => {
  const src = { width: 400, height: 300 };
  it('scales by presets', () => {
    expect(resizeTarget(src, { ...custom(0, 0), size: '25' })).toEqual({ width: 100, height: 75 });
    expect(resizeTarget({ width: 3, height: 3 }, { ...custom(0, 0), size: '25' })).toEqual({
      width: 1,
      height: 1,
    });
  });
  it('derives the other side, or fits a box, keeping the aspect', () => {
    expect(resizeTarget(src, custom(200, 0))).toEqual({ width: 200, height: 150 });
    expect(resizeTarget(src, custom(0, 600))).toEqual({ width: 800, height: 600 });
    expect(resizeTarget(src, custom(200, 200))).toEqual({ width: 200, height: 150 });
  });
  it('stretches without keep-aspect, keeping an unset side', () => {
    expect(resizeTarget(src, custom(200, 200, false))).toEqual({ width: 200, height: 200 });
    expect(resizeTarget(src, custom(200, 0, false))).toEqual({ width: 200, height: 300 });
  });
  it('rejects no size and huge sizes', () => {
    expect(() => resizeTarget(src, custom(0, 0))).toThrow('Set a width or a height');
    expect(() => resizeTarget(src, custom(0, 16_000))).toThrow('too large');
  });
});

describe('transform target', () => {
  /** Where the matrix sends a point. */
  const apply = (m: number[], x: number, y: number) => [
    (m[0] ?? 0) * x + (m[2] ?? 0) * y + (m[4] ?? 0),
    (m[1] ?? 0) * x + (m[3] ?? 0) * y + (m[5] ?? 0),
  ];
  it('rotates and flips the top-left corner to the right place', () => {
    const src = { width: 4, height: 2 };
    expect(transformTarget(src, 'cw')).toMatchObject({ width: 2, height: 4 });
    expect(transformTarget(src, 'flipV')).toMatchObject({ width: 4, height: 2 });
    // Top-left source corner lands on: cw → top-right, ccw → bottom-left, 180 → bottom-right
    expect(apply(transformTarget(src, 'cw').matrix, 0, 0)).toEqual([2, 0]);
    expect(apply(transformTarget(src, 'ccw').matrix, 0, 0)).toEqual([0, 4]);
    expect(apply(transformTarget(src, '180').matrix, 0, 0)).toEqual([4, 2]);
    expect(apply(transformTarget(src, 'flipH').matrix, 0, 0)).toEqual([4, 0]);
    expect(apply(transformTarget(src, 'flipV').matrix, 0, 0)).toEqual([0, 2]);
  });
});

describe('palette', () => {
  const pixels = (colours: [number, number, number, number, number][]) =>
    new Uint8ClampedArray(colours.flatMap(([r, g, b, a, n]) => Array(n).fill([r, g, b, a]).flat()));

  it('finds dominant colours, most common first, ignoring transparency', () => {
    const data = pixels([
      [255, 0, 0, 255, 50],
      [250, 5, 0, 255, 10],
      [0, 0, 255, 255, 30],
      [0, 255, 0, 0, 100], // transparent
    ]);
    const out = palette(data, 2);
    expect(out).toHaveLength(2);
    expect(out[1]).toBe('#0000ff');
    expect(out[0]).toMatch(/^#fe0[01]00$/);
  });

  it('returns fewer colours than asked when there are fewer', () => {
    expect(palette(pixels([[10, 20, 30, 255, 5]]), 6)).toEqual(['#0a141e']);
    expect(palette(pixels([[10, 20, 30, 0, 5]]), 6)).toEqual([]);
  });
});

describe('image actions in the engine', () => {
  it('writes a data URL', async () => {
    const engine = new Engine({ loaders: {} });
    const png = pngHeader(3, 2);
    const blob = new Blob([png], { type: 'image/png' });
    await engine.ingest({ id: 'en-1', mime: 'image/png', size: blob.size, blob, name: 'a.png' });
    expect(await engine.actions('en-1', 'image')).toEqual([
      'image.convert',
      'image.resize',
      'image.rotate',
      'image.dataUrl',
      'image.readCodes',
      'image.palette',
      'any.hash',
    ]);
    const [out] = await engine.runAction('en-1', 'image', 'image.dataUrl', {});
    expect(out?.name).toBe('a.txt');
    expect(new TextDecoder().decode(out?.bytes)).toBe(
      `data:image/png;base64,${Buffer.from(png).toString('base64')}`,
    );
  });
});

describe('qr module', () => {
  it('finds nothing in a blank image', () => {
    expect(qrService.decode(new Uint8ClampedArray(64 * 64 * 4).fill(255), 64, 64)).toBeNull();
  });
});
