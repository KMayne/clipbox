import { formatBytes, formatCount, plural } from '../format';
import { unsupportedSlice, type Interpreter } from '../interpreter';
import { detectByHeuristic } from '../../modules/langdetect/heuristics';
import type { LanguageDetector } from '../../modules/langdetect/detector';
import type { Language } from '../../modules/langdetect/languages';
import { stripHtml } from './html';
import { tryParseJson } from './json';

interface TextValue {
  text: string;
  language?: Language & { confidence: number | null };
}

const linesCache = new WeakMap<TextValue, string[]>();

function linesOf(v: TextValue): string[] {
  let lines = linesCache.get(v);
  if (!lines) {
    lines = v.text.split(/\r?\n/);
    if (lines.length > 1 && lines.at(-1) === '') lines.pop();
    linesCache.set(v, lines);
  }
  return lines;
}

const isHtmlMime = (mime: string) => mime === 'text/html';

export const textInterpreter: Interpreter<TextValue> = {
  kind: 'text',
  requires: ['langdetect'],
  detect: c => (c.text === null ? 0 : isHtmlMime(c.mime) ? 0.25 : 0.3),
  async parse(c, ctx) {
    // Text stripped from HTML is prose; don't bother detecting a language
    if (isHtmlMime(c.mime)) return { text: stripHtml(c.text ?? '') };
    const text = c.text ?? '';
    // JSON is already parsed (memoised) for the json kind; no need for the model
    const heuristic: Language | null = tryParseJson(c).ok
      ? { monaco: 'json', name: 'JSON' }
      : detectByHeuristic(text);
    if (heuristic) return { text, language: { ...heuristic, confidence: null } };
    const detected = await (await ctx.service<LanguageDetector>('langdetect'))?.detect(text);
    return detected
      ? { text, language: { ...detected.language, confidence: detected.confidence } }
      : { text };
  },
  label: v => `${v.language?.name ?? 'Text'} · ${plural(linesOf(v).length, 'line')}`,
  summarise(v) {
    const lines = linesOf(v);
    const crlf = (v.text.match(/\r\n/g) ?? []).length;
    const lf = (v.text.match(/\n/g) ?? []).length - crlf;
    const endings = crlf && lf ? 'mixed' : crlf ? 'CRLF' : lf ? 'LF' : 'none';
    let longest = 0;
    let blank = 0;
    for (const l of lines) {
      longest = Math.max(longest, l.length);
      if (l.trim() === '') blank++;
    }
    const { language } = v;
    return {
      language: language?.monaco,
      stats: [
        ...(language
          ? [
              {
                label: 'Language',
                value:
                  language.confidence === null
                    ? `${language.name} (heuristic)`
                    : `${language.name} (${Math.round(language.confidence * 100)}%)`,
              },
            ]
          : []),
        { label: 'Bytes', value: formatBytes(new TextEncoder().encode(v.text).byteLength) },
        { label: 'Characters', value: formatCount(v.text.length) },
        { label: 'Lines', value: formatCount(lines.length) },
        { label: 'Blank lines', value: formatCount(blank) },
        { label: 'Words', value: formatCount(v.text.match(/\S+/g)?.length ?? 0) },
        { label: 'Line endings', value: endings },
        { label: 'Trailing newline', value: /\n$/.test(v.text) ? 'yes' : 'no' },
        { label: 'Longest line', value: `${formatCount(longest)} chars` },
      ],
      extent: lines.length,
    };
  },
  slice(v, req) {
    if (req.type === 'lines') return linesOf(v).slice(req.from, req.to);
    if (req.type === 'full') return v.text;
    return unsupportedSlice('text', req);
  },
  export: v => ({ text: v.text }),
};
