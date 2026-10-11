import { createMemo } from '../content';
import { toCsv } from '../csv';
import { formatBytes, formatCount, formatPercent, plural } from '../format';
import { hasKind, isRecord } from '../guards';
import { unsupportedSlice, type Interpreter } from '../interpreter';
import { jsonChildCount, jsonChildren, jsonTypeOf } from '../jsonSlice';
import { describeSchema, inferSchema } from '../schema';
import type { StatRow } from '../types';

type ParseResult = { ok: true; value: unknown } | { ok: false };

/** Shared with the records interpreter so JSON is only parsed once per entry. */
export const tryParseJson = createMemo((c): ParseResult => {
  const t = c.text?.trimStart();
  if (!t || !/^[[{"\d-]|^(true|false|null)\b/.test(t)) return { ok: false };
  try {
    const value: unknown = JSON.parse(t);
    return { ok: true, value };
  } catch {
    return { ok: false };
  }
});

interface JsonValue {
  kind: 'json';
  json: unknown;
  bytes: number;
}

export const jsonInterpreter: Interpreter<JsonValue> = {
  kind: 'json',
  isValue: (v): v is JsonValue => hasKind(v, 'json'),
  detect(c) {
    const r = tryParseJson(c);
    if (!r.ok) return 0;
    const container = r.value !== null && typeof r.value === 'object';
    if (container) return 0.95;
    return /json/.test(c.mime) ? 0.6 : 0;
  },
  parse(c) {
    const r = tryParseJson(c);
    if (!r.ok) throw new Error('Not valid JSON');
    return { kind: 'json', json: r.value, bytes: c.size };
  },
  label({ json }) {
    const type = jsonTypeOf(json);
    if (type === 'array') return `JSON array · ${formatCount(jsonChildCount(json))}`;
    if (type === 'object') return `JSON object · ${plural(jsonChildCount(json), 'key')}`;
    return `JSON ${type}`;
  },
  summarise({ json, bytes }) {
    const schema = inferSchema(json);
    const type = jsonTypeOf(json);
    const stats: StatRow[] = [
      { label: 'Top-level type', value: type },
      { label: 'Size', value: formatBytes(bytes) },
    ];
    if (Array.isArray(json)) {
      stats.push({ label: 'Length', value: formatCount(json.length) });
      stats.push({ label: 'Element types', value: elementTypes(json) });
    }
    const objectSchema = schema.t === 'array' ? schema.of : schema;
    const fields = objectSchema.t === 'object' ? Object.entries(objectSchema.fields) : [];
    if (fields.length > 0) {
      stats.push({
        label: Array.isArray(json) ? 'Element keys' : 'Keys',
        value: formatCount(fields.length),
        children: fields.map(([k, f]) => ({
          label: k,
          value: `${describeSchema(f.schema)} · ${formatPercent(f.presence)}`,
        })),
      });
    }
    stats.push({ label: 'Max depth', value: String(maxDepth(json)) });
    return { stats, schema, extent: jsonChildCount(json) };
  },
  slice({ json }, req) {
    if (req.type === 'children') return jsonChildren(json, req.path, req.from, req.to);
    if (req.type === 'json') return json;
    return unsupportedSlice('json', req);
  },
  export: ({ json }) => ({ text: JSON.stringify(json, null, 2) }),
  derivations: ({ json }) => (objectArray(json) ? [{ id: 'csv', label: 'As CSV' }] : []),
  derive({ json }) {
    const rows = objectArray(json);
    if (!rows) throw new Error('Not an array of objects');
    return { mime: 'text/csv', bytes: new TextEncoder().encode(toCsv(rows)) };
  },
};

function objectArray(json: unknown): Record<string, unknown>[] | null {
  return Array.isArray(json) && json.length > 0 && json.every(isRecord) ? json : null;
}

function elementTypes(arr: unknown[]): string {
  const counts = new Map<string, number>();
  for (const v of arr) {
    const t = jsonTypeOf(v);
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `${t} ${formatCount(n)}`)
    .join(', ');
}

function maxDepth(root: unknown): number {
  let max = 0;
  const stack: [unknown, number][] = [[root, 0]];
  let visited = 0;
  for (let item = stack.pop(); item && visited++ < 1_000_000; item = stack.pop()) {
    const [v, d] = item;
    if (v === null || typeof v !== 'object') continue;
    max = Math.max(max, d + 1);
    for (const child of Object.values(v)) stack.push([child, d + 1]);
  }
  return max;
}
