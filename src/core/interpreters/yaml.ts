import { isAlias, isNode, parseAllDocuments, visit } from 'yaml';
import { createMemo } from '../content';
import { formatCount, plural } from '../format';
import { hasKind } from '../guards';
import { unsupportedSlice, type Interpreter } from '../interpreter';
import { jsonChildCount, jsonChildren } from '../jsonSlice';
import { jsonStats } from '../jsonStats';
import { tryParseJson } from './json';

interface YamlValue {
  kind: 'yaml';
  /** The single document's value, or an array of the documents' values. */
  root: unknown;
  documentCount: number;
  source: string;
  anchors: number;
  aliases: number;
}

type ParseResult =
  | { ok: true; root: unknown; documentCount: number; anchors: number; aliases: number }
  | { ok: false };

const isContainer = (v: unknown) => v !== null && typeof v === 'object';

const KEY_LINE = /^\s*(- +)?([A-Za-z_][\w.\-/ ]*|"[^"\n]*"|'[^'\n]*')\s*:(\s|$)/;
const LIST_LINE = /^\s*-(\s|$)/;
const COMMENT_LINE = /^\s*#/;
const DOC_MARKER = /^(---|\.\.\.)(\s|$)/;

/**
 * Cheap signal check before parsing: every top-level line (no indent) must look like YAML
 * structure (a key, a list item, a document marker or a comment), and there must be at least one.
 * Prose, CSV and `KEY=value` lines fail this. A bare `- item` list (e.g. Markdown) only counts
 * with a `---` marker or a YAML MIME type.
 */
function hasYamlSignals(text: string, yamlMime: boolean): boolean {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  if (lines.length < 2) return false;
  let structured = yamlMime;
  let signals = 0;
  let unstructured = 0;
  for (const line of lines) {
    if (COMMENT_LINE.test(line)) continue;
    const keyed = KEY_LINE.test(line) || DOC_MARKER.test(line);
    if (keyed) structured = true;
    if (keyed || LIST_LINE.test(line)) signals++;
    else if (!/^\s/.test(line)) unstructured++;
  }
  return structured && signals > 0 && unstructured === 0;
}

export const tryParseYaml = createMemo((c): ParseResult => {
  const text = c.text;
  if (text === null || tryParseJson(c).ok || !hasYamlSignals(text, /yaml/.test(c.mime))) {
    return { ok: false };
  }
  try {
    // `merge`: support `<<: *anchor` keys, common in CI and Compose files
    const docs = parseAllDocuments(text, { merge: true });
    if (!Array.isArray(docs) || docs.length === 0) return { ok: false };
    if (docs.some(d => d.errors.length > 0)) return { ok: false };
    const values: unknown[] = docs.map(d => d.toJS());
    const present = values.filter(v => v !== null && v !== undefined);
    if (present.length === 0 || !present.every(isContainer)) return { ok: false };
    let anchors = 0;
    let aliases = 0;
    for (const doc of docs) {
      visit(doc, (_key, node) => {
        if (isAlias(node)) aliases++;
        else if (isNode(node) && node.anchor) anchors++;
      });
    }
    return {
      ok: true,
      root: values.length === 1 ? values[0] : values,
      documentCount: values.length,
      anchors,
      aliases,
    };
  } catch {
    return { ok: false };
  }
});

export const yamlInterpreter: Interpreter<YamlValue> = {
  kind: 'yaml',
  isValue: (v): v is YamlValue => hasKind(v, 'yaml'),
  detect(c) {
    if (!tryParseYaml(c).ok) return 0;
    return /^\uFEFF?---/.test(c.text ?? '') || /yaml/.test(c.mime) ? 0.85 : 0.7;
  },
  parse(c) {
    const r = tryParseYaml(c);
    if (!r.ok) throw new Error('Not valid YAML');
    const { root, documentCount, anchors, aliases } = r;
    return { kind: 'yaml', root, documentCount, source: c.text ?? '', anchors, aliases };
  },
  label({ root, documentCount }) {
    if (documentCount > 1) return `YAML · ${formatCount(documentCount)} documents`;
    if (Array.isArray(root)) return `YAML · sequence · ${formatCount(root.length)}`;
    return `YAML · mapping · ${plural(jsonChildCount(root), 'key')}`;
  },
  summarise(v) {
    const { stats, schema } = jsonStats(v.root, new TextEncoder().encode(v.source).byteLength);
    stats.push(
      { label: 'Documents', value: formatCount(v.documentCount) },
      { label: 'Anchors', value: formatCount(v.anchors) },
      { label: 'Aliases', value: formatCount(v.aliases) },
      {
        label: 'Comment lines',
        value: formatCount(v.source.split(/\r?\n/).filter(l => COMMENT_LINE.test(l)).length),
      },
    );
    return { stats, schema, extent: jsonChildCount(v.root) };
  },
  slice({ root, source }, req) {
    if (req.type === 'children') return jsonChildren(root, req.path, req.from, req.to);
    if (req.type === 'json') return root;
    if (req.type === 'text') return source;
    return unsupportedSlice('yaml', req);
  },
  export: ({ source }) => ({ text: source }),
};
