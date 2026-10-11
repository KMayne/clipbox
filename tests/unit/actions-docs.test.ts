import { describe, expect, it } from 'vitest';
import { htmlToMarkdown, htmlToText } from '../../src/core/html/convert';
import { parseHtml, serialize } from '../../src/core/html/dom';
import { sanitiseTree } from '../../src/core/html/extract';
import type { EntryId } from '../../src/core/types';
import { Engine } from '../../src/engine/engine';

const td = new TextDecoder();

async function engineWith(text: string, mime: string, name?: string, id: EntryId = 'en-1') {
  const engine = new Engine({ loaders: {} });
  const blob = new Blob([text], { type: mime });
  await engine.ingest({ id, mime, size: blob.size, blob, ...(name && { name }) });
  return engine;
}

/** Runs an action on a text capture and returns every result, decoded. */
async function runAll(
  text: string,
  mime: string,
  kind: string,
  actionId: string,
  params: unknown = {},
  name?: string,
) {
  const engine = await engineWith(text, mime, name);
  const out = await engine.runAction('en-1', kind, actionId, params);
  return out.map(o => ({ name: o.name, mime: o.mime, text: td.decode(o.bytes) }));
}

async function runOne(...args: Parameters<typeof runAll>) {
  const [first, ...rest] = await runAll(...args);
  if (!first || rest.length) throw new Error('expected exactly one result');
  return first;
}

describe('HTML parser', () => {
  it('repairs implied end tags and keeps raw text', () => {
    const root = parseHtml(
      '<ul><li>one<li>two<ul><li>a</ul></ul><p>x<p>y<script>if (a<b) {}</script>&amp;&copy;&#x41;',
    );
    expect(serialize(root)).toBe(
      '<ul><li>one</li><li>two<ul><li>a</li></ul></li></ul><p>x</p><p>y<script>if (a<b) {}</script>&amp;©A</p>',
    );
  });

  it('treats quoted > in attributes and stray < as text', () => {
    expect(serialize(parseHtml('<a title="a>b" href=x>1 < 2</a>'))).toBe(
      '<a title="a>b" href="x">1 &lt; 2</a>',
    );
  });
});

describe('HTML → Markdown', () => {
  it('converts headings, emphasis, links, images, code and breaks', () => {
    expect(
      htmlToMarkdown(
        '<h1>Title</h1><p>Some <strong>bold</strong> and <em>soft</em> text with ' +
          '<a href="https://x.test/a b" title="T">a link</a>.<br>Next line ' +
          '<code>a`b</code></p><img src="i.png" alt="pic"><hr><script>alert(1)</script>',
      ),
    ).toBe(
      '# Title\n\n' +
        'Some **bold** and *soft* text with [a link](<https://x.test/a b> "T").\\\n' +
        'Next line ``a`b``\n\n![pic](i.png)\n\n---\n',
    );
  });

  it('nests lists, keeps start numbers, and fences code with its language', () => {
    expect(
      htmlToMarkdown(
        '<ul><li>one<ul><li>inner</li></ul></li><li>two</li></ul>' +
          '<ol start="3"><li>three</li><li>four</li></ol>' +
          '<pre><code class="language-js">const a = 1;\n\nlet b = `x`;\n</code></pre>' +
          '<blockquote><p>quoted</p><p>more</p></blockquote>',
      ),
    ).toBe(
      '- one\n  - inner\n- two\n\n3. three\n4. four\n\n' +
        '```js\nconst a = 1;\n\nlet b = `x`;\n```\n\n> quoted\n>\n> more\n',
    );
  });

  it('writes GFM tables with escaped pipes and spans filled', () => {
    expect(
      htmlToMarkdown(
        '<table><thead><tr><th>A</th><th>B</th></tr></thead>' +
          '<tbody><tr><td colspan="2">wide | cell</td></tr><tr><td>1</td></tr></tbody></table>',
      ),
    ).toBe('| A | B |\n| --- | --- |\n| wide \\| cell |  |\n| 1 |  |\n');
  });

  it('escapes Markdown syntax in text', () => {
    expect(htmlToMarkdown('<p># not a heading</p><p>2. not a list, *a* [b]</p>')).toBe(
      '\\# not a heading\n\n2\\. not a list, \\*a\\* \\[b\\]\n',
    );
  });
});

describe('HTML → text', () => {
  it('puts blocks on their own lines and optionally shows URLs', () => {
    const html =
      '<div><h2>Head</h2><p>Para <a href="https://x.test">link</a> one</p>' +
      '<ul><li>a</li><li>b</li></ul><table><tr><td>1</td><td>2</td></tr></table></div>';
    expect(htmlToText(html)).toBe('Head\n\nPara link one\n\n- a\n- b\n\n1\t2\n');
    expect(htmlToText(html, true)).toContain('Para link (https://x.test) one');
  });
});

describe('sanitising', () => {
  it('drops scripts, handlers and unsafe URLs', () => {
    const dirty =
      '<p onclick="x()">hi<script>alert(1)</script><a href="javascript:alert(1)">a</a>' +
      '<a href="java\tscript:x">b</a><a href="https://ok.test">c</a><img src="data:image/png;base64,AA" ' +
      'onerror="x"><iframe src="https://evil"></iframe><custom>kept text</custom></p>';
    expect(serialize(sanitiseTree(parseHtml(dirty)))).toBe(
      '<p>hi<a>a</a><a>b</a><a href="https://ok.test" rel="noopener noreferrer">c</a>' +
        '<img src="data:image/png;base64,AA">kept text</p>',
    );
  });
});

