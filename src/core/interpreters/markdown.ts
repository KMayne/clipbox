import { Marked, type Token } from 'marked';
import { createMemo, type EntryContent } from '../content';
import { formatCount, plural } from '../format';
import { hasKind } from '../guards';
import { unsupportedSlice, type Interpreter } from '../interpreter';
import type { StatRow } from '../types';
import { tryParseJson } from './json';

export interface OutlineItem {
  level: number;
  text: string;
}

export interface MarkdownValue {
  kind: 'markdown';
  source: string;
  html: string;
  outline: OutlineItem[];
}

/** Only the start of large documents is scanned for signals. */
const DETECT_CHARS = 64 * 1024;
const WORDS_PER_MINUTE = 200;

type Signal = 'heading' | 'list' | 'task' | 'fence' | 'link' | 'emphasis' | 'table' | 'quote';

const LINE_SIGNALS: [Signal, RegExp][] = [
  ['heading', /^ {0,3}#{1,6}[ \t]+\S/],
  ['task', /^ {0,3}[-*+][ \t]+\[[ xX]\][ \t]/],
  ['list', /^ {0,3}([-*+]|\d{1,9}[.)])[ \t]+\S/],
  ['table', /^ {0,3}\|?[ \t]*:?-{3,}:?[ \t]*(\|[ \t]*:?-{3,}:?[ \t]*)+\|?[ \t]*$/],
  ['quote', /^ {0,3}>[ \t]?\S/],
];
const INLINE_SIGNALS: [Signal, RegExp][] = [
  ['link', /!?\[[^\]\n]+\]\([^)\s]+(?:[ \t]+"[^"\n]*")?\)/],
  ['emphasis', /\*\*[^*\s](?:[^*\n]*[^*\s])?\*\*/],
];
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
/** `key: value` / `key:` lines: YAML, headers, config. Not Markdown on their own. */
const KEY_VALUE = /^\s*-?\s*["']?[\w.-]+["']?\s*:(\s|$)/;
/** Lines that look like source code rather than prose. */
const CODE_LINE =
  /[;{}]\s*$|^\s*(import|export|from|def|class|function|const|let|var|return|if|elif|for|while|package|public|private|#include|using)\b/;

interface Signals {
  types: Set<Signal>;
  /** Lines (outside fenced code) carrying at least one signal. */
  signalLines: number;
  headings: number;
  /** Non-blank lines outside fenced code. */
  lines: number;
  keyValueLines: number;
  codeLines: number;
}

export function markdownSignals(text: string): Signals {
  const s: Signals = {
    types: new Set(),
    signalLines: 0,
    headings: 0,
    lines: 0,
    keyValueLines: 0,
    codeLines: 0,
  };
  let fence: string | null = null;
  for (const line of text.slice(0, DETECT_CHARS).split('\n')) {
    const marker = FENCE.exec(line)?.[1];
    if (fence !== null) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      continue;
    }
    if (marker) {
      fence = marker;
      s.types.add('fence');
      s.signalLines++;
      continue;
    }
    if (line.trim() === '') continue;
    s.lines++;
    let signalled = false;
    for (const [signal, re] of LINE_SIGNALS) {
      if (!re.test(line)) continue;
      s.types.add(signal);
      signalled = true;
      if (signal === 'heading') s.headings++;
      break; // a task item is also a list item; count it once
    }
    for (const [signal, re] of INLINE_SIGNALS) {
      if (!re.test(line)) continue;
      s.types.add(signal);
      signalled = true;
    }
    if (signalled) s.signalLines++;
    if (KEY_VALUE.test(line)) s.keyValueLines++;
    if (CODE_LINE.test(line)) s.codeLines++;
  }
  return s;
}

const signalsOf = createMemo(c => (c.text === null ? null : markdownSignals(c.text)));

export function markdownConfidence(c: EntryContent): number {
  if (c.text === null || c.text.trim() === '') return 0;
  if (c.mime === 'text/markdown' || c.mime === 'text/x-markdown') return 0.9;
  if (tryParseJson(c).ok) return 0;
  const s = signalsOf(c);
  if (!s || s.lines === 0) return 0;
  const enough = s.types.size >= 2 || (s.headings >= 1 && s.signalLines >= 2);
  if (!enough) return 0;
  // YAML with `# comments` and `- items`, or code with `# comments`, isn't Markdown
  const prose = s.lines - s.signalLines;
  if (s.keyValueLines > 0 && s.keyValueLines >= prose * 0.5) return 0;
  if (s.codeLines >= s.lines * 0.3) return 0;
  const density = s.signalLines / Math.max(s.lines, 1);
  const score = Math.min(1, density * 1.5 + (s.types.size - 1) * 0.1);
  return 0.5 + 0.25 * score;
}

const marked = new Marked({ gfm: true });

/** Concatenated text of inline tokens, without Markdown syntax. */
function plainText(tokens: Token[] | undefined): string {
  if (!tokens) return '';
  return tokens
    .map(t => {
      if ('tokens' in t && Array.isArray(t.tokens)) return plainText(t.tokens);
      if (t.type === 'text' || t.type === 'codespan' || t.type === 'escape') return t.text;
      return '';
    })
    .join('');
}

function outlineOf(tokens: Token[]): OutlineItem[] {
  const outline: OutlineItem[] = [];
  for (const t of tokens) {
    if (t.type === 'heading' && typeof t.depth === 'number') {
      outline.push({ level: t.depth, text: plainText(t.tokens).trim() });
    }
  }
  return outline;
}

interface MarkdownStats {
  words: number;
  links: { internal: number; external: number };
  images: number;
  codeBlocks: number;
  languages: Set<string>;
  tables: number;
  tasks: { done: number; total: number };
}

const EXTERNAL = /^([a-z][a-z\d+.-]*:|\/\/)/i;

export function markdownStats(source: string): MarkdownStats {
  const s: MarkdownStats = {
    words: 0,
    links: { internal: 0, external: 0 },
    images: 0,
    codeBlocks: 0,
    languages: new Set(),
    tables: 0,
    tasks: { done: 0, total: 0 },
  };
  marked.walkTokens(marked.lexer(source), t => {
    switch (t.type) {
      case 'text':
      case 'codespan':
        // Leaf text only; block-level text tokens repeat their children's text
        if (!('tokens' in t && Array.isArray(t.tokens) && t.tokens.length > 0)) {
          s.words += countWords(String(t.text));
        }
        break;
      case 'link':
        if (EXTERNAL.test(String(t.href))) s.links.external++;
        else s.links.internal++;
        break;
      case 'image':
        s.images++;
        break;
      case 'code':
        s.codeBlocks++;
        if (typeof t.lang === 'string' && t.lang.trim()) {
          s.languages.add(t.lang.trim().split(/\s/)[0] ?? '');
        }
        break;
      case 'table':
        s.tables++;
        break;
      case 'list_item':
        if (t.task === true) {
          s.tasks.total++;
          if (t.checked === true) s.tasks.done++;
        }
        break;
    }
  });
  return s;
}

const statsCache = new WeakMap<MarkdownValue, MarkdownStats>();

function statsOf(v: MarkdownValue): MarkdownStats {
  let s = statsCache.get(v);
  if (!s) {
    s = markdownStats(v.source);
    statsCache.set(v, s);
  }
  return s;
}

const countWords = (text: string) => text.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu)?.length ?? 0;

