/**
 * HTML → Markdown (GFM) and HTML → plain text over the tree from `dom.ts`. Both walk the same
 * structure: block elements become separate blocks (joined by blank lines), inline content is
 * collected into paragraphs with whitespace collapsed as a browser would. The walk is trampolined
 * (`core/trampoline.ts`), so deeply nested markup can't overflow the call stack.
 */
import { call, trampoline, type Step } from '../trampoline';
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
  const longest = runs.reduce((n, r) => Math.max(n, r.length), 0);
  return char.repeat(Math.max(min, longest + 1));
}

const urlOf = (s: string) => (/[\s()<>]/.test(s) ? `<${s.replace(/>/g, '%3E')}>` : s);

/**
 * Each method is a trampoline step. Recursion into child elements goes through `call` (in
 * `blocks` for block elements, `inlines` for inline ones), so every level of nesting is one frame
 * on the trampoline's stack; the other steps are plain `yield*` helpers.
 */
class Converter {
  constructor(private readonly opts: ConvertOptions) {}

  private get md() {
    return this.opts.mode === 'markdown';
  }

  /** Blocks of a container's children: inline runs become paragraphs. */
  *blocks(nodes: HtmlNode[]): Step<string[]> {
    const out: string[] = [];
    let run: HtmlNode[] = [];
    for (const node of nodes) {
      if (node.type === 'element' && SKIP.has(node.name)) continue;
      if (isBlock(node) && node.type === 'element') {
        if (run.length) {
          const p = yield* this.paragraph(run);
          if (p) out.push(p);
          run = [];
        }
        // Not out.push(...blocks): a container's blocks can be too many to spread
        for (const b of yield* call(this.block(node))) out.push(b);
      } else {
        run.push(node);
      }
    }
    if (run.length) {
      const p = yield* this.paragraph(run);
      if (p) out.push(p);
    }
    return out;
  }

  /** Inline nodes' text, concatenated. */
  private *inlines(nodes: HtmlNode[]): Step<string> {
    let text = '';
    for (const n of nodes) {
      if (n.type === 'text') text += this.md ? escapeInline(n.text) : n.text;
      else text += yield* call(this.inline(n));
    }
    return text;
  }

