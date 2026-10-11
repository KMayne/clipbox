import { textInterpreter } from '../../interpreters/text';
import { textChangeCase, textReplace, textSortLines } from '../catalog/text';
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
];
