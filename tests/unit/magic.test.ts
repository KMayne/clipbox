import { describe, expect, it } from 'vitest';
import { detectMagic, imageDimensions } from '../../src/core/magic';
import { gifHeader, jpegHeader, pngHeader, webpLosslessHeader } from './helpers';

describe('magic', () => {
  it.each([
    ['png', pngHeader(812, 430), { width: 812, height: 430 }],
    ['gif', gifHeader(64, 32), { width: 64, height: 32 }],
    ['jpeg', jpegHeader(1920, 1080), { width: 1920, height: 1080 }],
    ['webp', webpLosslessHeader(300, 200), { width: 300, height: 200 }],
  ] as const)('detects %s and its dimensions', (type, bytes, dims) => {
    expect(detectMagic(bytes)).toBe(type);
    expect(imageDimensions(type, bytes)).toEqual(dims);
  });

  it('detects svg with viewBox', () => {
    const svg = new TextEncoder().encode('<?xml version="1.0"?>\n<svg viewBox="0 0 24 16"></svg>');
    expect(detectMagic(svg)).toBe('svg');
    expect(imageDimensions('svg', svg)).toEqual({ width: 24, height: 16 });
  });

  it('detects non-image binaries and ignores text', () => {
    expect(detectMagic(new TextEncoder().encode('%PDF-1.7'))).toBe('pdf');
    expect(detectMagic(new Uint8Array([0x1f, 0x8b, 8]))).toBe('gzip');
    expect(detectMagic(new TextEncoder().encode('hello world'))).toBeNull();
  });
});
