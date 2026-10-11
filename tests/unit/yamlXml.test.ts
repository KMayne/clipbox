import { describe, expect, it } from 'vitest';
import { detectKinds, getInterpreter } from '../../src/core/interpreters';
import type { EntryContent } from '../../src/core/content';
import { defined } from '../../src/core/guards';
import type { InterpretContext } from '../../src/core/interpreter';
import type { StatRow } from '../../src/core/types';
import { textContent } from './helpers';

const kinds = (c: EntryContent) => detectKinds(c).map(d => d.kind);
const confidence = (c: EntryContent, kind: string) =>
  detectKinds(c).find(d => d.kind === kind)?.confidence ?? 0;
const noServices: InterpretContext = { service: async () => null };
const summarise = async (kind: string, c: EntryContent) => {
  const i = getInterpreter(kind);
  const v = await i.parse(c, noServices);
  return { label: i.label(v), ...(await i.summarise(v)), value: v, i };
};
const row = (stats: StatRow[], label: string) =>
  defined(
    stats.find(s => s.label === label),
    label,
  );
const stat = (stats: StatRow[], label: string) => row(stats, label).value;

const CONFIG = `# Service config
name: clipbox
version: 3
defaults: &defaults
  retries: 2
  timeout: 30
servers:
  - host: a.example.com
    <<: *defaults
  - host: b.example.com
    <<: *defaults
tags: [web, worker]
`;

const PROSE = [
  'Well, I went to the shop, and then I came home again after a while.',
  'Later, we talked about it: nobody could quite agree on the plan.',
  'Anyway, it rained all day, so the picnic was cancelled, sadly enough.',
].join('\n');
const CSV = 'id,name,joined\n1,Ada,2024-01-02\n2,Linus,2023-05-06\n3,Grace,2022-01-01\n';
const ENV = 'NODE_ENV=production\nAPI_URL=https://api.example.com\nPORT=8080\n';
const JSON_TEXT = JSON.stringify({ a: 1, b: [1, 2] });
const HTML = '<!doctype html>\n<html><body><p>hi</p></body></html>';

describe('yaml', () => {
  it('detects a mapping and ranks it first', () => {
    const c = textContent(CONFIG);
    expect(kinds(c)[0]).toBe('yaml');
    expect(confidence(c, 'yaml')).toBe(0.7);
  });

  it('is more confident with a leading --- or a YAML MIME type', () => {
    expect(confidence(textContent('---\na: 1\nb: 2\n'), 'yaml')).toBe(0.85);
    expect(confidence(textContent('a: 1\nb: 2\n', 'application/yaml'), 'yaml')).toBe(0.85);
  });

  it('labels and summarises a mapping', async () => {
    const s = await summarise('yaml', textContent(CONFIG));
    expect(s.label).toBe('YAML · mapping · 5 keys');
    expect(stat(s.stats, 'Top-level type')).toBe('object');
    expect(stat(s.stats, 'Documents')).toBe('1');
    expect(stat(s.stats, 'Anchors')).toBe('1');
    expect(stat(s.stats, 'Aliases')).toBe('2');
    expect(stat(s.stats, 'Comment lines')).toBe('1');
    expect(row(s.stats, 'Keys').children).toContainEqual({
      label: 'tags',
      value: 'string[] · 100%',
    });
    expect(s.schema?.t).toBe('object');
    // Merge keys resolve through the alias
    const servers = await s.i.slice(s.value, {
      type: 'children',
      path: ['servers', 0],
      from: 0,
      to: 10,
    });
    expect(servers).toContainEqual(expect.objectContaining({ key: 'retries', preview: '2' }));
    expect(await s.i.slice(s.value, { type: 'text' })).toBe(CONFIG);
    expect(await s.i.export(s.value)).toEqual({ text: CONFIG });
  });

  it('labels a sequence', async () => {
    const s = await summarise(
      'yaml',
      textContent('- name: Ada\n- name: Linus\n- name: Grace\n- name: Alan\n'),
    );
    expect(s.label).toBe('YAML · sequence · 4');
  });

  it('handles multiple documents', async () => {
    const c = textContent('---\nname: a\n---\nname: b\n---\nname: c\n');
    const s = await summarise('yaml', c);
    expect(s.label).toBe('YAML · 3 documents');
    expect(stat(s.stats, 'Documents')).toBe('3');
    expect(await s.i.slice(s.value, { type: 'json' })).toEqual([
      { name: 'a' },
      { name: 'b' },
      { name: 'c' },
    ]);
  });

  it.each([
    ['prose', PROSE],
    ['CSV', CSV],
    ['.env', ENV],
    ['JSON', JSON_TEXT],
    ['HTML', HTML],
    ['a single line', 'key: value'],
    ['a Markdown list', '# Shopping\n\n- eggs\n- milk\n- bread\n'],
    ['a parse error', 'a: 1\na: 2\n'],
  ])('does not claim %s', (_, text) => {
    expect(kinds(textContent(text))).not.toContain('yaml');
  });
});

