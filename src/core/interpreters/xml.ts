import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { createMemo } from '../content';
import { formatBytes, formatCount, plural } from '../format';
import { hasKind, isRecord } from '../guards';
import { unsupportedSlice, type Interpreter } from '../interpreter';
import { isHtmlFragment } from './html';
import { jsonChildCount, jsonChildren } from '../jsonSlice';
import { inferSchema } from '../schema';
import type { StatRow } from '../types';

interface XmlValue {
  kind: 'xml';
  tree: unknown;
  source: string;
}

const ATTR = '@_';
const TOP_TAGS = 20;

/** Text after any BOM/whitespace, if it starts like XML and isn't an HTML document. */
function xmlStart(text: string): string | null {
  const t = text.replace(/^\uFEFF/, '').trimStart();
  if (/^(<!doctype html|<html[\s>])/i.test(t)) return null;
  return /^(<\?xml[\s?]|<[A-Za-z_])/.test(t) ? t : null;
}

// `ignoreDeclaration`: the `<?xml …?>` prolog isn't content; its version and encoding go in stats
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: ATTR,
  ignoreDeclaration: true,
});

/** `version`/`encoding`/`standalone` from a leading `<?xml …?>` declaration. */
function xmlDeclaration(source: string): Map<string, string> {
  const decl = /^\uFEFF?\s*<\?xml\s([^?]*)\?>/.exec(source)?.[1] ?? '';
  return new Map(
    [...decl.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(m => [
      m[1] ?? '',
      m[2] ?? m[3] ?? '',
    ]),
  );
}

const DECLARATION_STATS: [string, string][] = [
  ['version', 'XML version'],
  ['encoding', 'Encoding'],
  ['standalone', 'Standalone'],
];

const tryParseXml = createMemo((c): { tree: unknown; prolog: boolean } | null => {
  if (c.text === null || /^text\/html\b/.test(c.mime)) return null;
  const t = xmlStart(c.text);
  if (t === null || XMLValidator.validate(t) !== true) return null;
  try {
    const tree: unknown = parser.parse(t);
    return { tree, prolog: t.startsWith('<?xml') };
  } catch {
    return null;
  }
});

export const xmlInterpreter: Interpreter<XmlValue> = {
  kind: 'xml',
  isValue: (v): v is XmlValue => hasKind(v, 'xml'),
  detect(c) {
    const r = tryParseXml(c);
    if (!r) return 0;
    if (c.magic === 'svg' || /^svg$/i.test(xmlStats(r.tree).root)) return 0.5;
    if (r.prolog || /^(application|text)\/xml\b/.test(c.mime)) return 0.85;
    // Well-formed HTML is also XML; keep XML on offer, below HTML
    return isHtmlFragment(c) ? 0.6 : 0.7;
  },
  parse(c) {
    const r = tryParseXml(c);
    if (!r) throw new Error('Not well-formed XML');
    return { kind: 'xml', tree: r.tree, source: c.text ?? '' };
  },
  label({ tree }) {
    const s = xmlStats(tree);
    return `XML · <${s.root}> · ${plural(s.elements, 'element')}`;
  },
  summarise({ tree, source }) {
    const s = xmlStats(tree);
    const tags = [...s.tags].sort((a, b) => b[1] - a[1]);
    const decl = xmlDeclaration(source);
    const stats: StatRow[] = [
      { label: 'Root element', value: `<${s.root}>` },
      ...DECLARATION_STATS.flatMap(([key, label]) => {
        const value = decl.get(key);
        return value === undefined ? [] : [{ label, value }];
      }),
      { label: 'Size', value: formatBytes(new TextEncoder().encode(source).byteLength) },
      { label: 'Elements', value: formatCount(s.elements) },
      { label: 'Max depth', value: String(s.depth) },
      { label: 'Attributes', value: formatCount(s.attributes) },
      {
        label: 'Namespaces',
        value: formatCount(s.namespaces.size),
        children: [...s.namespaces].map(([prefix, uri]) => ({ label: prefix, value: uri })),
      },
      {
        label: 'Distinct tags',
        value: formatCount(tags.length),
        children: tags
          .slice(0, TOP_TAGS)
          .map(([tag, n]) => ({ label: tag, value: formatCount(n) })),
      },
    ];
    return { stats, schema: inferSchema(tree), extent: jsonChildCount(tree) };
  },
  slice({ tree, source }, req) {
    if (req.type === 'children') return jsonChildren(tree, req.path, req.from, req.to);
    if (req.type === 'json') return tree;
    if (req.type === 'text') return source;
    return unsupportedSlice('xml', req);
  },
  export: ({ source }) => ({ text: source }),
};

interface XmlStats {
  root: string;
  elements: number;
  depth: number;
  attributes: number;
  /** Prefix ('(default)' for plain xmlns) → URI. */
  namespaces: Map<string, string>;
  tags: Map<string, number>;
}

const statsCache = new WeakMap<object, XmlStats>();

/** Walks a fast-xml-parser tree: element keys map to a value or an array of repeated siblings. */
export function xmlStats(tree: unknown): XmlStats {
  if (isRecord(tree)) {
    const hit = statsCache.get(tree);
    if (hit) return hit;
  }
  const s: XmlStats = {
    root: '',
    elements: 0,
    depth: 0,
    attributes: 0,
    namespaces: new Map(),
    tags: new Map(),
  };
  const stack: [unknown, number][] = [[tree, 0]];
  for (let item = stack.pop(); item; item = stack.pop()) {
    const [node, depth] = item;
    if (!isRecord(node)) continue;
    for (const [key, value] of Object.entries(node)) {
      if (key.startsWith(ATTR)) {
        s.attributes++;
        const ns = /^xmlns(?::(.+))?$/.exec(key.slice(ATTR.length));
        if (ns) s.namespaces.set(ns[1] ?? '(default)', String(value));
        continue;
      }
      if (key === '#text' || key.startsWith('?') || key.startsWith('!')) continue;
      if (depth === 0 && !s.root) s.root = key;
      for (const el of Array.isArray(value) ? value : [value]) {
        s.elements++;
        s.tags.set(key, (s.tags.get(key) ?? 0) + 1);
        s.depth = Math.max(s.depth, depth + 1);
        stack.push([el, depth + 1]);
      }
    }
  }
  if (isRecord(tree)) statsCache.set(tree, s);
  return s;
}
