import { describe, expect, it } from 'vitest';
import type { EntryContent } from '../../src/core/content';
import { defined } from '../../src/core/guards';
import type { InterpretContext } from '../../src/core/interpreter';
import { detectKinds, getInterpreter } from '../../src/core/interpreters';
import {
  contrastRatio,
  parseColour,
  toHex,
  toHslString,
  toRgbString,
} from '../../src/core/interpreters/colour';
import { isoWeek, parseTimestamp } from '../../src/core/interpreters/timestamp';
import { parseUrl } from '../../src/core/interpreters/url';
import { encodeUlid, parseUuid, uuidTimestamp } from '../../src/core/interpreters/uuid';
import { relativeTime } from '../../src/core/smallValue';
import { textContent } from './helpers';

const kinds = (c: EntryContent) => detectKinds(c).map(d => d.kind);
const noServices: InterpretContext = { service: async () => null };
const summarise = async (kind: string, c: EntryContent) => {
  const i = getInterpreter(kind);
  const v = await i.parse(c, noServices);
  return { label: i.label(v), ...(await i.summarise(v)), value: v, slice: i.slice.bind(null, v) };
};
const stat = (stats: { label: string; value: string }[], label: string) =>
  stats.find(s => s.label === label)?.value;

const NOT_SMALL_VALUES = [
  '42',
  '3.14',
  '-12',
  '12345678',
  '07700900123',
  'deadbeef',
  'cafe',
  'bad',
  'facade',
  'd41d8cd98f00b204e9800998ecf8427e', // MD5 hash
  'hello world',
  'example.com/path',
];

describe('small values: negatives', () => {
  it.each(NOT_SMALL_VALUES)('%s is only text', s => {
    expect(kinds(textContent(s))).toEqual(['text']);
  });

  it('ignores values inside larger text', () => {
    expect(kinds(textContent('created 1700000000 by #ff0000'))).toEqual(['text']);
    expect(kinds(textContent(`1700000000\n1700000001`))).not.toContain('timestamp');
    expect(kinds(textContent('x'.repeat(190) + ' 1700000000'))).toEqual(['text']);
  });
});

describe('timestamp', () => {
  it.each([
    ['1700000000', 'unix-s'],
    ['1700000000123', 'unix-ms'],
    ['1700000000123456', 'unix-us'],
    ['1700000000123456789', 'unix-ns'],
  ])('detects %s as %s', (s, format) => {
    const t = defined(parseTimestamp(s));
    expect(t.format).toBe(format);
    expect(new Date(t.ms).toISOString().startsWith('2023-11-14T22:13:20')).toBe(true);
  });

  it('rejects epochs outside 2000–2100', () => {
    expect(parseTimestamp('900000000')).toBeNull(); // 1998
    expect(parseTimestamp('4200000000')).toBeNull(); // 2103
    expect(parseTimestamp('42')).toBeNull();
  });

  it('parses ISO 8601 and RFC 2822', () => {
    expect(parseTimestamp('2024-02-29')).toMatchObject({
      format: 'iso-date',
      ms: Date.UTC(2024, 1, 29),
    });
    expect(parseTimestamp('2024-02-30')).toBeNull();
    expect(parseTimestamp('2024-13-01')).toBeNull();
    expect(parseTimestamp('2024-03-01T12:30:00.5+02:00')).toMatchObject({
      format: 'iso-datetime',
      ms: Date.UTC(2024, 2, 1, 10, 30, 0, 500),
      offset: 120,
    });
    expect(parseTimestamp('2024-03-01T12:30:00Z')?.ms).toBe(Date.UTC(2024, 2, 1, 12, 30));
    expect(parseTimestamp('Fri, 01 Mar 2024 12:30:00 -0500')).toMatchObject({
      format: 'rfc2822',
      ms: Date.UTC(2024, 2, 1, 17, 30),
    });
    expect(parseTimestamp('1 Mar 2024 12:30 GMT')?.ms).toBe(Date.UTC(2024, 2, 1, 12, 30));
  });

  it('summarises with conversions', async () => {
    const s = await summarise('timestamp', textContent('1700000000\n'));
    expect(s.label).toBe('Timestamp · 2023-11-14 22:13:20 UTC');
    expect(stat(s.stats, 'ISO 8601 (UTC)')).toBe('2023-11-14T22:13:20.000Z');
    expect(stat(s.stats, 'Unix milliseconds')).toBe('1700000000000');
    expect(stat(s.stats, 'Unix seconds')).toBe('1700000000');
    expect(stat(s.stats, 'Day of week (UTC)')).toBe('Tuesday');
    expect(stat(s.stats, 'ISO week')).toBe('2023-W46');
    expect(stat(s.stats, 'Detected as')).toBe('Unix seconds');
    expect(stat(s.stats, 'Relative')).toMatch(/ago$/);
    expect(stat(s.stats, 'Local')).toMatch(/GMT/);
    expect(kinds(textContent('1700000000'))).toEqual(['timestamp', 'text']);
  });

  it('computes ISO weeks across year boundaries and relative times', () => {
    expect(isoWeek(Date.UTC(2021, 0, 3))).toBe('2020-W53');
    expect(isoWeek(Date.UTC(2024, 11, 30))).toBe('2025-W01');
    const now = Date.UTC(2024, 0, 1);
    expect(relativeTime(now + 3 * 86_400_000, now)).toBe('in 3 days');
    expect(relativeTime(now - 2 * 3_600_000, now)).toBe('2 hours ago');
  });
});