const FEED = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
  <title>Example</title>
  <entry id="1"><title>One</title><media:thumbnail url="a.png"/></entry>
  <entry id="2"><title>Two</title></entry>
</feed>`;

describe('xml', () => {
  it('detects XML with a prolog at 0.85', () => {
    const c = textContent(FEED);
    expect(kinds(c)[0]).toBe('xml');
    expect(confidence(c, 'xml')).toBe(0.85);
  });

  it('uses 0.7 without a prolog, 0.85 for an XML MIME type', () => {
    expect(confidence(textContent('<a><b/></a>'), 'xml')).toBe(0.7);
    expect(confidence(textContent('<a><b/></a>', 'application/xml'), 'xml')).toBe(0.85);
    expect(confidence(textContent('\uFEFF  <a><b/></a>'), 'xml')).toBe(0.7);
  });

  it('labels and summarises, including namespaces', async () => {
    const s = await summarise('xml', textContent(FEED));
    expect(s.label).toBe('XML · <feed> · 7 elements');
    expect(stat(s.stats, 'Root element')).toBe('<feed>');
    expect(stat(s.stats, 'Elements')).toBe('7');
    expect(stat(s.stats, 'Max depth')).toBe('3');
    // xmlns ×2, id ×2, url
    expect(stat(s.stats, 'Attributes')).toBe('5');
    const ns = row(s.stats, 'Namespaces');
    expect(ns.value).toBe('2');
    expect(ns.children).toEqual([
      { label: '(default)', value: 'http://www.w3.org/2005/Atom' },
      { label: 'media', value: 'http://search.yahoo.com/mrss/' },
    ]);
    const tags = row(s.stats, 'Distinct tags');
    expect(tags.value).toBe('4');
    expect(tags.children?.[0]).toEqual({ label: 'title', value: '3' });
    expect(await s.i.export(s.value)).toEqual({ text: FEED });
    const top = await s.i.slice(s.value, { type: 'children', path: ['feed'], from: 0, to: 10 });
    expect(top).toContainEqual(expect.objectContaining({ key: 'entry', type: 'array' }));
  });

  it('leaves the declaration out of the tree and reports it in stats', async () => {
    const s = await summarise('xml', textContent(FEED));
    const tree = await s.i.slice(s.value, { type: 'json' });
    expect(Object.keys(tree ?? {})).toEqual(['feed']);
    const top = await s.i.slice(s.value, { type: 'children', path: [], from: 0, to: 10 });
    expect(top).toEqual([expect.objectContaining({ key: 'feed' })]);
    expect(stat(s.stats, 'XML version')).toBe('1.0');
    expect(stat(s.stats, 'Encoding')).toBe('utf-8');
    expect(s.stats.find(r => r.label === 'Standalone')).toBeUndefined();
    const bare = await summarise('xml', textContent('<a><b/></a>'));
    expect(bare.stats.find(r => r.label === 'XML version')).toBeUndefined();
  });

  it('defers to the image kind for SVG', () => {
    const c = textContent('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"></svg>');
    expect(kinds(c)[0]).toBe('image');
    expect(confidence(c, 'xml')).toBe(0.5);
  });

  it.each([
    ['prose', PROSE],
    ['CSV', CSV],
    ['.env', ENV],
    ['JSON', JSON_TEXT],
    ['an HTML document', HTML],
    ['malformed XML', '<a><b></a>'],
  ])('does not claim %s', (_, text) => {
    expect(kinds(textContent(text))).not.toContain('xml');
  });

  it.each([
    ['a class attribute', '<div class="card"><h2>Title</h2><p>Body</p></div>'],
    ['HTML-only elements', '<ul>\n  <li>one</li>\n  <li>two</li>\n</ul>'],
    ['a link with href', '<a href="https://example.com">example</a>'],
    ['a self-closed void element', '<p>one<br/>two</p>'],
  ])('ranks an HTML fragment with %s above XML', (_, text) => {
    const c = textContent(text);
    expect(kinds(c)[0]).toBe('html');
    expect(kinds(c)).toContain('xml');
  });

  it('detects HTML that is not well-formed XML', () => {
    expect(kinds(textContent('<p>one<br>two</p>'))[0]).toBe('html');
  });

  it.each([
    ['generic tags', '<a><b/></a>'],
    ['an RSS feed', '<rss><channel><title>T</title><item><link>x</link></item></channel></rss>'],
    ['a config', '<config><server port="80"/><title>x</title></config>'],
  ])('keeps %s as XML', (_, text) => {
    const c = textContent(text);
    expect(kinds(c)[0]).toBe('xml');
    expect(kinds(c)).not.toContain('html');
  });

  it('skips text/html', () => {
    expect(kinds(textContent('<p>hi</p>', 'text/html'))).not.toContain('xml');
  });
});
