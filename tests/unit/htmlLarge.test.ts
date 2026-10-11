import { describe, expect, it } from 'vitest';
import { htmlToMarkdown, htmlToText, tableRows } from '../../src/core/html/convert';
import { findAll, parseHtml, serialize, textContent } from '../../src/core/html/dom';
import { extractLinks, extractTables, sanitiseTree } from '../../src/core/html/extract';
import { call, trampoline, type Step } from '../../src/core/trampoline';

// Inputs that used to overflow the call stack (deep recursion, or Math.max/push over a spread)

const ROWS = 200_000;
const bigTable = () =>
  `<table><thead><tr><th>n</th><th>sq</th></tr></thead><tbody>${Array.from(
    { length: ROWS },
    (_, i) => `<tr><td>${i}</td><td>${i * i}</td></tr>`,
  ).join('')}</tbody></table>`;

const DEPTH = 10_000;
const nested = (open: string, close: string, inner: string) =>
  `${open.repeat(DEPTH)}${inner}${close.repeat(DEPTH)}`;

describe('trampoline', () => {
  it('runs recursion far deeper than the call stack', () => {
    function* depth(n: number): Step<number> {
      return n === 0 ? 0 : 1 + (yield* call(depth(n - 1)));
    }
    expect(trampoline(depth(200_000))).toBe(200_000);
  });
});

describe('HTML on big and deep inputs', () => {
  it(`converts a ${ROWS.toLocaleString()}-row table to Markdown and text`, () => {
    const html = bigTable();
    const md = htmlToMarkdown(html).split('\n');
    expect(md.slice(0, 4)).toEqual(['| n | sq |', '| --- | --- |', '| 0 | 0 |', '| 1 | 1 |']);
    expect(md.at(-2)).toBe(`| ${ROWS - 1} | ${(ROWS - 1) ** 2} |`);
    const text = htmlToText(html).split('\n');
    expect(text).toHaveLength(ROWS + 2);
    expect(text.at(-2)).toBe(`${ROWS - 1}\t${(ROWS - 1) ** 2}`);
  }, 60_000);

  it(`extracts a ${ROWS.toLocaleString()}-row table, header first`, () => {
    const root = parseHtml(
      bigTable().replace('<thead>', '<tfoot><tr><td>end</td></tr></tfoot><thead>'),
    );
    const [table] = extractTables(root);
    expect(table).toHaveLength(ROWS + 2);
    expect(table?.[0]).toEqual(['n', 'sq']);
    expect(table?.[1]).toEqual(['0', '0']);
    expect(table?.at(-1)).toEqual(['end']);
  }, 60_000);

  it('keeps row order across thead, tbody, tfoot and bare rows', () => {
    const t = findAll(
      parseHtml(
        '<table><tfoot><tr><td>f</td></tr></tfoot><tr><td>a</td></tr><tbody><tr><td>b</td></tr>' +
          '</tbody><thead><tr><td>h</td></tr></thead><tbody><tr><td>c</td></tr></tbody></table>',
      ),
      'table',
    )[0];
    if (!t) throw new Error('no table');
    expect(tableRows(t).map(r => r.map(c => (c ? textContent(c) : '')))).toEqual([
      ['h'],
      ['a'],
      ['b'],
      ['c'],
      ['f'],
    ]);
  });

  it(`converts ${DEPTH.toLocaleString()} nested divs, blockquotes, lists and spans`, () => {
    expect(htmlToMarkdown(nested('<div>', '</div>', '<p>deep <b>bold</b></p>'))).toBe(
      'deep **bold**\n',
    );
    expect(htmlToText(nested('<div>', '</div>', 'deep'))).toBe('deep\n');
    const quote = htmlToMarkdown(nested('<blockquote>', '</blockquote>', 'q'));
    expect(quote.startsWith('> > > ')).toBe(true);
    expect(quote.trimEnd().endsWith('> q')).toBe(true);
    const list = htmlToMarkdown(nested('<ul><li>', '</li></ul>', 'x'));
    expect(list.startsWith('- - - ')).toBe(true);
    expect(htmlToMarkdown(nested('<span><i>', '</i></span>', 'x'))).toContain('x');
    expect(htmlToText(nested('<td>', '</td>', 'cell'))).toContain('cell');
  }, 60_000);

  it('walks, serialises, sanitises and extracts links from deep markup', () => {
    const html = nested(
      '<div>',
      '</div>',
      '<a href="https://x.test/">link</a><script>bad</script>',
    );
    const root = parseHtml(html);
    expect(findAll(root, 'div')).toHaveLength(DEPTH);
    expect(textContent(root)).toBe('link');
    expect(extractLinks(root)).toEqual([{ text: 'link', href: 'https://x.test/', title: '' }]);
    const out = serialize(root);
    expect(out).toBe(html);
    const clean = serialize(sanitiseTree(root));
    expect(clean).not.toContain('script');
    expect(clean).toContain('<a href="https://x.test/" rel="noopener noreferrer">link</a>');
    // An unwrapped element with very many children
    const wide = `<custom>${'<b>x</b>'.repeat(200_000)}</custom>`;
    expect(sanitiseTree(parseHtml(wide)).children).toHaveLength(200_000);
  }, 60_000);

  it('converts a container with very many blocks and code with many backtick runs', () => {
    const many = `<div>${'<p>p</p>'.repeat(200_000)}</div>`;
    expect(htmlToText(many).split('\n\n')).toHaveLength(200_000);
    const code = `<pre>${'a`'.repeat(200_000)}</pre>`;
    expect(htmlToMarkdown(code).startsWith('```\n')).toBe(true);
  }, 60_000);
});
