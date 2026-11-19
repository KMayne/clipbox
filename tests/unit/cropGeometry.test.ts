import { describe, expect, it } from 'vitest';
import {
  aspectRatio,
  fitAspect,
  hitTest,
  moveBy,
  resize,
  spanFrom,
} from '../../src/components/previews/cropGeometry';

const frame = { width: 1920, height: 1080 };
const box = { left: 100, top: 100, width: 400, height: 200 };

describe('crop geometry', () => {
  it('draws from an anchor in any direction, inside the frame', () => {
    expect(spanFrom({ x: 100, y: 100 }, { x: 500, y: 300 }, null, frame)).toEqual(box);
    expect(spanFrom({ x: 500, y: 300 }, { x: 100, y: 100 }, null, frame)).toEqual(box);
    expect(spanFrom({ x: 1800, y: 1000 }, { x: 5000, y: 5000 }, null, frame)).toEqual({
      left: 1800,
      top: 1000,
      width: 120,
      height: 80,
    });
  });

  it('keeps a minimum size, and an aspect when given', () => {
    expect(spanFrom({ x: 10, y: 10 }, { x: 11, y: 11 }, null, frame)).toMatchObject({
      width: 16,
      height: 16,
    });
    expect(spanFrom({ x: 0, y: 0 }, { x: 1600, y: 300 }, 16 / 9, frame)).toEqual({
      left: 0,
      top: 0,
      width: 533,
      height: 300,
    });
    // Limited by the frame's bottom, the width follows
    expect(spanFrom({ x: 0, y: 900 }, { x: 1600, y: 1900 }, 1, frame)).toEqual({
      left: 0,
      top: 900,
      width: 180,
      height: 180,
    });
  });

  it('moves within the frame', () => {
    expect(moveBy(box, 50, -20, frame)).toMatchObject({ left: 150, top: 80 });
    expect(moveBy(box, 5000, 5000, frame)).toMatchObject({ left: 1520, top: 880 });
    expect(moveBy(box, -5000, 0, frame)).toMatchObject({ left: 0, top: 100 });
  });

  it('resizes from corners and edges', () => {
    expect(resize(box, 'se', { x: 700, y: 500 }, null, frame)).toEqual({
      left: 100,
      top: 100,
      width: 600,
      height: 400,
    });
    expect(resize(box, 'nw', { x: 0, y: 0 }, null, frame)).toEqual({
      left: 0,
      top: 0,
      width: 500,
      height: 300,
    });
    expect(resize(box, 'e', { x: 300, y: 999 }, null, frame)).toEqual({ ...box, width: 200 });
    expect(resize(box, 'n', { x: 0, y: 250 }, null, frame)).toEqual({
      ...box,
      top: 250,
      height: 50,
    });
    // An edge can't cross the opposite one
    expect(resize(box, 'w', { x: 900, y: 0 }, null, frame)).toMatchObject({ width: 16 });
  });

  it('keeps the aspect on edges, centred on the box', () => {
    const r = resize(box, 'e', { x: 500, y: 0 }, 1, frame);
    expect(r).toEqual({ left: 100, top: 0, width: 400, height: 400 });
  });

  it('fits an aspect inside a box', () => {
    expect(fitAspect(box, 1)).toEqual({ left: 200, top: 100, width: 200, height: 200 });
    expect(fitAspect({ left: 0, top: 0, width: 1920, height: 1080 }, 9 / 16)).toEqual({
      left: 656,
      top: 0,
      width: 608,
      height: 1080,
    });
    expect(aspectRatio('original', { width: 64, height: 48 })).toBeCloseTo(4 / 3);
    expect(aspectRatio('free', frame)).toBeNull();
  });

  it('hit-tests handles', () => {
    expect(hitTest(box, { x: 102, y: 98 }, 8)).toBe('nw');
    expect(hitTest(box, { x: 300, y: 300 }, 8)).toBe('s');
    expect(hitTest(box, { x: 300, y: 200 }, 8)).toBe('inside');
    expect(hitTest(box, { x: 50, y: 50 }, 8)).toBeNull();
  });
});
