import Papa from 'papaparse';
import type { EntryContent } from '../../content';
import { cellText, quoteCell } from '../../csv';
import { recordsInterpreter, type RecordsValue } from '../../interpreters/records';
import { inferSchema, schemaToTs } from '../../schema';
import type { DerivedContent } from '../../types';
import {
  recordsFilter,
  recordsPick,
  recordsSort,
  recordsToCsv,
  recordsToMarkdown,
  recordsToSql,
  recordsToTsv,
  recordsTypes,
} from '../catalog/records';
import { checkpoint, loop, type TaskContext } from '../../progress';
import { formatCount } from '../../format';
import { implement } from '../types';
import { textResult, withExtension } from './util';

const value = recordsInterpreter.isValue;

type Row = unknown[];

/**
 * Records as rows of cells in column order. Delimited sources are re-read as the original strings
 * (`raw`), so "1.50", "007" and "TRUE" survive a round trip instead of being retyped.
 */
export interface Table {
  columns: string[];
  rows: unknown[][];
  raw: boolean;
  /** False when the source had no header row (its columns are named col1, col2, …). */
  header: boolean;
}

export function toTable(v: RecordsValue, content: EntryContent): Table {
  if (v.delimiter !== null && !v.source && content.text !== null) {
    const { data } = Papa.parse<string[]>(content.text, {
      delimiter: v.delimiter,
      skipEmptyLines: true,
    });
    return {
      columns: v.columns,
      rows: v.hasHeader ? data.slice(1) : data,
      raw: true,
      header: v.hasHeader,
    };
  }
  return {
    columns: v.columns,
    rows: v.rows.map(r => v.columns.map(c => r[c])),
    raw: false,
    header: true,
  };
}

const NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;
const isEmpty = (cell: unknown) => cell === null || cell === undefined || cell === '';
const numberOf = (cell: unknown): number | null => {
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : null;
  if (typeof cell === 'string' && NUMBER.test(cell.trim())) return Number(cell);
  return null;
};

/** 1-based index or header name (exact, then ignoring case) → column position. */
export function resolveColumn(columns: readonly string[], ref: string): number {
  const r = ref.trim();
  if (r === '') throw new Error('Enter a column name or number');
  const exact = columns.indexOf(r);
  if (exact >= 0) return exact;
  const lower = r.toLowerCase();
  const loose = columns.findIndex(c => c.toLowerCase() === lower);
  if (loose >= 0) return loose;
  if (/^\d+$/.test(r)) {
    const n = Number(r);
    if (n >= 1 && n <= columns.length) return n - 1;
    throw new Error(
      `No column ${n}: there ${columns.length === 1 ? 'is 1 column' : `are ${columns.length} columns`}`,
    );
  }
  const list = columns.slice(0, 12).join(', ') + (columns.length > 12 ? ', …' : '');
  throw new Error(`No column "${r}" (columns: ${list})`);
}

async function writeDelimited(
  t: Table,
  delimiter: string,
  header = t.header,
  task?: TaskContext,
): Promise<string> {
  const cell = (v: unknown) => quoteCell(cellText(v), delimiter);
  const lines = header ? [t.columns.map(cell).join(delimiter)] : [];
  await loop(t.rows.length, task, `Writing ${formatCount(t.rows.length)} rows`, r => {
    const row = t.rows[r] ?? [];
    let line = '';
    for (let i = 0; i < t.columns.length; i++) {
      if (i > 0) line += delimiter;
      line += cell(row[i]);
    }
    lines.push(line);
  });
  return lines.join(delimiter === '\t' ? '\n' : '\r\n') + (delimiter === '\t' ? '\n' : '\r\n');
}

const csvResult = async (t: Table, content: EntryContent, task: TaskContext) =>
  textResult(
    await writeDelimited(t, ',', t.header, task),
    'text/csv',
    withExtension(content.name, 'csv', 'data'),
  );

