/**
 * A small, tolerant HTML parser for the worker (which has no DOMParser). It builds a plain tree
 * good enough for conversion and extraction: void and raw-text elements, implied end tags for
 * paragraphs, list items and table parts, and end tags that close whatever they match. It is not
 * the HTML5 tree-construction algorithm; misnested markup is repaired simply, never rejected.
 */

export interface HtmlElement {
  type: 'element';
  /** Lower case. */
  name: string;
  /** Lower-case names; in source order, first one wins. */
  attrs: Record<string, string>;
  children: HtmlNode[];
}

export interface HtmlText {
  type: 'text';
  /** Entity-decoded. */
  text: string;
}

export type HtmlNode = HtmlElement | HtmlText;

export const VOID_ELEMENTS = new Set(
  'area base br col embed hr img input link meta param source track wbr'.split(' '),
);
/** Content is text up to the matching end tag. */
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'noscript']);

/** Block-level elements: a start tag of one of these closes an open `<p>`. */
export const BLOCK_ELEMENTS = new Set(
  (
    'address article aside blockquote center details dialog dd div dl dt fieldset figcaption ' +
    'figure footer form h1 h2 h3 h4 h5 h6 header hgroup hr li main menu nav ol p pre section ' +
    'summary table tbody td tfoot th thead tr ul body html head caption colgroup'
  ).split(' '),
);

/** Start tags that close an open element of the same group (`<li>` closes `<li>`, etc). */
const IMPLIED_CLOSE: Record<string, string[]> = {
  li: ['li'],
  dt: ['dt', 'dd'],
  dd: ['dt', 'dd'],
  tr: ['tr', 'td', 'th'],
  td: ['td', 'th'],
  th: ['td', 'th'],
  thead: ['tbody', 'tfoot', 'tr', 'td', 'th'],
  tbody: ['thead', 'tbody', 'tfoot', 'tr', 'td', 'th'],
  tfoot: ['thead', 'tbody', 'tr', 'td', 'th'],
  option: ['option'],
  optgroup: ['optgroup', 'option'],
};
/** An implied close never reaches past these (a nested list's `<li>` keeps the outer one open). */
const SCOPE: Record<string, string[]> = {
  li: ['ul', 'ol', 'menu'],
  dt: ['dl'],
  dd: ['dl'],
  tr: ['table'],
  td: ['table', 'tr'],
  th: ['table', 'tr'],
  thead: ['table'],
  tbody: ['table'],
  tfoot: ['table'],
  option: ['select', 'datalist'],
  optgroup: ['select'],
};

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  ensp: '\u2002',
  emsp: '\u2003',
  thinsp: '\u2009',
  zwnj: '\u200c',
  zwj: '\u200d',
  shy: '\u00ad',
  copy: '©',
  reg: '®',
  trade: '™',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  sbquo: '‚',
  ldquo: '“',
  rdquo: '”',
  bdquo: '„',
  laquo: '«',
  raquo: '»',
  lsaquo: '‹',
  rsaquo: '›',
  bull: '•',
  middot: '·',
  para: '¶',
  sect: '§',
  deg: '°',
  plusmn: '±',
  times: '×',
  divide: '÷',
  micro: 'µ',
  cent: '¢',
  pound: '£',
  euro: '€',
  yen: '¥',
  curren: '¤',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
  sup1: '¹',
  sup2: '²',
  sup3: '³',
  iexcl: '¡',
  iquest: '¿',
  dagger: '†',
  Dagger: '‡',
  permil: '‰',
  prime: '′',
  Prime: '″',
  larr: '←',
  rarr: '→',
  uarr: '↑',
  darr: '↓',
  harr: '↔',
  lArr: '⇐',
  rArr: '⇒',
  hArr: '⇔',
  le: '≤',
  ge: '≥',
  ne: '≠',
  asymp: '≈',
  infin: '∞',
  minus: '−',
  check: '✓',
  hearts: '♥',
  star: '☆',
  Agrave: 'À',
  Aacute: 'Á',
  Acirc: 'Â',
  Atilde: 'Ã',
  Auml: 'Ä',
  Aring: 'Å',
  AElig: 'Æ',
  Ccedil: 'Ç',
  Egrave: 'È',
  Eacute: 'É',
  Ecirc: 'Ê',
  Euml: 'Ë',
  Igrave: 'Ì',
  Iacute: 'Í',
  Icirc: 'Î',
  Iuml: 'Ï',
  Ntilde: 'Ñ',
  Ograve: 'Ò',
  Oacute: 'Ó',
  Ocirc: 'Ô',
  Otilde: 'Õ',
  Ouml: 'Ö',
  Oslash: 'Ø',
  Ugrave: 'Ù',
  Uacute: 'Ú',
  Ucirc: 'Û',
  Uuml: 'Ü',
  Yacute: 'Ý',
  szlig: 'ß',
  agrave: 'à',
  aacute: 'á',
  acirc: 'â',
  atilde: 'ã',
  auml: 'ä',
  aring: 'å',
  aelig: 'æ',
  ccedil: 'ç',
  egrave: 'è',
  eacute: 'é',
  ecirc: 'ê',
  euml: 'ë',
  igrave: 'ì',
  iacute: 'í',
  icirc: 'î',
  iuml: 'ï',
  ntilde: 'ñ',
  ograve: 'ò',
  oacute: 'ó',
  ocirc: 'ô',
  otilde: 'õ',
  ouml: 'ö',
  oslash: 'ø',
  ugrave: 'ù',
  uacute: 'ú',
  ucirc: 'û',
  uuml: 'ü',
  yacute: 'ý',
  yuml: 'ÿ',
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  pi: 'π',
  sigma: 'σ',
  mu: 'μ',
  lambda: 'λ',
  omega: 'ω',
  Omega: 'Ω',
};

