import Papa from 'papaparse';
import { createMemo, type EntryContent } from '../content';
import { formatCount } from '../format';
import { hasKind, isRecord } from '../guards';
import { unsupportedSlice, type Interpreter } from '../interpreter';
import { inferSchema } from '../schema';
import type { ColumnInfo } from '../types';
import { tryParseJson } from './json';
import { tryParseNdjson } from './ndjson';

export interface RecordsValue {
  kind: 'records';
  columns: string[];
  rows: Record<string, unknown>[];
  /** Null when the records came from a JSON array or NDJSON. */
  delimiter: string | null;
  /** Set when the records came from NDJSON. */
  ndjson?: boolean;
  hasHeader: boolean;
  /** Describes where non-delimited, non-JSON records came from (see `addRecordsSource`). */
  source?: string;
}

/** Extra ways to read records from text, contributed by other kinds (e.g. URL query params). */
export interface RecordsSource {
  detect(c: EntryContent): number;
  parse(c: EntryContent): RecordsValue;
}
const sources: RecordsSource[] = [];
export const addRecordsSource = (s: RecordsSource) => void sources.push(s);
const sourceFor = (c: EntryContent) => sources.find(s => s.detect(c) > 0);

const DELIMITERS = [',', '\t', ';', '|'] as const;
const DELIMITER_NAMES: Record<string, string> = {
  ',': 'comma',
  '\t': 'tab',
  ';': 'semicolon',
  '|': 'pipe',
};
const SAMPLE_ROWS = 50;

interface DelimiterGuess {
  delimiter: string;
  confidence: number;
}

/** Picks the delimiter whose field count is consistent over a sample; penalises prose. */
export function guessDelimiter(text: string): DelimiterGuess | null {
  let best: DelimiterGuess | null = null;
  for (const delimiter of DELIMITERS) {
    const { data } = Papa.parse<string[]>(text, {
      delimiter,
      preview: SAMPLE_ROWS,
      skipEmptyLines: true,
    });
    if (data.length < 3) continue;
    const counts = new Map<number, number>();
    for (const row of data) counts.set(row.length, (counts.get(row.length) ?? 0) + 1);
    const top = [...counts].sort((a, b) => b[1] - a[1])[0];
    if (!top) continue;
    const [mode, modeCount] = top;
    if (mode < 2 || modeCount / data.length < 0.9) continue;

    const cells = data.flat();
    const avgWords = cells.reduce((n, c) => n + c.trim().split(/\s+/).length, 0) / cells.length;
    let confidence = delimiter === '\t' ? 0.85 : delimiter === ',' ? 0.75 : 0.6;
    if (avgWords > 4) confidence *= 0.3;
    if (!best || confidence > best.confidence) best = { delimiter, confidence };
  }
  return best;
}

const delimiterOf = createMemo(c => (c.text === null ? null : guessDelimiter(c.text)));

function jsonRecords(c: EntryContent): Record<string, unknown>[] | null {
  const r = tryParseJson(c);
  if (!r.ok || !Array.isArray(r.value) || r.value.length === 0) return null;
  return r.value.every(isRecord) ? r.value : null;
}

function ndjsonRecords(c: EntryContent): Record<string, unknown>[] | null {
  const items = tryParseNdjson(c)?.items;
  return items && items.every(isRecord) ? items : null;
}

const recordsFromObjects = (rows: Record<string, unknown>[], ndjson: boolean): RecordsValue => ({
  kind: 'records',
  columns: [...new Set(rows.flatMap(r => Object.keys(r)))],
  rows,
  delimiter: null,
  hasHeader: true,
  ...(ndjson ? { ndjson } : {}),
});

export function typeCell(raw: string): unknown {
  const s = raw.trim();
  if (s === '') return null;
  if (/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(s)) return Number(s);
  if (/^(true|false)$/i.test(s)) return s.toLowerCase() === 'true';
  return raw;
}

const looksNumeric = (s: string) => typeCell(s) !== null && typeof typeCell(s) === 'number';

/** A header row is non-empty, non-numeric text in every cell, with no repeats. */
export function looksLikeHeader(first: readonly unknown[]): boolean {
  return (
    first.length > 0 &&
    first.every(h => typeof h === 'string' && h.trim() !== '' && !looksNumeric(h)) &&
    new Set(first).size === first.length
  );
}

