import { describe, expect, it } from 'vitest';
import { detectKinds, getInterpreter } from '../../src/core/interpreters';
import { textContent, bytesContent, pngHeader } from './helpers';
import type { EntryContent } from '../../src/core/content';

const kinds = (c: EntryContent) => detectKinds(c).map(d => d.kind);
const summarise = (kind: string, c: EntryContent) => {
  const i = getInterpreter(kind);
  const v = i.parse(c);
  return { label: i.label(v), ...i.summarise(v), value: v };
};
const stat = (stats: { label: string; value: string }[], label: string) =>
  stats.find(s => s.label === label)?.value;

const USERS = JSON.stringify([
  { id: 1, name: 'Ada', team: 'core' },
  { id: 2, name: 'Linus', team: 'infra' },
  { id: 3, name: 'Grace' },
]);

describe('json', () => {
  it('ranks JSON first for an array of objects and offers records + text', () => {
    expect(kinds(textContent(USERS))).toEqual(['json', 'records', 'text']);
  });

  it('summarises arrays', () => {
    const s = summarise('json', textContent(USERS));
    expect(s.label).toBe('JSON array · 3');
    expect(stat(s.stats, 'Length')).toBe('3');
    expect(stat(s.stats, 'Element types')).toBe('object 3');
    const keys = s.stats.find(r => r.label === 'Element keys')!;
    expect(keys.children).toContainEqual({ label: 'team', value: 'string · 67%' });
    expect(stat(s.stats, 'Max depth')).toBe('2');
  });

  it('does not claim bare scalars from text/plain', () => {
    expect(kinds(textContent('42'))).toEqual(['text']);
  });
});

describe('records', () => {
  it('parses CSV with header and typed cells', () => {
    const c = textContent(
      'id,name,joined,active\n1,Ada,2024-01-02,true\n2,Linus,,false\n007,Grace,2023-05-06,true\n',
    );
    expect(kinds(c)[0]).toBe('records');
    const s = summarise('records', c);
    expect(s.label).toBe('Records 3×4');
    expect(s.columns).toEqual([
      { name: 'id', type: 'number | string' },
      { name: 'name', type: 'string' },
      { name: 'joined', type: 'date' },
      { name: 'active', type: 'boolean' },
    ]);
    expect(stat(s.stats, 'Source')).toBe('comma-delimited');
  });

  it('prefers tab over comma for TSV', () => {
    const c = textContent('a\tb\n1,5\t2\n3\t4\n5\t6');
    const s = summarise('records', c);
    expect(stat(s.stats, 'Source')).toBe('tab-delimited');
  });

  it('detects missing header', () => {
    const s = summarise('records', textContent('1,2\n3,4\n5,6'));
    expect(s.columns!.map(c => c.name)).toEqual(['col1', 'col2']);
  });

  it('ranks prose below text', () => {
    const prose = [
      'Well, I went to the shop, and then I came home again after a while.',
      'Later, we talked about it, and nobody could quite agree on the plan.',
      'Anyway, it rained all day, so the picnic was cancelled, sadly enough.',
    ].join('\n');
    expect(kinds(textContent(prose))[0]).toBe('text');
  });
});

describe('text', () => {
  it('reports line endings and counts', () => {
    const s = summarise('text', textContent('one two\r\nthree\r\n\r\nfour\r\n'));
    expect(stat(s.stats, 'Lines')).toBe('4');
    expect(stat(s.stats, 'Line endings')).toBe('CRLF');
    expect(stat(s.stats, 'Words')).toBe('4');
    expect(stat(s.stats, 'Blank lines')).toBe('1');
    expect(stat(s.stats, 'Trailing newline')).toBe('yes');
  });
});

describe('html', () => {
  const html =
    '<meta charset="utf-8"><table><tr><td>a &amp; b</td><td>c</td></tr></table><a href="x">link</a><img src="y">';

  it('is preferred for text/html and also offers stripped text', () => {
    const c = textContent(html, 'text/html');
    expect(kinds(c)).toEqual(['html', 'text']);
    const s = summarise('html', c);
    expect(stat(s.stats, 'Tables')).toBe('1');
    expect(stat(s.stats, 'Links')).toBe('1');
    expect(stat(s.stats, 'Images')).toBe('1');
    expect(summarise('text', c).value).toEqual({ text: 'a & b\tc\n\nlink' });
  });
});

describe('image + binary', () => {
  it('reads PNG metadata', () => {
    const c = bytesContent(pngHeader(812, 430), 'image/png');
    expect(kinds(c)).toEqual(['image', 'binary']);
    const s = summarise('image', c);
    expect(s.label).toBe('PNG 812×430');
    expect(stat(s.stats, 'Aspect ratio')).toBe('1.89:1');
  });

  it('falls back to binary for unknown bytes', () => {
    const c = bytesContent([0, 1, 2, 3, 0xff]);
    expect(kinds(c)).toEqual(['binary']);
    expect(stat(summarise('binary', c).stats, 'First 16 bytes')).toBe('00 01 02 03 ff');
  });
});
