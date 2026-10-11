import { describe, expect, it } from 'vitest';
import {
  baseFileName,
  extensionForMime,
  sanitiseFileName,
  uniqueFileNames,
} from '../../src/core/filenames';

describe('extensionForMime', () => {
  it('maps common types', () => {
    expect(extensionForMime('image/png')).toBe('png');
    expect(extensionForMime('image/jpeg')).toBe('jpg');
    expect(extensionForMime('text/plain;charset=utf-8')).toBe('txt');
    expect(extensionForMime('APPLICATION/JSON')).toBe('json');
    expect(extensionForMime('image/svg+xml')).toBe('svg');
  });

  it('falls back on suffixes, text, then bin', () => {
    expect(extensionForMime('application/vnd.api+json')).toBe('json');
    expect(extensionForMime('application/atom+xml')).toBe('xml');
    expect(extensionForMime('text/x-weird')).toBe('txt');
    expect(extensionForMime('application/octet-stream')).toBe('bin');
    expect(extensionForMime('')).toBe('bin');
  });
});

describe('sanitiseFileName', () => {
  it('replaces separators and illegal characters', () => {
    expect(sanitiseFileName('a/b\\c:d*e?.png')).toBe('a_b_c_d_e_.png');
    expect(sanitiseFileName('tab\there')).toBe('tab_here');
  });

  it('drops trailing dots and spaces, and dot-only names', () => {
    expect(sanitiseFileName('name. . ')).toBe('name');
    expect(sanitiseFileName('..')).toBe('');
  });

  it('escapes Windows device names', () => {
    expect(sanitiseFileName('CON')).toBe('_CON');
    expect(sanitiseFileName('nul.txt')).toBe('_nul.txt');
    expect(sanitiseFileName('console.txt')).toBe('console.txt');
  });

  it('caps long names but keeps the extension', () => {
    const name = sanitiseFileName(`${'x'.repeat(300)}.png`);
    expect(name.length).toBeLessThanOrEqual(180);
    expect(name.endsWith('.png')).toBe(true);
  });
});

describe('baseFileName', () => {
  it('keeps an own name, adding an extension only when it has none', () => {
    expect(baseFileName({ name: 'photo.png', mime: 'image/png' }, 1)).toBe('photo.png');
    expect(baseFileName({ name: 'notes.md', mime: 'text/plain' }, 1)).toBe('notes.md');
    expect(baseFileName({ name: 'slide1', mime: 'image/jpeg' }, 1)).toBe('slide1.jpg');
    expect(baseFileName({ name: 'blob', mime: 'application/octet-stream' }, 1)).toBe('blob');
  });

  it('uses only the last path segment', () => {
    expect(baseFileName({ name: 'ppt/media/image3.png', mime: 'image/png' }, 1)).toBe('image3.png');
  });

  it('generates <kind>-<n>.<ext> without a name', () => {
    expect(baseFileName({ mime: 'image/png', kind: 'image' }, 3)).toBe('image-3.png');
    expect(baseFileName({ mime: 'application/json', kind: 'json' }, 1)).toBe('json-1.json');
    expect(baseFileName({ mime: 'audio/mpeg' }, 2)).toBe('audio-2.mp3');
    expect(baseFileName({ mime: 'application/x-thing' }, 4)).toBe('file-4.bin');
    expect(baseFileName({ name: '', mime: 'text/plain' }, 5)).toBe('text-5.txt');
  });
});

describe('uniqueFileNames', () => {
  it('de-duplicates case-insensitively with " (n)" before the extension', () => {
    expect(
      uniqueFileNames([
        { name: 'a.png', mime: 'image/png' },
        { name: 'A.png', mime: 'image/png' },
        { name: 'a.png', mime: 'image/png' },
        { name: 'README', mime: 'text/plain' },
        { name: 'README', mime: 'application/octet-stream' },
      ]),
    ).toEqual(['a.png', 'A (2).png', 'a (3).png', 'README.txt', 'README']);
  });

  it('numbers generated names by position and avoids taken names', () => {
    expect(
      uniqueFileNames(
        [
          { mime: 'image/png', kind: 'image' },
          { mime: 'image/png', kind: 'image' },
          { name: 'photo.jpg', mime: 'image/jpeg' },
        ],
        ['IMAGE-1.png', 'photo.jpg', 'photo (2).jpg'],
      ),
    ).toEqual(['image-1 (2).png', 'image-2.png', 'photo (3).jpg']);
  });

  it("doesn't collide with a generated name that already has a suffix", () => {
    expect(
      uniqueFileNames([
        { name: 'x (2).txt', mime: 'text/plain' },
        { name: 'x.txt', mime: 'text/plain' },
        { name: 'x.txt', mime: 'text/plain' },
      ]),
    ).toEqual(['x (2).txt', 'x.txt', 'x (3).txt']);
  });
});