export function parseDelimited(text: string, delimiter: string): RecordsValue {
  const { data } = Papa.parse<string[]>(text, { delimiter, skipEmptyLines: true });
  const first = data[0] ?? [];
  const hasHeader = looksLikeHeader(first);
  const width = Math.max(...data.map(r => r.length));
  const columns = hasHeader
    ? first.map(h => h.trim())
    : Array.from({ length: width }, (_, i) => `col${i + 1}`);
  for (let i = columns.length; i < width; i++) columns.push(`col${i + 1}`);
  const rows = data.slice(hasHeader ? 1 : 0).map(row => {
    const rec: Record<string, unknown> = {};
    columns.forEach((col, i) => (rec[col] = typeCell(row[i] ?? '')));
    return rec;
  });
  return { kind: 'records', columns, rows, delimiter, hasHeader };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

export function columnInfo(v: RecordsValue): (ColumnInfo & { empty: number })[] {
  return v.columns.map(name => {
    const types = new Set<string>();
    let empty = 0;
    for (const row of v.rows) {
      const cell = row[name];
      if (cell === null || cell === undefined || cell === '') {
        empty++;
        continue;
      }
      if (typeof cell === 'string' && ISO_DATE.test(cell)) types.add('date');
      else if (Array.isArray(cell)) types.add('array');
      else types.add(typeof cell);
    }
    const type = types.size === 0 ? 'empty' : [...types].sort().join(' | ');
    return { name, type, empty };
  });
}

export const recordsInterpreter: Interpreter<RecordsValue> = {
  kind: 'records',
  isValue: (v): v is RecordsValue => hasKind(v, 'records'),
  detect(c) {
    if (c.text === null) return 0;
    const extra = sourceFor(c);
    if (extra) return extra.detect(c);
    if (tryParseJson(c).ok) return jsonRecords(c) ? 0.6 : 0;
    // NDJSON lines are full of commas; don't let them pass for CSV
    if (tryParseNdjson(c)) return ndjsonRecords(c) ? 0.6 : 0;
    return delimiterOf(c)?.confidence ?? 0;
  },
  parse(c) {
    const extra = sourceFor(c);
    if (extra) return extra.parse(c);
    const fromJson = jsonRecords(c);
    if (fromJson) return recordsFromObjects(fromJson, false);
    const fromNdjson = ndjsonRecords(c);
    if (fromNdjson) return recordsFromObjects(fromNdjson, true);
    const guess = delimiterOf(c);
    if (!guess || c.text === null) throw new Error('Not delimited data');
    return parseDelimited(c.text, guess.delimiter);
  },
  label: v => `Records ${formatCount(v.rows.length)}×${v.columns.length}`,
  summarise(v) {
    const cols = columnInfo(v);
    return {
      stats: [
        { label: 'Rows', value: formatCount(v.rows.length) },
        { label: 'Columns', value: String(v.columns.length) },
        {
          label: 'Source',
          value:
            v.source ??
            (v.delimiter !== null
              ? `${DELIMITER_NAMES[v.delimiter]}-delimited`
              : v.ndjson
                ? 'NDJSON'
                : 'JSON array'),
        },
        ...(v.delimiter === null || v.source
          ? []
          : [{ label: 'Header row', value: v.hasHeader ? 'yes' : 'no' }]),
        {
          label: 'Column types',
          value: '',
          children: cols.map(c => ({
            label: c.name,
            value: c.empty > 0 ? `${c.type} · ${formatCount(c.empty)} empty` : c.type,
          })),
        },
      ],
      schema: inferSchema(v.rows),
      extent: v.rows.length,
      columns: cols.map(({ name, type }) => ({ name, type })),
    };
  },
  slice(v, req) {
    if (req.type === 'rows') return v.rows.slice(req.from, req.to);
    return unsupportedSlice('records', req);
  },
  export: v => ({ text: toTsv(v) }),
  derivations: () => [{ id: 'json', label: 'As JSON' }],
  derive: v => ({
    mime: 'application/json',
    bytes: new TextEncoder().encode(JSON.stringify(v.rows, null, 2)),
  }),
};

function tsvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[\t\n"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toTsv(v: RecordsValue): string {
  const lines = [v.columns.map(tsvCell).join('\t')];
  for (const row of v.rows) lines.push(v.columns.map(c => tsvCell(row[c])).join('\t'));
  return lines.join('\n');
}
