import { describe, expect, it } from 'vitest';
import type { EntryContent } from '../../src/core/content';
import { defined } from '../../src/core/guards';
import type { InterpretContext } from '../../src/core/interpreter';
import { detectKinds, getInterpreter } from '../../src/core/interpreters';
import { textContent } from './helpers';

const kinds = (c: EntryContent) => detectKinds(c).map(d => d.kind);
const confidence = (c: EntryContent, kind: string) =>
  detectKinds(c).find(d => d.kind === kind)?.confidence ?? 0;
const noServices: InterpretContext = { service: async () => null };
const interpret = async (kind: string, c: EntryContent) => {
  const i = getInterpreter(kind);
  const v = await i.parse(c, noServices);
  return {
    label: i.label(v),
    ...(await i.summarise(v)),
    value: v,
    slice: (req: Parameters<typeof i.slice>[1]) => i.slice(v, req),
    exported: await i.export(v),
  };
};
const stat = (stats: { label: string; value: string }[], label: string) =>
  stats.find(s => s.label === label)?.value;

const README = `# Clipbox

Paste **anything** and inspect it. See [the docs](https://example.com/docs) or [usage](#usage).

## Usage

- Paste with Ctrl+V
- Drop a file

\`\`\`ts
const x = 1;
\`\`\`

\`\`\`sh
pnpm dev
\`\`\`

### Tasks

- [x] Paste intake
- [ ] Canvas

| a | b |
|---|---|
| 1 | 2 |

![logo](https://example.com/logo.png)
`;

describe('markdown detection', () => {
  it('detects a typical README above text', () => {
    const c = textContent(README);
    expect(kinds(c)[0]).toBe('markdown');
    expect(confidence(c, 'markdown')).toBeGreaterThanOrEqual(0.5);
    expect(confidence(c, 'markdown')).toBeLessThanOrEqual(0.75);
  });

  it('detects a heading plus one other signal', () => {
    expect(kinds(textContent('# Notes\n\nSome text with a [link](https://x.dev).'))).toContain(
      'markdown',
    );
  });

  it('trusts the text/markdown MIME type', () => {
    expect(confidence(textContent('just words', 'text/markdown'), 'markdown')).toBe(0.9);
  });

  it('needs two signals', () => {
    expect(kinds(textContent('Some prose with **one** emphasis.'))).not.toContain('markdown');
    expect(kinds(textContent('- one\n- two\n- three'))).not.toContain('markdown');
  });

  it('detects a note of bold `Label:` lines', () => {
    const note = '**Name:** Ada Lovelace\n**Role:** Engineer\n**Started:** 2024-01-02\n';
    expect(kinds(textContent(note))[0]).toBe('markdown');
  });

  it('leaves plain `Label: value` lines to YAML or text', () => {
    // No Markdown syntax at all: these lines are equally a YAML mapping, a header block or prose,
    // and render the same either way, so Markdown would add nothing.
    const yamlish = 'Name: Ada Lovelace\nRole: Engineer\nStarted: 2024-01-02\n';
    expect(kinds(textContent(yamlish))).toEqual(['yaml', 'text']);
    // A value with its own `: ` isn't valid YAML, so this is (correctly) just text
    const note = 'Meeting: Monday standup\nWhere: Room 4: the big one\nNotes: bring snacks\n';
    expect(kinds(textContent(note))).toEqual(['text']);
  });

  const TABLE =
    '| id | name | score |\n|---|---|---|\n' +
    Array.from({ length: 20 }, (_, i) => `| ${i} | name${i} | ${i * 3} |`).join('\n') +
    '\n';

  it.each([
    ['a heading', `# Scores\n\n${TABLE}`],
    ['a line of prose', `Scores from the last run, by person.\n\n${TABLE}`],
  ])('ranks a long pipe table with %s above records', (_, text) => {
    const c = textContent(text);
    expect(kinds(c)[0]).toBe('markdown');
    expect(kinds(c)).toContain('records');
  });

  it('leaves a bare pipe table to records, offering Markdown second', () => {
    expect(kinds(textContent(TABLE)).slice(0, 2)).toEqual(['records', 'markdown']);
  });

  it('does not claim JSON', () => {
    const json = JSON.stringify({ text: '# heading\n- [link](https://x.dev) **bold**' });
    expect(kinds(textContent(json))).not.toContain('markdown');
  });

  it('does not claim YAML', () => {
    const yaml = `# Service config
name: clipbox
version: 1
tags:
  - web
  - tools
# Ports
ports:
  - 5173
`;
    expect(kinds(textContent(yaml))).not.toContain('markdown');
  });

  it('does not claim prose', () => {
    const prose =
      'Dear team,\n\nThanks for the meeting today. I think we should ship on Friday.\n\nBest,\nKian';
    expect(kinds(textContent(prose))).not.toContain('markdown');
  });

  it('does not claim code with comments', () => {
    const python = `# Compute things
import os

# Main entry
def main():
    for f in os.listdir('.'):
        print(f)
    return 0
`;
    expect(kinds(textContent(python))).not.toContain('markdown');
    const js = `// util
export function f(a, b) {
  const x = a ** b;
  return x;
}
`;
    expect(kinds(textContent(js))).not.toContain('markdown');
  });
});