const tsvResult = async (t: Table, content: EntryContent, task: TaskContext) =>
  textResult(
    await writeDelimited(t, '\t', t.header, task),
    'text/tab-separated-values',
    withExtension(content.name, 'tsv', 'data'),
  );

const toObject = (columns: readonly string[], row: readonly unknown[]) => {
  const o: Record<string, unknown> = {};
  columns.forEach((c, i) => (o[c] = row[i] ?? null));
  return o;
};

/** Table-shaped results keep the source's format: the same delimiter, NDJSON or a JSON array. */
async function sameFormat(
  v: RecordsValue,
  t: Table,
  content: EntryContent,
  task: TaskContext,
  header?: boolean,
): Promise<DerivedContent> {
  if (v.delimiter !== null) {
    const tab = v.delimiter === '\t';
    return textResult(
      await writeDelimited(t, v.delimiter, header, task),
      tab ? 'text/tab-separated-values' : 'text/csv',
      withExtension(content.name, tab ? 'tsv' : 'csv', 'data'),
    );
  }
  if (v.ndjson) {
    const text = t.rows.map(r => JSON.stringify(toObject(t.columns, r))).join('\n') + '\n';
    return textResult(text, 'application/x-ndjson', withExtension(content.name, 'ndjson', 'data'));
  }
  const rows = t.rows.map(r => toObject(t.columns, r));
  return textResult(
    JSON.stringify(rows, null, 2),
    'application/json',
    withExtension(content.name, 'json', 'data'),
  );
}

// Markdown

const mdCell = (v: unknown) =>
  cellText(v).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');

export function toMarkdown(t: Table, align: 'auto' | 'left' | 'center' | 'right' | 'none'): string {
  const rule = (i: number) => {
    const a =
      align === 'auto'
        ? t.rows.some(r => !isEmpty(r[i])) &&
          t.rows.every(r => isEmpty(r[i]) || numberOf(r[i]) !== null)
          ? 'right'
          : 'none'
        : align;
    return a === 'left' ? ':---' : a === 'center' ? ':---:' : a === 'right' ? '---:' : '---';
  };
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`;
  const lines = [line(t.columns.map(mdCell)), line(t.columns.map((_, i) => rule(i)))];
  for (const row of t.rows) lines.push(line(t.columns.map((_, i) => mdCell(row[i]))));
  return lines.join('\n') + '\n';
}

// SQL

type Dialect = 'ansi' | 'mysql' | 'postgres' | 'sqlite';

const quoteIdent = (name: string, dialect: Dialect) =>
  dialect === 'mysql' ? `\`${name.replace(/`/g, '``')}\`` : `"${name.replace(/"/g, '""')}"`;

const quoteString = (s: string, dialect: Dialect) =>
  `'${(dialect === 'mysql' ? s.replace(/\\/g, '\\\\') : s).replace(/'/g, "''")}'`;

function sqlValue(cell: unknown, raw: boolean, dialect: Dialect, emptyAsNull: boolean): string {
  if (cell === null || cell === undefined) return emptyAsNull ? 'NULL' : "''";
  if (typeof cell === 'number') return Number.isFinite(cell) ? String(cell) : 'NULL';
  if (typeof cell === 'boolean') return cell ? 'TRUE' : 'FALSE';
  if (typeof cell === 'string') {
    if (cell === '') return emptyAsNull ? 'NULL' : "''";
    // Raw CSV text: unquote numbers (not ones with leading zeros, like "007")
    if (raw && NUMBER.test(cell)) return cell;
    return quoteString(cell, dialect);
  }
  return quoteString(JSON.stringify(cell), dialect);
}