/** Decodes character references; unknown names are left as written. */
export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#[xX][\da-fA-F]+|#\d+|[A-Za-z][A-Za-z\d]*);?/g, (m, e: string) => {
    if (e[0] === '#') {
      const hex = e[1] === 'x' || e[1] === 'X';
      const code = hex ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return '\ufffd';
      return String.fromCodePoint(code);
    }
    // Named references need their semicolon, except the common legacy ones
    if (!m.endsWith(';') && !/^(amp|lt|gt|quot|nbsp|copy|reg)$/.test(e)) return m;
    return ENTITIES[e] ?? ENTITIES[e.toLowerCase()] ?? m;
  });
}

const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

function parseAttrs(src: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const [, name = '', dq, sq, bare] of src.matchAll(ATTR)) {
    const key = name.toLowerCase();
    if (key in attrs) continue;
    attrs[key] = decodeEntities(dq ?? sq ?? bare ?? '');
  }
  return attrs;
}

const element = (name: string, attrs: Record<string, string> = {}): HtmlElement => ({
  type: 'element',
  name,
  attrs,
  children: [],
});

const CLOSE_TAG = /<\/([A-Za-z][^\s/>]*)[^>]*>/y;
/** Quoted attribute values may contain `>`. */
const OPEN_TAG = /<([A-Za-z][^\s/>]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/y;

/** Parses a document or fragment into a root element named '#root'. */
export function parseHtml(html: string): HtmlElement {
  const root = element('#root');
  const stack: HtmlElement[] = [root];
  const top = () => stack[stack.length - 1] ?? root;
  const addText = (text: string) => {
    if (!text) return;
    const parent = top();
    const last = parent.children.at(-1);
    if (last?.type === 'text') last.text += text;
    else parent.children.push({ type: 'text', text });
  };
  /** Pops to (and including) the innermost open `name`, if it's open within `scope`. */
  const closeTo = (names: string[], scope: string[] = []) => {
    for (let i = stack.length - 1; i > 0; i--) {
      const open = stack[i]?.name ?? '';
      if (names.includes(open)) {
        stack.length = i;
        return true;
      }
      if (scope.includes(open)) return false;
    }
    return false;
  };

  let i = 0;
  const n = html.length;
  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      addText(decodeEntities(html.slice(i)));
      break;
    }
    if (lt > i) addText(decodeEntities(html.slice(i, lt)));
    i = lt;
    if (html.startsWith('<!--', i)) {
      const end = html.indexOf('-->', i + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (html.startsWith('<![CDATA[', i)) {
      const end = html.indexOf(']]>', i);
      addText(html.slice(i + 9, end === -1 ? n : end));
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (html[i + 1] === '!' || html[i + 1] === '?') {
      // Doctype or processing instruction
      const end = html.indexOf('>', i);
      i = end === -1 ? n : end + 1;
      continue;
    }
    CLOSE_TAG.lastIndex = i;
    const close = CLOSE_TAG.exec(html);
    if (close) {
      const name = (close[1] ?? '').toLowerCase();
      i += close[0].length;
      if (name === 'p' && !closeTo(['p'], ['button', ...BLOCK_SCOPE])) {
        // A stray </p> makes an empty paragraph, as browsers do
        top().children.push(element('p'));
      } else if (name !== 'p') {
        closeTo([name], name === 'li' ? ['ul', 'ol'] : []);
      }
      continue;
    }
    OPEN_TAG.lastIndex = i;
    const open = OPEN_TAG.exec(html);
    if (!open) {
      addText('<');
      i++;
      continue;
    }
    i += open[0].length;
    const name = (open[1] ?? '').toLowerCase();
    const rawAttrs = open[2] ?? '';
    const selfClosing = /\/\s*$/.test(rawAttrs);
    const el = element(name, parseAttrs(rawAttrs.replace(/\/\s*$/, '')));
    if (BLOCK_ELEMENTS.has(name)) closeTo(['p'], ['button', ...BLOCK_SCOPE]);
    const implied = IMPLIED_CLOSE[name];
    if (implied) closeTo(implied, SCOPE[name]);
    top().children.push(el);
    if (VOID_ELEMENTS.has(name) || selfClosing) continue;
    if (RAW_TEXT.has(name)) {
      const endTag = new RegExp(`</${name}[\\s/>]`, 'gi');
      endTag.lastIndex = i;
      const end = endTag.exec(html)?.index ?? -1;
      const body = html.slice(i, end === -1 ? n : end);
      if (body) {
        const text = name === 'textarea' || name === 'title' ? decodeEntities(body) : body;
        el.children.push({ type: 'text', text });
      }
      const gt = end === -1 ? -1 : html.indexOf('>', end);
      i = gt === -1 ? n : gt + 1;
      continue;
    }
    stack.push(el);
  }
  return root;
}

/** Containers a `<p>` doesn't close across (its end tag stays inside them). */
const BLOCK_SCOPE = ['td', 'th', 'li', 'blockquote', 'div', 'section', 'article', 'table'];

// --- Queries ---

export function* walk(node: HtmlNode): Generator<HtmlElement> {
  if (node.type !== 'element') return;
  yield node;
  for (const child of node.children) yield* walk(child);
}

export const findAll = (root: HtmlNode, name: string): HtmlElement[] =>
  [...walk(root)].filter(e => e.name === name);

/** Concatenated text, scripts and styles left out. */
export function textContent(node: HtmlNode): string {
  if (node.type === 'text') return node.text;
  if (node.name === 'script' || node.name === 'style' || node.name === 'template') return '';
  return node.children.map(textContent).join('');
}

/** Text with runs of whitespace collapsed to single spaces and trimmed. */
export const collapsedText = (node: HtmlNode) => textContent(node).replace(/\s+/g, ' ').trim();

/** The document's `<base href>`, if any. */
export const baseHref = (root: HtmlElement): string | null =>
  findAll(root, 'base').find(b => b.attrs.href)?.attrs.href ?? null;

// --- Serialising ---

const escapeText = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

export function serialize(node: HtmlNode): string {
  if (node.type === 'text') return escapeText(node.text);
  const inner = node.children
    .map(c =>
      c.type === 'text' && RAW_TEXT.has(node.name) && node.name !== 'textarea'
        ? c.text
        : serialize(c),
    )
    .join('');
  if (node.name === '#root') return inner;
  const attrs = Object.entries(node.attrs)
    .map(([k, v]) => (v === '' ? ` ${k}` : ` ${k}="${escapeAttr(v)}"`))
    .join('');
  if (VOID_ELEMENTS.has(node.name)) return `<${node.name}${attrs}>`;
  return `<${node.name}${attrs}>${inner}</${node.name}>`;
}