describe('uuid', () => {
  it.each([
    ['c232ab00-9414-11ec-b3c8-9f6bdeced846', 1],
    ['550e8400-e29b-41d4-a716-446655440000', 4],
    ['1ec9414c-232a-6b00-b3c8-9f6bdeced846', 6],
    ['01890a5d-ac96-774b-bcce-b302099a8057', 7],
    ['{550E8400-E29B-41D4-A716-446655440000}', 4],
    ['550e8400e29b41d4a716446655440000', 4],
  ])('parses %s as v%i', (s, version) => {
    const u = defined(parseUuid(s));
    expect(parseInt(u.hex.charAt(12), 16)).toBe(version);
  });

  it('extracts embedded timestamps from v1, v6, v7 and ULID', () => {
    const iso = (s: string) =>
      new Date(defined(uuidTimestamp(defined(parseUuid(s))))).toISOString();
    // RFC 9562 test vectors: 2022-02-22 19:22:22 UTC
    expect(iso('c232ab00-9414-11ec-b3c8-9f6bdeced846')).toBe('2022-02-22T19:22:22.000Z');
    expect(iso('1ec9414c-232a-6b00-b3c8-9f6bdeced846')).toBe('2022-02-22T19:22:22.000Z');
    expect(iso('017f22e2-79b0-7cc3-98c4-dc0c0c07398f')).toBe('2022-02-22T19:22:22.000Z');
    expect(iso('01ARZ3NDEKTSV4RRFFQ69G5FAV')).toBe('2016-07-30T23:54:10.259Z');
    expect(uuidTimestamp(defined(parseUuid('550e8400-e29b-41d4-a716-446655440000')))).toBeNull();
  });

  it('handles nil, max and ULID round-trips', () => {
    expect(parseUuid('00000000-0000-0000-0000-000000000000')?.hex).toBe('0'.repeat(32));
    expect(parseUuid('ffffffff-ffff-ffff-ffff-ffffffffffff')?.hex).toBe('f'.repeat(32));
    const ulid = defined(parseUuid('01arz3ndektsv4rrffq69g5fav'));
    expect(ulid.ulid).toBe('01ARZ3NDEKTSV4RRFFQ69G5FAV');
    expect(encodeUlid(ulid.hex)).toBe('01ARZ3NDEKTSV4RRFFQ69G5FAV');
  });

  it('rejects non-UUIDs', () => {
    expect(parseUuid('550e8400-e29b-01d4-a716-446655440000')).toBeNull(); // version 0
    expect(parseUuid('d41d8cd98f00b204e9800998ecf8427e')).toBeNull(); // hash, not RFC variant
    expect(parseUuid('ZZZZZZZZZZZZZZZZZZZZZZZZZZ')).toBeNull();
    expect(parseUuid('7ZZZZZZZZZZZZZZZZZZZZZZZZZ')).toBeNull(); // ULID far in the future
  });

  it('summarises a v7', async () => {
    const s = await summarise('uuid', textContent('01890A5D-AC96-774B-BCCE-B302099A8057'));
    expect(s.label).toBe('UUID v7 · 2023-06-30 03:34:18.518 UTC');
    expect(stat(s.stats, 'Version')).toBe('7 (Unix time-ordered)');
    expect(stat(s.stats, 'Variant')).toBe('RFC 9562');
    expect(stat(s.stats, 'Canonical')).toBe('01890a5d-ac96-774b-bcce-b302099a8057');
    expect(stat(s.stats, 'Unhyphenated')).toBe('01890a5dac96774bbcceb302099a8057');
    expect(stat(s.stats, 'Embedded time')).toBe('2023-06-30 03:34:18.518 UTC');
  });
});

