import { createMemo } from '../content';
import { formatCount, plural } from '../format';
import { hasKind, isRecord } from '../guards';
import { unsupportedSlice, type Interpreter } from '../interpreter';
import { jsonChildren } from '../jsonSlice';
import { inferSchema } from '../schema';
import { arrayStats, maxDepth, tryParseJson } from './json';

/** Lines checked by detection; every non-empty one must parse. */
const DETECT_LINES = 200;
const SHOWN_INVALID = 5;
const NDJSON_MIME = /^application\/(x-ndjson|jsonl|x-jsonlines|jsonlines)\b/;

export interface NdjsonValue {
  kind: 'ndjson';
  items: unknown[];
  /** 1-based line numbers that failed to parse (only possible beyond the detection window). */
  invalidLines: number[];
}

interface NdjsonParse {
  items: unknown[];
  invalidLines: number[];
  allObjects: boolean;
}

/** Shared with the records interpreter so NDJSON is only parsed once per entry. */
export const tryParseNdjson = createMemo((c): NdjsonParse | null => {
  const text = c.text;
  if (!text) return null;
  const items: unknown[] = [];
  const invalidLines: number[] = [];
  let nonEmpty = 0;
  let containers = 0;
  let allObjects = true;
  for (const [i, raw] of text.split('\n').entries()) {
    const line = raw.trim();
    if (line === '') continue;
    nonEmpty++;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      if (nonEmpty <= DETECT_LINES) return null;
      invalidLines.push(i + 1);
      continue;
    }
    if (value !== null && typeof value === 'object') containers++;
    if (!isRecord(value)) allObjects = false;
    items.push(value);
  }
  // A column of bare numbers or words isn't worth calling NDJSON
  if (nonEmpty < 2 || containers === 0) return null;
  if (tryParseJson(c).ok) return null;
  return { items, invalidLines, allObjects };
});

export const ndjsonInterpreter: Interpreter<NdjsonValue> = {
  kind: 'ndjson',
  isValue: (v): v is NdjsonValue => hasKind(v, 'ndjson'),
  detect(c) {
    const r = tryParseNdjson(c);
    if (!r) return 0;
    const base = r.allObjects ? 0.9 : 0.7;
    return NDJSON_MIME.test(c.mime) ? Math.min(0.98, base + 0.08) : base;
  },
  parse(c) {
    const r = tryParseNdjson(c);
    if (!r) throw new Error('Not NDJSON');
    return { kind: 'ndjson', items: r.items, invalidLines: r.invalidLines };
  },
  label: v => `NDJSON · ${plural(v.items.length, 'line')}`,
  summarise(v) {
    const schema = inferSchema(v.items);
    return {
      stats: [
        ...arrayStats(v.items, schema),
        { label: 'Invalid lines', value: describeInvalid(v.invalidLines) },
        { label: 'Max depth', value: String(maxDepth(v.items) - 1) },
      ],
      schema,
      extent: v.items.length,
    };
  },
  slice(v, req) {
    if (req.type === 'children') return jsonChildren(v.items, req.path, req.from, req.to);
    if (req.type === 'json') return v.items;
    return unsupportedSlice('ndjson', req);
  },
  export: v => ({ text: toNdjson(v) }),
};

function describeInvalid(lines: number[]): string {
  if (lines.length === 0) return '0';
  const shown = lines.slice(0, SHOWN_INVALID).map(formatCount).join(', ');
  const more = lines.length > SHOWN_INVALID ? ', …' : '';
  return `${formatCount(lines.length)} (line${lines.length === 1 ? '' : 's'} ${shown}${more})`;
}

const toNdjson = (v: NdjsonValue) => v.items.map(item => JSON.stringify(item)).join('\n') + '\n';