export async function toSql(
  t: Table,
  {
    table,
    dialect,
    batch,
    emptyAsNull,
  }: { table: string; dialect: Dialect; batch: number; emptyAsNull: boolean },
  task?: TaskContext,
): Promise<string> {
  const target = table
    .split('.')
    .map(part => quoteIdent(part.trim(), dialect))
    .join('.');
  const cols = t.columns.map(c => quoteIdent(c, dialect)).join(', ');
  const head = `INSERT INTO ${target} (${cols}) VALUES`;
  const out: string[] = [];
  const batches = Math.ceil(t.rows.length / batch);
  const every = Math.max(1, Math.ceil(2048 / batch));
  await loop(
    batches,
    task,
    `Writing ${formatCount(t.rows.length)} rows`,
    b => {
      const start = b * batch;
      const values = t.rows
        .slice(start, start + batch)
        .map(
          row =>
            `(${t.columns.map((_, i) => sqlValue(row[i], t.raw, dialect, emptyAsNull)).join(', ')})`,
        );
      out.push(batch === 1 ? `${head} ${values[0] ?? ''};` : `${head}\n  ${values.join(',\n  ')};`);
    },
    every,
  );
  return out.join('\n') + '\n';
}

// Sort and filter

const collators = {
  natural: new Intl.Collator(undefined, { numeric: true }),
  text: new Intl.Collator(undefined),
};

export async function sortTable(
  t: Table,
  col: number,
  order: 'asc' | 'desc',
  compare: 'natural' | 'numeric' | 'text',
  task?: TaskContext,
): Promise<Table> {
  const sign = order === 'asc' ? 1 : -1;
  // Decorate once; empty (and, for numeric, non-numeric) keys sort last either way
  const keyed: { row: Row; key: number | string | null }[] = [];
  await loop(t.rows.length, task, 'Reading sort keys', i => {
    const row = t.rows[i] ?? [];
    const cell = row[col];
    const key = compare === 'numeric' ? numberOf(cell) : isEmpty(cell) ? null : cellText(cell);
    keyed.push({ row, key });
  });
  // One call to Array.sort: it can't report or stop part-way
  task?.progress(undefined, `Sorting ${formatCount(keyed.length)} rows`);
  if (task) await checkpoint(task.signal);
  const cmp = (a: number | string, b: number | string) =>
    typeof a === 'number' && typeof b === 'number'
      ? a - b
      : collators[compare === 'text' ? 'text' : 'natural'].compare(String(a), String(b));
  keyed.sort((a, b) => {
    if (a.key === null || b.key === null) return a.key === null ? (b.key === null ? 0 : 1) : -1;
    return sign * cmp(a.key, b.key);
  });
  return { ...t, rows: keyed.map(k => k.row) };
}

type FilterOp = 'eq' | 'ne' | 'contains' | 'starts' | 'regex' | 'gt' | 'lt' | 'empty' | 'notEmpty';

export function rowFilter(
  op: FilterOp,
  value: string,
  ignoreCase: boolean,
): (cell: unknown) => boolean {
  const fold = (s: string) => (ignoreCase ? s.toLowerCase() : s);
  const target = fold(value);
  const targetNum = numberOf(value);
  const collator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: ignoreCase ? 'accent' : 'variant',
  });
  const compare = (cell: unknown) => {
    const n = numberOf(cell);
    return n !== null && targetNum !== null
      ? n - targetNum
      : collator.compare(cellText(cell), value);
  };
  const equals = (cell: unknown) => {
    const n = numberOf(cell);
    return n !== null && targetNum !== null ? n === targetNum : fold(cellText(cell)) === target;
  };
  switch (op) {
    case 'eq':
      return equals;
    case 'ne':
      return cell => !equals(cell);
    case 'contains':
      return cell => fold(cellText(cell)).includes(target);
    case 'starts':
      return cell => fold(cellText(cell)).startsWith(target);
    case 'regex': {
      let re: RegExp;
      try {
        re = new RegExp(value, ignoreCase ? 'iu' : 'u');
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(`Invalid regular expression: ${reason}`, { cause: err });
      }
      return cell => re.test(cellText(cell));
    }
    case 'gt':
      return cell => !isEmpty(cell) && compare(cell) > 0;
    case 'lt':
      return cell => !isEmpty(cell) && compare(cell) < 0;
    case 'empty':
      return cell => cellText(cell).trim() === '';
    case 'notEmpty':
      return cell => cellText(cell).trim() !== '';
  }
}