describe('markdown value', () => {
  it('renders HTML, builds an outline and summarises', async () => {
    const r = await interpret('markdown', textContent(README));
    expect(r.label).toMatch(/^Markdown · 3 headings · \d+ words$/);
    expect(r.value).toMatchObject({
      kind: 'markdown',
      outline: [
        { level: 1, text: 'Clipbox' },
        { level: 2, text: 'Usage' },
        { level: 3, text: 'Tasks' },
      ],
    });
    const html = await r.slice({ type: 'html' });
    expect(html).toContain('<h1');
    expect(html).toContain('<table>');
    expect(await r.slice({ type: 'text' })).toBe(README);
    expect(r.exported).toEqual({ text: README, html });

    expect(stat(r.stats, 'Headings')).toBe('3');
    const headings = defined(r.stats.find(s => s.label === 'Headings'));
    expect(headings.children?.map(c => c.value)).toEqual(['H1', 'H2', 'H3']);
    expect(stat(r.stats, 'Links')).toBe('2');
    const links = defined(r.stats.find(s => s.label === 'Links'));
    expect(links.children).toEqual([
      { label: 'Internal / anchor', value: '1' },
      { label: 'External', value: '1' },
    ]);
    expect(stat(r.stats, 'Images')).toBe('1');
    expect(stat(r.stats, 'Code blocks')).toBe('2 (sh, ts)');
    expect(stat(r.stats, 'Tables')).toBe('1');
    expect(stat(r.stats, 'Tasks')).toBe('1/2 done');
    expect(stat(r.stats, 'Reading time')).toBe('1 min');
    expect(r.language).toBe('markdown');
  });

  it('counts words and reading time', async () => {
    const words = Array.from({ length: 600 }, (_, i) => `word${i}`).join(' ');
    const r = await interpret('markdown', textContent(`# Title\n\n## Sub\n\n${words}`));
    expect(stat(r.stats, 'Words')).toBe('602');
    expect(stat(r.stats, 'Reading time')).toBe('3 min');
  });

  it('strips inline syntax from outline text', async () => {
    const r = await interpret('markdown', textContent('# Hello **bold** `code`\n\n- x\n'));
    expect(r.value).toMatchObject({ outline: [{ level: 1, text: 'Hello bold code' }] });
  });
});

const events = (n: number) =>
  Array.from({ length: n }, (_, i) => JSON.stringify({ id: i, type: i % 2 ? 'click' : 'view' }));

describe('ndjson', () => {
  it('detects NDJSON of objects with records offered', () => {
    const c = textContent(events(5).join('\n') + '\n');
    expect(kinds(c)).toEqual(['ndjson', 'records', 'text']);
    expect(confidence(c, 'ndjson')).toBe(0.9);
  });

  it('gives mixed values lower confidence and no records', () => {
    const c = textContent('{"a":1}\n[1,2]\n3\n');
    expect(confidence(c, 'ndjson')).toBe(0.7);
    expect(kinds(c)).not.toContain('records');
  });

  it('bumps confidence for NDJSON MIME types', () => {
    const c = textContent('{"a":1}\n[1,2]\n', 'application/x-ndjson');
    expect(confidence(c, 'ndjson')).toBeGreaterThan(0.7);
  });

  it('rejects valid JSON, single lines and prose', () => {
    expect(kinds(textContent('[\n{"a":1},\n{"a":2}\n]'))).not.toContain('ndjson');
    expect(kinds(textContent('{"a":1}\n'))).not.toContain('ndjson');
    expect(kinds(textContent('hello\nworld'))).not.toContain('ndjson');
    expect(kinds(textContent('{"a":1}\nnot json\n'))).not.toContain('ndjson');
  });

  it('summarises like a JSON array', async () => {
    const r = await interpret('ndjson', textContent(events(3).join('\n')));
    expect(r.label).toBe('NDJSON · 3 lines');
    expect(stat(r.stats, 'Length')).toBe('3');
    expect(stat(r.stats, 'Element types')).toBe('object 3');
    expect(stat(r.stats, 'Element keys')).toBe('2');
    expect(stat(r.stats, 'Invalid lines')).toBe('0');
    expect(r.extent).toBe(3);
    expect(r.schema?.t).toBe('array');
    expect(await r.slice({ type: 'children', path: [], from: 0, to: 2 })).toHaveLength(2);
    expect(r.exported.text).toBe(events(3).join('\n') + '\n');
  });

  it('reports a bad line beyond the detection window', async () => {
    const lines = events(250);
    lines[229] = '{"id": 229, broken';
    const c = textContent(lines.join('\n'));
    expect(kinds(c)[0]).toBe('ndjson');
    const r = await interpret('ndjson', c);
    expect(r.label).toBe('NDJSON · 249 lines');
    expect(stat(r.stats, 'Invalid lines')).toBe('1 (line 230)');
    // Invalid lines are skipped; the valid ones still make records
    const records = await interpret('records', c);
    expect(records.label).toBe('Records 249×2');
  });

  it('tolerates a few bad lines inside the detection window and reports them', async () => {
    const lines = events(30);
    lines[2] = '{"id": 2, broken';
    lines[17] = 'oops';
    const c = textContent(lines.join('\n'));
    expect(kinds(c)[0]).toBe('ndjson');
    const r = await interpret('ndjson', c);
    expect(r.label).toBe('NDJSON · 28 lines');
    expect(stat(r.stats, 'Invalid lines')).toBe('2 (lines 3, 18)');
  });

  it('rejects text where more than a tenth of lines are not JSON', () => {
    const lines = events(20);
    for (const i of [1, 5, 9]) lines[i] = 'not json';
    expect(kinds(textContent(lines.join('\n')))).not.toContain('ndjson');
    // Two lines, one bad: half of them
    expect(kinds(textContent('{"a":1}\n{"a":2\n'))).not.toContain('ndjson');
  });

  it('offers records with an NDJSON source', async () => {
    const r = await interpret('records', textContent(events(4).join('\n')));
    expect(r.label).toBe('Records 4×2');
    expect(stat(r.stats, 'Source')).toBe('NDJSON');
    expect(stat(r.stats, 'Header row')).toBeUndefined();
  });
});
