/**
 * HTML → Markdown (GFM) and HTML → plain text over the tree from `dom.ts`. Both walk the same
 * structure: block elements become separate blocks (joined by blank lines), inline content is
 * collected into paragraphs with whitespace collapsed as a browser would.
 */
import { BLOCK_ELEMENTS, parseHtml, textContent, type HtmlElement, type HtmlNode } from './dom';

export interface ConvertOptions {
  mode: 'markdown' | 'text';
  /** Plain text only: write links as "text (url)". */
  linkUrls?: boolean;
}

/** Dropped with their content. */
const SKIP = new Set([
  'script',
  'style',
  'head',
  'title',
  'template',
  'noscript',
  'iframe',
  'object',
  'embed',
  'select',
  'option',
  'datalist',
  'button',
  'svg',
  'math',
  'canvas',
  'audio',
  'video',
  'map',
]);

/** Marks a hard line break until lines are trimmed, then becomes the mode's break. */
const BR = '\u0000';

const isBlock = (n: HtmlNode): n is HtmlElement =>
  n.type === 'element' && BLOCK_ELEMENTS.has(n.name);

const has = (e: HtmlElement, name: string) =>
  e.children.some(c => c.type === 'element' && c.name === name);

// --- Escaping (Markdown mode) ---

/** Escapes characters that read as inline Markdown syntax, as turndown does. */
export const escapeInline = (s: string) => s.replace(/([\\*_`[\]])/g, '\\$1');

/** Escapes what would start a block at the start of a paragraph line (`# `, `- `, `1. `…). */
const escapeLineStart = (line: string) =>
  line
    .replace(/^([-+])(\s|$)/, '\\$1$2')
    .replace(/^(=+|~~~)/, '\\$1')
    .replace(/^(#{1,6})(\s|$)/, '\\$1$2')
    .replace(/^>/, '\\>')
    .replace(/^(\d+)([.)])(\s|$)/, '$1\\$2$3');

/** Backticks enough to fence `code` (one more than its longest run, at least `min`). */
function fence(code: string, min: number, char = '`'): string {
  const runs = code.match(new RegExp(`${char}+`, 'g')) ?? [];
  const longest = Math.max(0, ...runs.map(r => r.length));
  return char.repeat(Math.max(min, longest + 1));
}

const urlOf = (s: string) => (/[\s()<>]/.test(s) ? `<${s.replace(/>/g, '%3E')}>` : s);

class Converter {
  constructor(private readonly opts: ConvertOptions) {}

  private get md() {
    return this.opts.mode === 'markdown';
  }

  /** Blocks of a container's children: inline runs become paragraphs. */
  blocks(nodes: HtmlNode[]): string[] {
    const out: string[] = [];
    let run: HtmlNode[] = [];
    const flush = () => {
      const p = this.paragraph(run);
      if (p) out.push(p);
      run = [];
    };
    for (const node of nodes) {
      if (node.type === 'element' && SKIP.has(node.name)) continue;
      if (isBlock(node) && node.type === 'element') {
        flush();
        out.push(...this.block(node));
      } else {
        run.push(node);
      }
    }
    flush();
    return out;
  }

  /** Inline nodes as one paragraph: whitespace collapsed, lines trimmed, breaks kept. */
  private paragraph(nodes: HtmlNode[]): string {
    const lines = nodes
      .map(n => this.inline(n))
      .join('')
      .replace(/[ \t\n\r\f]+/g, ' ')
      .split(BR)
      .map(line => line.trim());
    while (lines[0] === '') lines.shift();
    while (lines.at(-1) === '') lines.pop();
    if (!this.md) return lines.join('\n');
    // Hard breaks within a run of lines; two breaks in a row start a new paragraph
    return lines
      .map(escapeLineStart)
      .join('\n')
      .split(/\n{2,}/)
      .map(group => group.split('\n').join('\\\n'))
      .join('\n\n');
  }

  private block(e: HtmlElement): string[] {
    const md = this.md;
    switch (e.name) {
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6': {
        const text = this.paragraph(e.children).replace(/\\?\n/g, ' ');
        if (!text) return [];
        return [md ? `${'#'.repeat(Number(e.name[1]))} ${text}` : text];
      }
      case 'p':
        return this.blocks(e.children);
      case 'hr':
        return [md ? '---' : ''];
      case 'pre':
        return [this.pre(e)];
      case 'blockquote': {
        const inner = this.blocks(e.children).join('\n\n');
        if (!inner) return [];
        if (!md) return [inner];
        return [
          inner
            .split('\n')
            .map(l => (l ? `> ${l}` : '>'))
            .join('\n'),
        ];
      }
      case 'ul':
      case 'ol':
      case 'menu':
        return this.list(e);
      case 'li':
        // A stray item outside a list
        return this.list({ ...e, name: 'ul', children: [e] });
      case 'table':
        return this.table(e);
      case 'dl':
        return this.blocks(e.children);
      case 'dt':
        return md ? this.blocks(e.children).map(b => `**${b}**`) : this.blocks(e.children);
      case 'dd':
        return this.blocks(e.children).map(b => (md ? `: ${b}` : `  ${b}`));
      default:
        return this.blocks(e.children);
    }
  }

  private pre(e: HtmlElement): string {
    const code = textContent(e).replace(/^\n/, '').replace(/\n$/, '');
    if (!this.md) return code;
    const inner = e.children.find(
      (c): c is HtmlElement => c.type === 'element' && c.name === 'code',
    );
    const cls = `${e.attrs.class ?? ''} ${inner?.attrs.class ?? ''}`;
    const lang = /(?:^|\s)(?:language|lang)-([\w+#.-]+)/.exec(cls)?.[1] ?? '';
    const f = fence(code, 3);
    return `${f}${lang}\n${code}\n${f}`;
  }

  private list(e: HtmlElement): string[] {
    const ordered = e.name === 'ol';
    let n = Number.parseInt(e.attrs.start ?? '1', 10);
    if (!Number.isFinite(n)) n = 1;
    const items = e.children.filter(
      (c): c is HtmlElement => c.type === 'element' && c.name === 'li',
    );
    const loose = items.some(li => has(li, 'p'));
    const lines = items.map(li => {
      const marker = ordered ? `${n++}. ` : '- ';
      const blocks = this.blocks(li.children);
      const body = blocks.join(loose ? '\n\n' : '\n');
      const pad = ' '.repeat(marker.length);
      return (
        marker +
        body
          .split('\n')
          .map((l, i) => (i === 0 || l === '' ? l : pad + l))
          .join('\n')
      );
    });
    if (!lines.length) return [];
    return [lines.join(loose ? '\n\n' : '\n')];
  }

  private table(e: HtmlElement): string[] {
    const rows = tableRows(e).map(r => r.map(cell => this.cell(cell)));
    if (!rows.length) return [];
    if (!this.md) return [rows.map(r => r.join('\t')).join('\n')];
    const width = Math.max(...rows.map(r => r.length));
    const pad = (r: string[]) => [...r, ...Array<string>(width - r.length).fill('')];
    const line = (r: string[]) => `| ${pad(r).join(' | ')} |`;
    const [head = [], ...body] = rows;
    const caption = e.children.find(
      (c): c is HtmlElement => c.type === 'element' && c.name === 'caption',
    );
    const out = [line(head), line(Array<string>(width).fill('---')), ...body.map(line)].join('\n');
    const title = caption ? this.paragraph(caption.children) : '';
    return title ? [title, out] : [out];
  }

  private cell(cell: HtmlElement | null): string {
    if (!cell) return '';
    const text = this.blocks(cell.children).join(this.md ? '<br>' : ' ');
    return this.md
      ? text.replace(/\\\n|\n/g, '<br>').replace(/\|/g, '\\|')
      : text.replace(/\s+/g, ' ');
  }

  /** One inline node; block elements nested in inline ones read as spaces around them. */
  private inline(n: HtmlNode): string {
    if (n.type === 'text') return this.md ? escapeInline(n.text) : n.text;
    if (SKIP.has(n.name)) return '';
    const md = this.md;
    const inner = () => n.children.map(c => this.inline(c)).join('');
    const wrap = (mark: string) => {
      const text = inner();
      if (!md || !text.trim()) return text;
      // Markers must hug the text: move surrounding spaces outside them
      const [, lead = '', body = '', trail = ''] = /^(\s*)([\s\S]*?)(\s*)$/.exec(text) ?? [];
      return `${lead}${mark}${body}${mark}${trail}`;
    };
    switch (n.name) {
      case 'br':
        return BR;
      case 'em':
      case 'i':
      case 'cite':
      case 'dfn':
        return wrap('*');
      case 'strong':
      case 'b':
        return wrap('**');
      case 's':
      case 'del':
      case 'strike':
        return wrap('~~');
      case 'code':
      case 'kbd':
      case 'samp':
      case 'tt': {
        const code = textContent(n).replace(/\s+/g, ' ');
        if (!md || !code) return code;
        const f = fence(code, 1);
        const space = code.startsWith('`') || code.endsWith('`') ? ' ' : '';
        return `${f}${space}${code}${space}${f}`;
      }
      case 'a': {
        const text = inner();
        const href = n.attrs.href?.trim() ?? '';
        if (!href) return text;
        if (!md) {
          const label = text.replace(/\s+/g, ' ').trim();
          if (!this.opts.linkUrls || /^(#|javascript:)/i.test(href) || label === href) return text;
          return label ? `${text} (${href.replace(/^mailto:/i, '')})` : href;
        }
        const title = n.attrs.title ? ` "${n.attrs.title.replace(/"/g, '\\"')}"` : '';
        const label = text.trim() ? text : href;
        return `[${label}](${urlOf(href)}${title})`;
      }
      case 'img': {
        const alt = n.attrs.alt ?? '';
        if (!md) return alt;
        const src = n.attrs.src?.trim() ?? '';
        if (!src) return '';
        const title = n.attrs.title ? ` "${n.attrs.title.replace(/"/g, '\\"')}"` : '';
        return `![${escapeInline(alt)}](${urlOf(src)}${title})`;
      }
      case 'input':
        if (n.attrs.type?.toLowerCase() === 'checkbox')
          return 'checked' in n.attrs ? '[x] ' : '[ ] ';
        return '';
      case 'sup':
        return md ? `<sup>${inner()}</sup>` : inner();
      case 'sub':
        return md ? `<sub>${inner()}</sub>` : inner();
      default:
        if (isBlock(n)) return ` ${BR}${this.blocks(n.children).join(BR)}${BR} `;
        return inner();
    }
  }
}

/**
 * A table's cells row by row, its own rows only (not a nested table's). Spanned cells are
 * filled with null so columns stay aligned; a header row in `<thead>` comes first.
 */
export function tableRows(table: HtmlElement): (HtmlElement | null)[][] {
  const trs: HtmlElement[] = [];
  const collect = (e: HtmlElement) => {
    for (const c of e.children) {
      if (c.type !== 'element') continue;
      if (c.name === 'tr') trs.push(c);
      else if (c.name === 'thead' || c.name === 'tbody' || c.name === 'tfoot') collect(c);
    }
  };
  collect(table);
  // thead rows first, tfoot rows last, whatever the source order
  const section = (tr: HtmlElement) =>
    table.children.some(s => s.type === 'element' && s.name === 'thead' && s.children.includes(tr))
      ? 0
      : table.children.some(
            s => s.type === 'element' && s.name === 'tfoot' && s.children.includes(tr),
          )
        ? 2
        : 1;
  const ordered = trs
    .map((tr, i) => ({ tr, i, s: section(tr) }))
    .sort((a, b) => a.s - b.s || a.i - b.i);

  const rows: (HtmlElement | null)[][] = [];
  /** Columns still covered by a rowspan from above: column → rows left. */
  const pending = new Map<number, number>();
  for (const { tr } of ordered) {
    const row: (HtmlElement | null)[] = [];
    let col = 0;
    const skipSpanned = () => {
      for (let left = pending.get(col); left; left = pending.get(col)) {
        row.push(null);
        if (left === 1) pending.delete(col);
        else pending.set(col, left - 1);
        col++;
      }
    };
    for (const cell of tr.children) {
      if (cell.type !== 'element' || (cell.name !== 'td' && cell.name !== 'th')) continue;
      skipSpanned();
      const colspan = clampSpan(cell.attrs.colspan);
      const rowspan = clampSpan(cell.attrs.rowspan);
      for (let k = 0; k < colspan; k++) {
        row.push(k === 0 ? cell : null);
        if (rowspan > 1) pending.set(col, rowspan - 1);
        col++;
      }
    }
    skipSpanned();
    // Spans reaching past this row's last cell
    for (const [c, left] of [...pending]) {
      if (c < col) continue;
      while (row.length < c) row.push(null);
      row[c] = null;
      if (left === 1) pending.delete(c);
      else pending.set(c, left - 1);
    }
    rows.push(row);
  }
  return rows;
}

const clampSpan = (s: string | undefined) => {
  const n = Number.parseInt(s ?? '1', 10);
  return Number.isFinite(n) && n > 1 ? Math.min(n, 1000) : 1;
};

/** Converts a parsed tree. */
export function convertTree(root: HtmlElement, opts: ConvertOptions): string {
  const out = new Converter(opts)
    .blocks(root.children)
    .filter(b => b.trim() !== '')
    .join('\n\n');
  return out ? `${out}\n` : '';
}

export const htmlToMarkdown = (html: string) => convertTree(parseHtml(html), { mode: 'markdown' });

export const htmlToText = (html: string, linkUrls = false) =>
  convertTree(parseHtml(html), { mode: 'text', linkUrls });
