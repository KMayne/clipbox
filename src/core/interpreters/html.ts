import { createMemo } from '../content';
import { formatBytes, formatCount, plural } from '../format';
import { hasKind } from '../guards';
import { unsupportedSlice, type Interpreter } from '../interpreter';

interface HtmlValue {
  kind: 'html';
  html: string;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

// Regex-based because DOMParser is unavailable in workers; good enough for stats and plain text.
export function stripHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table|ul|ol|pre|blockquote)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const count = (html: string, re: RegExp) => html.match(re)?.length ?? 0;

/** HTML element names (SVG and MathML left out, so they stay images / XML). */
const HTML_TAGS = new Set(
  (
    'a abbr address area article aside audio b base bdi bdo blockquote body br button canvas ' +
    'caption cite code col colgroup data datalist dd del details dfn dialog div dl dt em embed ' +
    'fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 head header hgroup hr html i ' +
    'iframe img input ins kbd label legend li link main map mark menu meta meter nav noscript ' +
    'object ol optgroup option output p picture pre progress q rp rt ruby s samp script search ' +
    'section select slot small source span strong style sub summary sup table tbody td template ' +
    'textarea tfoot th thead time title tr track u ul var video wbr'
  ).split(' '),
);
const VOID_TAGS = new Set(
  'area base br col embed hr img input link meta source track wbr'.split(' '),
);
/** Tags that rarely appear as XML element names, unlike e.g. `title`, `link` or `a`. */
const DISTINCT_TAGS = new Set(
  (
    'article aside blockquote br button div em fieldset figure footer form h1 h2 h3 h4 h5 h6 ' +
    'header hr iframe img input li main nav ol p pre section select span strong table tbody td ' +
    'textarea th thead tr ul'
  ).split(' '),
);
const HTML_ATTR = /\s(class|style|href|src|alt|onclick|data-[\w-]+|aria-[\w-]+)\s*=/i;
const OPEN_TAG = /<([A-Za-z][\w:-]*)([^>]*)>/g;

/**
 * Whether markup without a doctype is HTML rather than XML: it starts and ends with a tag, every
 * element name is an HTML one, and something is distinctly HTML (a common HTML-only element, an
 * HTML attribute such as `class=`, or an unclosed void element like `<br>`). `<a><b/></a>` or an
 * RSS feed stay XML.
 */
export function looksLikeHtmlFragment(text: string): boolean {
  const t = text.replace(/^\uFEFF/, '').trim();
  if (!/^<[A-Za-z]/.test(t) || !t.endsWith('>')) return false;
  let tags = 0;
  let distinct = false;
  for (const [, rawName, attrs] of t.matchAll(OPEN_TAG)) {
    const name = rawName?.toLowerCase() ?? '';
    if (!HTML_TAGS.has(name)) return false;
    tags++;
    if (DISTINCT_TAGS.has(name) || HTML_ATTR.test(attrs ?? '')) distinct = true;
    if (VOID_TAGS.has(name) && !attrs?.trimEnd().endsWith('/')) distinct = true;
  }
  return tags > 0 && distinct;
}

/** Memoised `looksLikeHtmlFragment` for plain-text content (`text/html` is detected by MIME). */
export const isHtmlFragment = createMemo(
  c => c.text !== null && c.mime !== 'text/html' && looksLikeHtmlFragment(c.text),
);

export const htmlInterpreter: Interpreter<HtmlValue> = {
  kind: 'html',
  isValue: (v): v is HtmlValue => hasKind(v, 'html'),
  detect(c) {
    if (c.text === null) return 0;
    if (c.mime === 'text/html') return 0.9;
    if (/^\s*(<!doctype html|<html[\s>])/i.test(c.text)) return 0.7;
    // Above XML's 0.7, so a well-formed fragment like `<p class="x">hi</p>` reads as HTML
    return isHtmlFragment(c) ? 0.75 : 0;
  },
  parse: c => ({ kind: 'html', html: c.text ?? '' }),
  label: v => `HTML · ${plural(count(v.html, /<[a-z][\w-]*/gi), 'element')}`,
  summarise: v => ({
    stats: [
      { label: 'Bytes', value: formatBytes(new TextEncoder().encode(v.html).byteLength) },
      { label: 'Elements', value: formatCount(count(v.html, /<[a-z][\w-]*/gi)) },
      { label: 'Tables', value: formatCount(count(v.html, /<table[\s>]/gi)) },
      { label: 'Links', value: formatCount(count(v.html, /<a\s/gi)) },
      { label: 'Images', value: formatCount(count(v.html, /<img[\s>]/gi)) },
      { label: 'Text characters', value: formatCount(stripHtml(v.html).length) },
    ],
    extent: 0,
  }),
  slice(v, req) {
    if (req.type === 'text') return v.html;
    return unsupportedSlice('html', req);
  },
  export: v => ({ html: v.html, text: stripHtml(v.html) }),
};
