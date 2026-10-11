import { formatBytes, formatCount, plural } from '../format';
import { unsupportedSlice, type Interpreter } from '../interpreter';

interface HtmlValue {
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

export const htmlInterpreter: Interpreter<HtmlValue> = {
  kind: 'html',
  detect(c) {
    if (c.text === null) return 0;
    if (c.mime === 'text/html') return 0.9;
    return /^\s*(<!doctype html|<html[\s>])/i.test(c.text) ? 0.7 : 0;
  },
  parse: c => ({ html: c.text ?? '' }),
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
    if (req.type === 'full') return v.html;
    return unsupportedSlice('html', req);
  },
  export: v => ({ html: v.html, text: stripHtml(v.html) }),
};