export const markdownInterpreter: Interpreter<MarkdownValue> = {
  kind: 'markdown',
  isValue: (v): v is MarkdownValue => hasKind(v, 'markdown'),
  detect: markdownConfidence,
  parse(c) {
    const source = c.text ?? '';
    const tokens = marked.lexer(source);
    const outline = outlineOf(tokens);
    const html = marked.parser(tokens);
    return { kind: 'markdown', source, html, outline };
  },
  label: v =>
    `Markdown · ${plural(v.outline.length, 'heading')} · ${plural(statsOf(v).words, 'word')}`,
  summarise(v) {
    const s = statsOf(v);
    const minutes = Math.max(1, Math.round(s.words / WORDS_PER_MINUTE));
    const links = s.links.internal + s.links.external;
    const stats: StatRow[] = [
      { label: 'Words', value: formatCount(s.words) },
      { label: 'Reading time', value: s.words === 0 ? '—' : `${minutes} min` },
      {
        label: 'Headings',
        value: formatCount(v.outline.length),
        children: v.outline.map(h => ({
          label: `${' '.repeat(h.level - 1)}${h.text || '(empty)'}`,
          value: `H${h.level}`,
        })),
      },
      {
        label: 'Links',
        value: formatCount(links),
        ...(links > 0 && {
          children: [
            { label: 'Internal / anchor', value: formatCount(s.links.internal) },
            { label: 'External', value: formatCount(s.links.external) },
          ],
        }),
      },
      { label: 'Images', value: formatCount(s.images) },
      {
        label: 'Code blocks',
        value:
          s.languages.size > 0
            ? `${formatCount(s.codeBlocks)} (${[...s.languages].sort().join(', ')})`
            : formatCount(s.codeBlocks),
      },
      { label: 'Tables', value: formatCount(s.tables) },
      {
        label: 'Tasks',
        value: s.tasks.total === 0 ? '0' : `${s.tasks.done}/${s.tasks.total} done`,
      },
    ];
    return { language: 'markdown', stats, extent: 0 };
  },
  slice(v, req) {
    if (req.type === 'text') return v.source;
    if (req.type === 'html') return v.html;
    return unsupportedSlice('markdown', req);
  },
  export: v => ({ text: v.source, html: v.html }),
};
