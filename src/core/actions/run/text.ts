import { decodeBase64, printableText } from '../../base64';
import { toBase64 } from '../../format';
import { decodeEntities, encodeEntities } from '../../htmlEntities';
import { textInterpreter } from '../../interpreters/text';
import type { DerivedContent } from '../../types';
import {
  textChangeCase,
  textDecode,
  textDedupe,
  textEncode,
  textRemoveBlank,
  textReplace,
  textReverse,
  textSortLines,
  textSplitLines,
  textTrim,
} from '../catalog/text';
import { implement } from '../types';
import { joinLines, splitLines, textResult } from './util';

const value = textInterpreter.isValue;

type Case = 'upper' | 'lower' | 'title' | 'camel' | 'snake' | 'kebab';

/** Words of an identifier or phrase: splits on non-alphanumerics and camelCase humps. */
const words = (s: string) =>
  s
    .replace(/([\p{Ll}\d])(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

const capitalise = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();

/** Identifier cases convert each line on its own, so a list of names converts name by name. */
function convertLine(line: string, to: 'camel' | 'snake' | 'kebab'): string {
  const lead = /^\s*/.exec(line)?.[0] ?? '';
  const ws = words(line).map(w => w.toLowerCase());
  if (ws.length === 0) return line;
  if (to === 'camel') return lead + ws.map((w, i) => (i === 0 ? w : capitalise(w))).join('');
  return lead + ws.join(to === 'snake' ? '_' : '-');
}

export function changeCase(text: string, to: Case): string {
  switch (to) {
    case 'upper':
      return text.toUpperCase();
    case 'lower':
      return text.toLowerCase();
    case 'title':
      return text.replace(/[\p{L}\p{N}]+(['’][\p{L}]+)?/gu, capitalise);
    default: {
      const { lines, trailingNewline } = splitLines(text);
      return joinLines(
        lines.map(l => convertLine(l, to)),
        trailingNewline,
      );
    }
  }
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const textImpls = [
  implement(textChangeCase, {
    value,
    run: ({ value }, { to }) => textResult(changeCase(value.text, to)),
  }),
  implement(textSortLines, {
    value,
    run({ value }, { order, unique }) {
      const { lines, trailingNewline } = splitLines(value.text);
      let sorted = [...lines].sort(
        (a, b) => collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0),
      );
      if (order === 'desc') sorted.reverse();
      if (unique) sorted = [...new Set(sorted)];
      return textResult(joinLines(sorted, trailingNewline));
    },
  }),
  implement(textReplace, {
    value,
    run({ value }, { find, replace, regex }) {
      if (find === '') throw new Error('Enter something to find');
      let pattern: RegExp;
      try {
        pattern = new RegExp(regex ? find : escapeRegExp(find), 'gu');
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(`Invalid regular expression: ${reason}`, { cause: err });
      }
      // Literal mode: `$` in the replacement is literal too
      const out = regex
        ? value.text.replace(pattern, replace)
        : value.text.replace(pattern, () => replace);
      return textResult(out);
    },
  }),
  implement(textTrim, {
    value,
    run({ value }, { side, scope }) {
      const trim = (s: string) =>
        side === 'both' ? s.trim() : side === 'start' ? s.trimStart() : s.trimEnd();
      if (scope === 'whole') return textResult(trim(value.text));
      const { lines, trailingNewline } = splitLines(value.text);
      return textResult(joinLines(lines.map(trim), trailingNewline));
    },
  }),
  implement(textRemoveBlank, {
    value,
    run({ value }, { whitespace }) {
      const { lines, trailingNewline } = splitLines(value.text);
      const kept = lines.filter(l => (whitespace ? l.trim() !== '' : l !== ''));
      return textResult(joinLines(kept, trailingNewline && kept.length > 0));
    },
  }),
  implement(textDedupe, {
    value,
    run({ value }, { ignoreCase }) {
      const { lines, trailingNewline } = splitLines(value.text);
      const seen = new Set<string>();
      const kept = lines.filter(l => {
        const key = ignoreCase ? l.toLowerCase() : l;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      return textResult(joinLines(kept, trailingNewline));
    },
  }),
  implement(textReverse, {
    value,
    run({ value }) {
      const { lines, trailingNewline } = splitLines(value.text);
      return textResult(joinLines(lines.reverse(), trailingNewline));
    },
  }),
  implement(textEncode, {
    value,
    run: ({ value }, { format, nonAscii, quotes }) =>
      textResult(encodeText(value.text, format, { nonAscii, quotes })),
  }),
  implement(textDecode, {
    value,
    run: ({ value }, { format }) => decodeText(value.text, format),
  }),
  implement(textSplitLines, {
    value,
    run({ value }, { trim, skipEmpty }) {
      let { lines } = splitLines(value.text);
      if (trim) lines = lines.map(l => l.trim());
      if (skipEmpty) lines = lines.filter(l => l !== '');
      return textResult(JSON.stringify(lines, null, 2), 'application/json', 'lines.json');
    },
  }),
];

type Codec = 'base64' | 'base64url' | 'component' | 'uri' | 'html' | 'json';

/** JSON string contents: `JSON.stringify` escapes, optionally with `\uXXXX` for non-ASCII. */
function jsonEscape(text: string, nonAscii: boolean): string {
  const quoted = JSON.stringify(text);
  return nonAscii
    ? quoted.replace(/[^\x00-\x7f]/g, ch => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`) // eslint-disable-line no-control-regex
    : quoted;
}

export function encodeText(
  text: string,
  format: Codec,
  { nonAscii = false, quotes = false } = {},
): string {
  switch (format) {
    case 'base64':
    case 'base64url': {
      const b64 = toBase64(new TextEncoder().encode(text));
      return format === 'base64'
        ? b64
        : b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    case 'component':
      return encodeURIComponent(text);
    case 'uri':
      return encodeURI(text);
    case 'html':
      return encodeEntities(text, nonAscii);
    case 'json': {
      const quoted = jsonEscape(text, nonAscii);
      return quotes ? quoted : quoted.slice(1, -1);
    }
  }
}

/** Decodes `text`; base64 may decode to bytes, which are returned as binary if not text. */
export function decodeText(text: string, format: Codec): DerivedContent {
  switch (format) {
    case 'base64':
    case 'base64url': {
      const bytes = decodeBase64(text.replace(/\s+/g, ''));
      if (!bytes) throw new Error('Not valid base64');
      if (bytes.length === 0) return textResult('');
      return printableText(bytes) === null
        ? { mime: 'application/octet-stream', bytes }
        : { mime: 'text/plain', bytes };
    }
    case 'component':
    case 'uri':
      try {
        // A form-encoded `+` is a space only in component mode (query strings)
        return textResult(
          format === 'component' ? decodeURIComponent(text.replace(/\+/g, ' ')) : decodeURI(text),
        );
      } catch (err) {
        throw new Error('Malformed percent-encoding', { cause: err });
      }
    case 'html':
      return textResult(decodeEntities(text));
    case 'json': {
      const t = text.trim();
      const quoted = t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t : `"${t}"`;
      let out: unknown;
      try {
        out = JSON.parse(quoted);
      } catch (err) {
        throw new Error(
          'Not a valid JSON string (raw line breaks and lone quotes must be escaped)',
          {
            cause: err,
          },
        );
      }
      if (typeof out !== 'string') throw new Error('Not a JSON string');
      return textResult(out);
    }
  }
}