describe('url', () => {
  const URL_TEXT = 'https://example.com:8443/a/b%20c?q=hello%20world&tag=x&tag=y#frag';

  it('parses parts and decodes the query', () => {
    const u = defined(parseUrl(URL_TEXT));
    expect(u).toMatchObject({
      scheme: 'https',
      host: 'example.com',
      port: '8443',
      fragment: 'frag',
    });
    expect(u.segments).toEqual(['a', 'b c']);
    expect(u.query).toEqual([
      ['q', 'hello world'],
      ['tag', 'x'],
      ['tag', 'y'],
    ]);
    expect(parseUrl('example.com/x')).toBeNull();
    expect(parseUrl('https://exa mple.com')).toBeNull();
  });

  it('summarises a single URL and offers its query as records', async () => {
    const c = textContent(URL_TEXT);
    expect(kinds(c)).toEqual(['url', 'records', 'text']);
    const s = await summarise('url', c);
    expect(s.label).toBe('URL · example.com');
    expect(stat(s.stats, 'Port')).toBe('8443');
    const params = defined(s.stats.find(r => r.label === 'Query params'));
    expect(params.value).toBe('3');
    expect(params.children).toContainEqual({ label: 'q', value: 'hello world' });
    const r = await summarise('records', c);
    expect(r.label).toBe('Records 3×2');
    expect(stat(r.stats, 'Source')).toBe('URL query');
    expect(await r.slice({ type: 'rows', from: 0, to: 1 })).toEqual([
      { key: 'q', value: 'hello world' },
    ]);
  });

  it('offers no records for a URL without a query', () => {
    expect(kinds(textContent('https://example.com/'))).toEqual(['url', 'text']);
  });

  it('handles a list of URLs', async () => {
    const c = textContent('https://a.com/x?y=1\nhttp://b.org/\n\nhttps://a.com/z\n');
    expect(kinds(c)).toEqual(['url', 'records', 'text']);
    const s = await summarise('url', c);
    expect(s.label).toBe('URLs · 3');
    const r = await summarise('records', c);
    expect(r.columns?.map(col => col.name)).toEqual(['url', 'host', 'path', 'query']);
    expect(await r.slice({ type: 'rows', from: 0, to: 1 })).toEqual([
      { url: 'https://a.com/x?y=1', host: 'a.com', path: '/x', query: 'y=1' },
    ]);
    expect(kinds(textContent('https://a.com/\nnot a url'))).not.toContain('url');
  });
});

describe('colour', () => {
  it.each([
    ['#f80', '#ff8800'],
    ['#F808', '#ff880088'],
    ['#ff8800', '#ff8800'],
    ['#ff880080', '#ff880080'],
    ['rgb(255, 136, 0)', '#ff8800'],
    ['rgba(255,136,0,0.5)', '#ff880080'],
    ['rgb(255 136 0 / 50%)', '#ff880080'],
    ['rgb(100%, 0%, 0%)', '#ff0000'],
    ['hsl(32, 100%, 50%)', '#ff8800'],
    ['hsla(120, 100%, 25%, 1)', '#008000'],
    ['hsl(0.5turn 100% 50%)', '#00ffff'],
  ])('parses %s', (s, hex) => {
    expect(toHex(defined(parseColour(s)))).toBe(hex);
  });

  it('rejects non-colours', () => {
    for (const s of [
      'ff8800',
      '#ff88f',
      '#gggggg',
      'rgb(1, 2)',
      'rgb(1, 2, 3, 4, 5)',
      'hsl(1px, 2%, 3%)',
    ]) {
      expect(parseColour(s)).toBeNull();
    }
  });

  it('converts between formats', () => {
    const c = defined(parseColour('#336699'));
    expect(toRgbString(c)).toBe('rgb(51, 102, 153)');
    expect(toHslString(c)).toBe('hsl(210, 50%, 40%)');
    expect(toRgbString(defined(parseColour('#33669980')))).toBe('rgba(51, 102, 153, 0.502)');
  });

  it('computes WCAG contrast', () => {
    const white = { r: 255, g: 255, b: 255, a: 1 };
    const black = { r: 0, g: 0, b: 0, a: 1 };
    expect(contrastRatio(white, black)).toBeCloseTo(21, 5);
    expect(contrastRatio(defined(parseColour('#777777')), white)).toBeCloseTo(4.48, 2);
  });

  it('summarises', async () => {
    const s = await summarise('colour', textContent('#336699'));
    expect(s.label).toBe('Colour · #336699');
    expect(stat(s.stats, 'Contrast vs white')).toBe('6.00:1 (AA)');
    expect(stat(s.stats, 'Contrast vs black')).toBe('3.50:1 (AA large text only)');
    expect(await s.slice({ type: 'json' })).toMatchObject({ swatch: 'rgb(51, 102, 153)' });
    expect((await getInterpreter('colour').export(s.value)).text).toBe('#336699');
  });
});
