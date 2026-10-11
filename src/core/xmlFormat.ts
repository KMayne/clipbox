/**
 * Pretty-printing and minifying XML on its source text, so comments, CDATA, processing
 * instructions, the DOCTYPE and attribute order survive untouched. Input is expected to be
 * well-formed (the xml kind validates it first); stray text is passed through.
 */

type Node =
  | {
      t: 'element';
      start: number;
      end: number;
      open: string;
      close: string | null;
      preserve: boolean;
      children: Node[];
    }
  | { t: 'text'; raw: string }
  | { t: 'other'; raw: string; comment: boolean; cdata: boolean };

type Element = Extract<Node, { t: 'element' }>;

/** Index after the `>` ending a tag that starts at `i`, skipping quoted attribute values. */
function tagEnd(src: string, i: number): number {
  let quote = '';
  let depth = 0; // `[` … `]` in a DOCTYPE's internal subset
  for (let j = i + 1; j < src.length; j++) {
    const ch = src[j];
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '[') depth++;
    else if (ch === ']') depth--;
    else if (ch === '>' && depth <= 0) return j + 1;
  }
  return src.length;
}

function until(src: string, i: number, marker: string): number {
  const at = src.indexOf(marker, i);
  return at < 0 ? src.length : at + marker.length;
}

const SPACE_ATTR = /\sxml:space\s*=\s*(["'])(preserve|default)\1/;

/** Parses `src` into a forest of nodes, with an explicit stack (no recursion). */
function parse(src: string): Node[] {
  const root: Node[] = [];
  const stack: { el: Element | null; children: Node[] }[] = [{ el: null, children: root }];
  const top = () => stack[stack.length - 1] ?? { el: null, children: root };
  let i = 0;
  while (i < src.length) {
    if (src[i] !== '<') {
      const next = src.indexOf('<', i);
      const end = next < 0 ? src.length : next;
      top().children.push({ t: 'text', raw: src.slice(i, end) });
      i = end;
      continue;
    }
    let end: number;
    if (src.startsWith('<!--', i)) {
      end = until(src, i + 4, '-->');
      top().children.push({ t: 'other', raw: src.slice(i, end), comment: true, cdata: false });
    } else if (src.startsWith('<![CDATA[', i)) {
      end = until(src, i + 9, ']]>');
      top().children.push({ t: 'other', raw: src.slice(i, end), comment: false, cdata: true });
    } else if (src.startsWith('<?', i)) {
      end = until(src, i + 2, '?>');
      top().children.push({ t: 'other', raw: src.slice(i, end), comment: false, cdata: false });
    } else if (src.startsWith('<!', i)) {
      end = tagEnd(src, i);
      top().children.push({ t: 'other', raw: src.slice(i, end), comment: false, cdata: false });
    } else if (src.startsWith('</', i)) {
      end = tagEnd(src, i);
      const frame = stack.length > 1 ? stack.pop() : undefined;
      if (frame?.el) {
        frame.el.close = src.slice(i, end);
        frame.el.end = end;
      }
    } else {
      end = tagEnd(src, i);
      const open = src.slice(i, end);
      const parent = top().el;
      const space = SPACE_ATTR.exec(open)?.[2];
      const el: Element = {
        t: 'element',
        start: i,
        end,
        open,
        close: null,
        preserve: space ? space === 'preserve' : (parent?.preserve ?? false),
        children: [],
      };
      top().children.push(el);
      if (!open.endsWith('/>')) stack.push({ el, children: el.children });
    }
    i = end;
  }
  return root;
}

const blank = (n: Node) => n.t === 'text' && n.raw.trim() === '';
const textual = (n: Node) => n.t === 'text' || (n.t === 'other' && n.cdata);

export function formatXml(src: string, indentUnit: string): string {
  const out: string[] = [];
  const write = (nodes: Node[], depth: number) => {
    const pad = indentUnit.repeat(depth);
    for (const node of nodes) {
      if (node.t === 'text') {
        const t = node.raw.trim();
        if (t) out.push(pad + t);
      } else if (node.t === 'other') {
        out.push(pad + node.raw);
      } else if (node.preserve) {
        out.push(pad + src.slice(node.start, node.end));
      } else {
        const kids = node.children.filter(k => !blank(k));
        const close = node.close ?? '';
        if (kids.length === 0) {
          out.push(pad + node.open + close);
        } else if (kids.every(textual)) {
          // Text-only content stays inline and exactly as written
          out.push(
            pad +
              node.open +
              node.children.map(k => (k.t === 'element' ? '' : k.raw)).join('') +
              close,
          );
        } else if (kids.some(k => k.t === 'text')) {
          // Mixed content: whitespace may matter, so keep it verbatim
          out.push(pad + src.slice(node.start, node.end));
        } else {
          out.push(pad + node.open);
          write(kids, depth + 1);
          out.push(pad + close);
        }
      }
    }
  };
  write(parse(src.replace(/^\uFEFF/, '')), 0);
  return out.join('\n') + '\n';
}

/** Collapses whitespace inside a tag (outside quoted values), e.g. `<a  x="1" />` → `<a x="1"/>`. */
function tightenTag(tag: string): string {
  let out = '';
  let quote = '';
  let space = false;
  for (const ch of tag) {
    if (quote) {
      out += ch;
      if (ch === quote) quote = '';
      continue;
    }
    if (/\s/.test(ch)) {
      space = true;
      continue;
    }
    if (space && ch !== '/' && ch !== '>' && ch !== '=' && !out.endsWith('=')) out += ' ';
    space = false;
    if (ch === '"' || ch === "'") quote = ch;
    out += ch;
  }
  return out;
}

export function minifyXml(src: string, removeComments: boolean): string {
  let out = '';
  const write = (nodes: Node[], preserve: boolean) => {
    for (const node of nodes) {
      if (node.t === 'text') {
        if (preserve || !blank(node)) out += node.raw;
      } else if (node.t === 'other') {
        if (!(removeComments && node.comment)) out += node.raw;
      } else if (node.preserve) {
        out += tightenTag(node.open) + src.slice(node.start + node.open.length, node.end);
      } else {
        out += tightenTag(node.open);
        write(node.children, false);
        out += node.close === null ? '' : tightenTag(node.close);
      }
    }
  };
  write(parse(src.replace(/^\uFEFF/, '')), false);
  return out;
}