  /** Inline nodes as one paragraph: whitespace collapsed, lines trimmed, breaks kept. */
  private *paragraph(nodes: HtmlNode[]): Step<string> {
    const lines = (yield* this.inlines(nodes))
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

  private *block(e: HtmlElement): Step<string[]> {
    const md = this.md;
    switch (e.name) {
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6': {
        const text = (yield* this.paragraph(e.children)).replace(/\\?\n/g, ' ');
        if (!text) return [];
        return [md ? `${'#'.repeat(Number(e.name[1]))} ${text}` : text];
      }
      case 'p':
        return yield* this.blocks(e.children);
      case 'hr':
        return [md ? '---' : ''];
      case 'pre':
        return [this.pre(e)];
      case 'blockquote': {
        const inner = (yield* this.blocks(e.children)).join('\n\n');
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
        return yield* this.list(e);
      case 'li':
        // A stray item outside a list
        return yield* this.list({ ...e, name: 'ul', children: [e] });
      case 'table':
        return yield* this.table(e);
      case 'dt': {
        const blocks = yield* this.blocks(e.children);
        return md ? blocks.map(b => `**${b}**`) : blocks;
      }
      case 'dd':
        return (yield* this.blocks(e.children)).map(b => (md ? `: ${b}` : `  ${b}`));
      default:
        return yield* this.blocks(e.children);
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

  private *list(e: HtmlElement): Step<string[]> {
    const ordered = e.name === 'ol';
    let n = Number.parseInt(e.attrs.start ?? '1', 10);
    if (!Number.isFinite(n)) n = 1;
    const items = e.children.filter(
      (c): c is HtmlElement => c.type === 'element' && c.name === 'li',
    );
    const loose = items.some(li => has(li, 'p'));
    const lines: string[] = [];
    for (const li of items) {
      const marker = ordered ? `${n++}. ` : '- ';
      const blocks = yield* this.blocks(li.children);
      const body = blocks.join(loose ? '\n\n' : '\n');
      const pad = ' '.repeat(marker.length);
      lines.push(
        marker +
          body
            .split('\n')
            .map((l, i) => (i === 0 || l === '' ? l : pad + l))
            .join('\n'),
      );
    }
    if (!lines.length) return [];
    return [lines.join(loose ? '\n\n' : '\n')];
  }

  private *table(e: HtmlElement): Step<string[]> {
    const rows: string[][] = [];
    for (const cells of tableRows(e)) {
      const row: string[] = [];
      for (const cell of cells) row.push(yield* this.cell(cell));
      rows.push(row);
    }
    if (!rows.length) return [];
    if (!this.md) return [rows.map(r => r.join('\t')).join('\n')];
    // Not Math.max(...rows): big tables overflow the call stack
    const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
    const pad = (r: string[]) => [...r, ...Array<string>(width - r.length).fill('')];
    const line = (r: string[]) => `| ${pad(r).join(' | ')} |`;
    const [head = [], ...body] = rows;
    const caption = e.children.find(
      (c): c is HtmlElement => c.type === 'element' && c.name === 'caption',
    );
    const out = [line(head), line(Array<string>(width).fill('---')), ...body.map(line)].join('\n');
    const title = caption ? yield* this.paragraph(caption.children) : '';
    return title ? [title, out] : [out];
  }

  private *cell(cell: HtmlElement | null): Step<string> {
    if (!cell) return '';
    const text = (yield* this.blocks(cell.children)).join(this.md ? '<br>' : ' ');
    return this.md
      ? text.replace(/\\\n|\n/g, '<br>').replace(/\|/g, '\\|')
      : text.replace(/\s+/g, ' ');
  }

  /** One inline node; block elements nested in inline ones read as spaces around them. */
  private *inline(n: HtmlNode): Step<string> {
    if (n.type === 'text') return this.md ? escapeInline(n.text) : n.text;
    if (SKIP.has(n.name)) return '';
    const md = this.md;
    const inner = () => this.inlines(n.children);
    const wrap = (text: string, mark: string) => {
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
        return wrap(yield* inner(), '*');
      case 'strong':
      case 'b':
        return wrap(yield* inner(), '**');
      case 's':
      case 'del':
      case 'strike':
        return wrap(yield* inner(), '~~');
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
        const text = yield* inner();
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
        return md ? `<sup>${yield* inner()}</sup>` : yield* inner();
      case 'sub':
        return md ? `<sub>${yield* inner()}</sub>` : yield* inner();
      default:
        if (isBlock(n)) return ` ${BR}${(yield* this.blocks(n.children)).join(BR)}${BR} `;
        return yield* inner();
    }
  }
}

/**
 * A table's cells row by row, its own rows only (not a nested table's). Spanned cells are
 * filled with null so columns stay aligned; a header row in `<thead>` comes first.
 */
export function tableRows(table: HtmlElement): (HtmlElement | null)[][] {
  // thead rows first, tfoot rows last, whatever the source order. Rows are bucketed as they're
  // found: looking each one up in its section's children would be quadratic on big tables.
  const sections: HtmlElement[][] = [[], [], []];
  const sectionOf = (name: string) => (name === 'thead' ? 0 : name === 'tfoot' ? 2 : 1);
  // An explicit stack: sections nested in sections (stray markup) can't overflow it
  const todo: { e: HtmlElement; section: number }[] = [];
  const pushChildren = (e: HtmlElement, section: number) => {
    for (let i = e.children.length - 1; i >= 0; i--) {
      const c = e.children[i];
      if (c?.type === 'element') todo.push({ e: c, section });
    }
  };
  pushChildren(table, 1);
  for (let item = todo.pop(); item; item = todo.pop()) {
    const { e, section } = item;
    if (e.name === 'tr') sections[section]?.push(e);
    else if (e.name === 'thead' || e.name === 'tbody' || e.name === 'tfoot')
      pushChildren(e, table.children.includes(e) ? sectionOf(e.name) : 1);
  }
  const ordered = sections.flat().map(tr => ({ tr }));

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
  const out = trampoline(new Converter(opts).blocks(root.children))
    .filter(b => b.trim() !== '')
    .join('\n\n');
  return out ? `${out}\n` : '';
}

export const htmlToMarkdown = (html: string) => convertTree(parseHtml(html), { mode: 'markdown' });

export const htmlToText = (html: string, linkUrls = false) =>
  convertTree(parseHtml(html), { mode: 'text', linkUrls });