// Pick and rename

interface PickedColumn {
  from: number;
  name: string;
}

export function parseColumnPicks(spec: string, columns: readonly string[]): PickedColumn[] {
  const items = spec
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  if (items.length === 0) throw new Error('List the columns to keep, e.g. "id, name:title"');
  const picks = items.map(item => {
    // A column whose name contains ':' is matched whole before splitting off a rename
    const colon = columns.includes(item) ? -1 : item.lastIndexOf(':');
    const ref = colon < 0 ? item : item.slice(0, colon);
    const from = resolveColumn(columns, ref);
    const rename = colon < 0 ? '' : item.slice(colon + 1).trim();
    return { from, name: rename || (columns[from] ?? ref) };
  });
  const seen = new Set<string>();
  for (const p of picks) {
    if (seen.has(p.name)) throw new Error(`Column "${p.name}" appears twice in the output`);
    seen.add(p.name);
  }
  return picks;
}

export const recordsImpls = [
  implement(recordsSort, {
    value,
    async run({ value, content }, { column, order, compare }, ctx) {
      const t = toTable(value, content);
      return sameFormat(
        value,
        await sortTable(t, resolveColumn(t.columns, column), order, compare, ctx),
        content,
        ctx,
      );
    },
  }),
  implement(recordsPick, {
    value,
    run({ value, content }, { columns }, ctx) {
      const t = toTable(value, content);
      const picks = parseColumnPicks(columns, t.columns);
      const renamed = picks.some(p => p.name !== t.columns[p.from]);
      const picked: Table = {
        ...t,
        columns: picks.map(p => p.name),
        rows: t.rows.map(row => picks.map(p => row[p.from])),
      };
      return sameFormat(value, picked, content, ctx, t.header || renamed);
    },
  }),
  implement(recordsFilter, {
    value,
    async run({ value, content }, { column, op, value: target, ignoreCase }, ctx) {
      const t = toTable(value, content);
      const col = resolveColumn(t.columns, column);
      const keep = rowFilter(op, target, ignoreCase);
      const rows: Row[] = [];
      await loop(t.rows.length, ctx, `Filtering ${formatCount(t.rows.length)} rows`, i => {
        const row = t.rows[i];
        if (row && keep(row[col])) rows.push(row);
      });
      if (rows.length === 0) throw new Error('No rows match');
      return sameFormat(value, { ...t, rows }, content, ctx);
    },
  }),
  implement(recordsToCsv, {
    value,
    applies: ({ value }) => value.delimiter !== ',',
    run: ({ value, content }, _params, ctx) => csvResult(toTable(value, content), content, ctx),
  }),
  implement(recordsToTsv, {
    value,
    applies: ({ value }) => value.delimiter !== '\t',
    run: ({ value, content }, _params, ctx) => tsvResult(toTable(value, content), content, ctx),
  }),
  implement(recordsToMarkdown, {
    value,
    run: ({ value, content }, { align }) =>
      textResult(
        toMarkdown(toTable(value, content), align),
        'text/markdown',
        withExtension(content.name, 'md', 'table'),
      ),
  }),
  implement(recordsToSql, {
    value,
    run: async ({ value, content }, params, ctx) =>
      textResult(
        await toSql(toTable(value, content), params, ctx),
        'text/x-sql',
        withExtension(content.name, 'sql', 'data'),
      ),
  }),
  implement(recordsTypes, {
    value,
    run({ value }, { rowName }) {
      const schema = inferSchema(value.rows);
      const row = schema.t === 'array' ? schema.of : schema;
      const body = schemaToTs(row);
      const ts =
        row.t === 'object' && Object.keys(row.fields).length > 0
          ? `export interface ${rowName} ${body}\n`
          : `export type ${rowName} = Record<string, unknown>;\n`;
      return textResult(ts, 'text/typescript', `${rowName}.ts`);
    },
  }),
];