describe('HTML actions', () => {
  const page =
    '<html><head><base href="https://site.test/docs/"><title>T</title></head><body>' +
    '<p>See <a href="guide.html" title="The guide">the guide</a>, ' +
    '<a href="/top">top</a> and <a href="https://other.test/x">"other", site</a>.</p>' +
    '<table><tr><th>Name</th><th>Qty</th></tr><tr><td>Apple</td><td>3</td></tr></table>' +
    '<table><tr><td>only</td></tr></table></body></html>';

  it('converts to Markdown and plain text', async () => {
    const md = await runOne(page, 'text/html', 'html', 'html.toMarkdown', {}, 'page.html');
    expect(md).toMatchObject({ name: 'page.md', mime: 'text/markdown' });
    expect(md.text).toContain('See [the guide](guide.html "The guide"), [top](/top)');
    const text = await runOne(page, 'text/html', 'html', 'html.toText', { linkUrls: true });
    expect(text.text).toContain('See the guide (guide.html), top (/top) and');
  });

  it('extracts links as CSV, resolved against <base> or the setting', async () => {
    const out = await runOne(page, 'text/html', 'html', 'html.extractLinks');
    expect(out).toMatchObject({ name: 'links.csv', mime: 'text/csv' });
    expect(out.text).toBe(
      'text,href,title\r\n' +
        'the guide,https://site.test/docs/guide.html,The guide\r\n' +
        'top,https://site.test/top,\r\n' +
        '"""other"", site",https://other.test/x,\r\n',
    );
    const based = await runOne(page, 'text/html', 'html', 'html.extractLinks', {
      base: 'https://mirror.test/a/b',
    });
    expect(based.text).toContain('the guide,https://mirror.test/a/guide.html,The guide');
    // No base at all: as written
    const bare = await runOne(
      '<p><a href="x.html">x</a></p>',
      'text/html',
      'html',
      'html.extractLinks',
    );
    expect(bare.text).toBe('text,href,title\r\nx,x.html,\r\n');
  });

  it('extracts each table as a CSV, several as a collection', async () => {
    const out = await runAll(page, 'text/html', 'html', 'html.extractTables');
    expect(out).toEqual([
      { name: 'table-1.csv', mime: 'text/csv', text: 'Name,Qty\r\nApple,3\r\n' },
      { name: 'table-2.csv', mime: 'text/csv', text: 'only\r\n' },
    ]);
  });

  it('offers link and table extraction only when there are some', async () => {
    const engine = await engineWith('<p>plain <b>words</b></p>', 'text/html');
    const ids = await engine.actions('en-1', 'html');
    expect(ids).toContain('html.toMarkdown');
    expect(ids).not.toContain('html.extractLinks');
    expect(ids).not.toContain('html.extractTables');
  });
});

describe('Markdown actions', () => {
  const md = [
    '# Notes',
    '',
    'Read [the docs](https://docs.test/ "Docs") and [local](./a.md).',
    '',
    '<script>alert(1)</script><img src=x onerror="alert(1)">',
    '',
    '```python',
    'print("hi")',
    '```',
    '',
    '    indented code',
    '',
    '- item',
    '',
    '  ```',
    '  plain',
    '  ```',
    '',
    '| a | b |',
    '|---|---|',
    '| 1 | **2** |',
    '',
    '- [x] done',
    '- [ ] todo',
  ].join('\n');

  it('renders to sanitised HTML, or a full document', async () => {
    const out = await runOne(md, 'text/markdown', 'markdown', 'markdown.toHtml', {}, 'notes.md');
    expect(out).toMatchObject({ name: 'notes.html', mime: 'text/html' });
    expect(out.text).toContain('<h1>Notes</h1>');
    expect(out.text).not.toContain('script');
    expect(out.text).not.toContain('onerror');
    expect(out.text).toContain('<img src="x">');

    const raw = await runOne(md, 'text/markdown', 'markdown', 'markdown.toHtml', {
      sanitise: false,
    });
    expect(raw.text).toContain('<script>alert(1)</script>');

    const doc = await runOne(md, 'text/markdown', 'markdown', 'markdown.toHtml', {
      document: true,
    });
    expect(doc.text).toMatch(/^<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">/);
    expect(doc.text).toContain('<title>Notes</title>');
    const titled = await runOne(md, 'text/markdown', 'markdown', 'markdown.toHtml', {
      document: true,
      title: 'A & B',
    });
    expect(titled.text).toContain('<title>A &amp; B</title>');
  });

  it('converts to plain text', async () => {
    const out = await runOne(md, 'text/markdown', 'markdown', 'markdown.toText');
    expect(out.text).toContain('Notes\n\nRead the docs and local.\n\n');
    expect(out.text).toContain('[x] done\n- [ ] todo');
    expect(out.text).not.toContain('alert');
  });

  it('extracts links', async () => {
    const out = await runOne(md, 'text/markdown', 'markdown', 'markdown.extractLinks', {
      base: 'https://site.test/notes/',
    });
    expect(out.text).toBe(
      'text,href,title\r\nthe docs,https://docs.test/,Docs\r\nlocal,https://site.test/notes/a.md,\r\n',
    );
  });

  it('extracts code blocks with extensions from their language', async () => {
    const out = await runAll(md, 'text/markdown', 'markdown', 'markdown.extractCode');
    expect(out).toEqual([
      { name: 'code-1.py', mime: 'text/plain', text: 'print("hi")\n' },
      { name: 'code-2.txt', mime: 'text/plain', text: 'indented code\n' },
      { name: 'code-3.txt', mime: 'text/plain', text: 'plain\n' },
    ]);
  });

  it('extracts tables as CSV', async () => {
    const out = await runOne(md, 'text/markdown', 'markdown', 'markdown.extractTables');
    expect(out).toEqual({ name: 'table-1.csv', mime: 'text/csv', text: 'a,b\r\n1,2\r\n' });
  });
});
