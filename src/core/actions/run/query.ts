import { isJqService } from '../../../modules/jq/service';
import type { EntryContent } from '../../content';
import { toCsv } from '../../csv';
import { formatCount } from '../../format';
import { isRecord } from '../../guards';
import { jsonInterpreter } from '../../interpreters/json';
import { ndjsonInterpreter } from '../../interpreters/ndjson';
import { recordsInterpreter, type RecordsValue } from '../../interpreters/records';
import { yamlInterpreter } from '../../interpreters/yaml';
import { loop, type TaskContext } from '../../progress';
import { inferSchema } from '../../schema';
import type { DerivedContent, Schema } from '../../types';
import { queryCountBy, queryDistinct, queryGroupBy, queryJq } from '../catalog/query';
import { implement } from '../types';
import { resolveColumn } from './records';
import { textResult } from './util';

// Sources: a JSON array of objects, or records (rows as objects)

type Source = { kind: 'json'; json: unknown } | RecordsValue;

const isSource = (v: unknown): v is Source =>
  jsonInterpreter.isValue(v) || recordsInterpreter.isValue(v);

/** JSON only when it's an array holding at least one object. */
const appliesTo = ({ value }: { value: Source }) =>
  value.kind === 'records' || (Array.isArray(value.json) && value.json.some(isRecord));

const itemsOf = (v: Source): unknown[] =>
  v.kind === 'records' ? v.rows : Array.isArray(v.json) ? v.json : [];

/** The source's field names for error messages: columns, or dot paths inferred from a sample. */
export function fieldNames(v: Source): string[] {
  if (v.kind === 'records') return v.columns;
  const out: string[] = [];
  const walk = (s: Schema, prefix: string, depth: number) => {
    if (s.t === 'union') for (const o of s.of) walk(o, prefix, depth);
    if (s.t !== 'object') return;
    for (const [k, f] of Object.entries(s.fields)) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (!out.includes(path)) out.push(path);
      if (depth < 2) walk(f.schema, path, depth + 1);
    }
  };
  const schema = inferSchema(itemsOf(v).slice(0, 1000));
  if (schema.t === 'array') walk(schema.of, '', 0);
  return out;
}

const listFields = (names: string[]) =>
  names.length ? names.slice(0, 15).join(', ') + (names.length > 15 ? ', …' : '') : 'none';

/** `a.b[0].c` → ['a', 'b', '0', 'c']. */
const pathParts = (ref: string) =>
  ref
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(p => p !== '');

function atPath(item: unknown, parts: string[]): unknown {
  let node = item;
  for (const p of parts) {
    if (Array.isArray(node) && /^\d+$/.test(p)) node = node[Number(p)];
    else if (isRecord(node) && Object.hasOwn(node, p)) node = node[p];
    else return undefined;
  }
  return node;
}

interface Field {
  /** Display name, used for the key column and file names. */
  name: string;
  /** The item's value, or undefined when it's missing. */
  get(item: unknown): unknown;
}

/**
 * Resolves a field reference: an exact key (which may contain dots), a dot path, or for records
 * a column name or 1-based number. Throws with the available fields when nothing has it.
 */
export function resolveField(v: Source, refIn: string): Field {
  const ref = refIn.trim();
  const items = itemsOf(v);
  if (ref === '') throw new Error(`Enter a field (fields: ${listFields(fieldNames(v))})`);
  if (v.kind === 'records') {
    const empty = (x: unknown) => (x === null || x === '' ? undefined : x);
    let columnError: unknown;
    try {
      const name = v.columns[resolveColumn(v.columns, ref)] ?? ref;
      return { name, get: item => (isRecord(item) ? empty(item[name]) : undefined) };
    } catch (err) {
      columnError = err;
    }
    // Rows from JSON can be nested: allow a path into them
    const parts = pathParts(ref);
    if (parts.length > 1 && items.some(i => atPath(i, parts) !== undefined)) {
      return { name: ref, get: item => empty(atPath(item, parts)) };
    }
    throw columnError;
  }
  if (items.some(i => isRecord(i) && Object.hasOwn(i, ref))) {
    return { name: ref, get: item => (isRecord(item) ? item[ref] : undefined) };
  }
  const parts = pathParts(ref);
  if (parts.length && items.some(i => atPath(i, parts) !== undefined)) {
    return { name: ref, get: item => atPath(item, parts) };
  }
  throw new Error(`No field "${ref}" (fields: ${listFields(fieldNames(v))})`);
}

// Grouping

export const NONE_KEY = '(none)';

/** A group key as text: strings as they are, numbers, booleans and null spelled out. */
export function keyText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || v === null) return String(v);
  return JSON.stringify(v);
}

export interface Group {
  /** The first value seen for this key (so 30 stays a number), or NONE_KEY when missing. */
  key: unknown;
  text: string;
  missing: boolean;
  items: unknown[];
}

type GroupSort = 'keyAsc' | 'keyDesc' | 'countDesc' | 'countAsc' | 'first';

const collator = new Intl.Collator(undefined, { numeric: true });

function compareKeys(a: Group, b: Group): number {
  if (typeof a.key === 'number' && typeof b.key === 'number') return a.key - b.key;
  return collator.compare(a.text, b.text);
}

/** Groups `items` by `field`, reporting progress and staying cancellable through `task`. */
export async function groupItems(
  items: readonly unknown[],
  field: Field,
  { missing, sort }: { missing: 'none' | 'skip'; sort: GroupSort },
  task?: TaskContext,
): Promise<Group[]> {
  const groups = new Map<string, Group>();
  let none: Group | null = null;
  await loop(items.length, task, `Grouping ${formatCount(items.length)} items`, i => {
    const item = items[i];
    const v = field.get(item);
    if (v === undefined) {
      if (missing === 'skip') return;
      none ??= { key: NONE_KEY, text: NONE_KEY, missing: true, items: [] };
      none.items.push(item);
      return;
    }
    const text = keyText(v);
    let g = groups.get(text);
    if (!g) groups.set(text, (g = { key: v, text, missing: false, items: [] }));
    g.items.push(item);
  });
  const out = [...groups.values()];
  // Array.prototype.sort is stable, so ties keep first-seen order
  if (sort === 'keyAsc') out.sort(compareKeys);
  else if (sort === 'keyDesc') out.sort((a, b) => compareKeys(b, a));
  if (none) out.push(none); // (none) last for key orders
  if (sort === 'countDesc') out.sort((a, b) => b.items.length - a.items.length);
  else if (sort === 'countAsc') out.sort((a, b) => a.items.length - b.items.length);
  return out;
}

// Aggregates

const AGGREGATES = ['count', 'sum', 'avg', 'min', 'max', 'distinct', 'first', 'last'] as const;
type AggregateFn = (typeof AGGREGATES)[number];
const ALIASES: Record<string, AggregateFn> = {
  mean: 'avg',
  average: 'avg',
  count_distinct: 'distinct',
  countdistinct: 'distinct',
  unique: 'distinct',
};
const isAggregateFn = (s: string): s is AggregateFn => AGGREGATES.some(a => a === s);

export interface Aggregate {
  fn: AggregateFn;
  field: Field;
  column: string;
}

export function parseAggregates(spec: string, v: Source): Aggregate[] {
  return spec
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(item => {
      const colon = item.indexOf(':');
      if (colon < 0) {
        throw new Error(
          `Aggregate "${item}": write function:field, e.g. sum:price (functions: ${AGGREGATES.join(', ')})`,
        );
      }
      const name = item.slice(0, colon).trim().toLowerCase();
      const fn = isAggregateFn(name) ? name : ALIASES[name];
      if (!fn) {
        throw new Error(`Unknown aggregate "${name}" in "${item}" (use ${AGGREGATES.join(', ')})`);
      }
      const field = resolveField(v, item.slice(colon + 1));
      return { fn, field, column: `${fn}_${field.name}` };
    });
}

const NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;
const numberOf = (x: unknown): number | null => {
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  if (typeof x === 'string' && NUMBER.test(x.trim())) return Number(x);
  return null;
};
/** Drops floating-point noise such as 0.30000000000000004. */
const tidy = (n: number) => Number(n.toPrecision(15));

export function aggregate(fn: AggregateFn, values: unknown[]): unknown {
  const present = values.filter(x => x !== undefined);
  switch (fn) {
    case 'count':
      return present.length;
    case 'distinct':
      return new Set(present.map(keyText)).size;
    case 'first':
      return present[0] ?? null;
    case 'last':
      return present.at(-1) ?? null;
    case 'sum':
    case 'avg': {
      const nums = present.map(numberOf).filter(n => n !== null);
      if (!nums.length) return null;
      const sum = nums.reduce((a, b) => a + b, 0);
      return tidy(fn === 'sum' ? sum : sum / nums.length);
    }
    case 'min':
    case 'max': {
      if (!present.length) return null;
      const sign = fn === 'min' ? 1 : -1;
      const nums = present.map(numberOf);
      if (nums.every(n => n !== null)) {
        // Numeric: the original value (e.g. "1.50" from CSV) of the smallest or largest
        let best = 0;
        nums.forEach((n, i) => {
          if (sign * (n - (nums[best] ?? n)) < 0) best = i;
        });
        return present[best];
      }
      return present.reduce((a, b) =>
        sign * collator.compare(keyText(b), keyText(a)) < 0 ? b : a,
      );
    }
  }
}

// Output

/** A base file name: the source's name without its extension, plus `suffix`. */
function fileName(content: EntryContent, suffix: string, ext: string): string {
  const base = (content.name ?? '').replace(/\.[^./\\]*$/, '');
  const slug = suffix.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'field';
  return `${base ? `${base}-` : ''}${slug}.${ext}`;
}

const indentAfterFirst = (text: string, by: string) => text.replace(/\n/g, `\n${by}`);

/** A JSON object with keys in the given order (JSON.stringify would put "1", "2" first). */
export function orderedObjectJson(entries: [string, unknown][]): string {
  if (!entries.length) return '{}';
  const body = entries.map(
    ([k, v]) => `  ${JSON.stringify(k)}: ${indentAfterFirst(JSON.stringify(v, null, 2), '  ')}`,
  );
  return `{\n${body.join(',\n')}\n}`;
}

/** Table rows as CSV/TSV for delimited sources, else a JSON array of objects. */
function tableResult(
  v: Source,
  columns: string[],
  rows: Record<string, unknown>[],
  content: EntryContent,
  suffix: string,
): DerivedContent {
  if (v.kind === 'records' && v.delimiter !== null) {
    const tab = v.delimiter === '\t';
    return textResult(
      toCsv(rows, columns, tab ? '\t' : ','),
      tab ? 'text/tab-separated-values' : 'text/csv',
      fileName(content, suffix, tab ? 'tsv' : 'csv'),
    );
  }
  return textResult(
    JSON.stringify(rows, null, 2) + '\n',
    'application/json',
    fileName(content, suffix, 'json'),
  );
}

async function summaryRows(
  groups: Group[],
  keyColumn: string,
  aggregates: Aggregate[],
  task: TaskContext,
) {
  const columns = [keyColumn, 'count', ...aggregates.map(a => a.column)];
  const unique = new Set(columns);
  if (unique.size !== columns.length) {
    const dup = columns.find((c, i) => columns.indexOf(c) !== i);
    throw new Error(`Column "${dup ?? ''}" appears twice in the summary`);
  }
  const rows: Record<string, unknown>[] = [];
  // Every `every` groups; with aggregates each group is a pass over its items, so check more often
  const every = aggregates.length ? 256 : 2048;
  const message = `Summarising ${formatCount(groups.length)} groups`;
  await loop(
    groups.length,
    task,
    message,
    i => {
      const g = groups[i];
      if (!g) return;
      const row: Record<string, unknown> = { [keyColumn]: g.key, count: g.items.length };
      for (const a of aggregates) row[a.column] = aggregate(a.fn, g.items.map(a.field.get));
      rows.push(row);
    },
    every,
  );
  return { columns, rows };
}

// jq

const jqSource = (v: unknown): v is unknown =>
  jsonInterpreter.isValue(v) ||
  yamlInterpreter.isValue(v) ||
  ndjsonInterpreter.isValue(v) ||
  recordsInterpreter.isValue(v);

/** The value as jq input text: one or more JSON values, one per line. */
export function jqInput(v: unknown): string {
  if (jsonInterpreter.isValue(v)) return JSON.stringify(v.json);
  if (recordsInterpreter.isValue(v)) return JSON.stringify(v.rows);
  if (ndjsonInterpreter.isValue(v)) return v.items.map(i => JSON.stringify(i)).join('\n');
  if (yamlInterpreter.isValue(v)) {
    // Several documents are several inputs, as yq gives them (slurp makes one array again)
    return v.documentCount > 1 && Array.isArray(v.root)
      ? v.root.map(d => JSON.stringify(d ?? null)).join('\n')
      : JSON.stringify(v.root ?? null);
  }
  throw new Error("jq can't read this value");
}

const ARG = /^([A-Za-z_][A-Za-z0-9_]*)\s*(:?=)(.*)$/;

export function parseJqArgs(text: string): { name: string; value: string; json: boolean }[] {
  const out: { name: string; value: string; json: boolean }[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (line.trim() === '') return;
    const m = ARG.exec(line.trim());
    if (!m?.[1]) {
      throw new Error(`Variables line ${i + 1}: write name=value (or name:=JSON), e.g. min_age=30`);
    }
    out.push({ name: m[1], value: m[3] ?? '', json: m[2] === ':=' });
  });
  return out;
}

/** Results over this many characters are refused rather than added as a capture. */
export const MAX_JQ_OUTPUT = 32 * 1024 * 1024;

/**
 * jq's output values. Compact output has one per line; pretty output starts each value at
 * column 0, and its inner lines are indented or close a bracket at column 0.
 */
export function splitJqValues(stdout: string, compact: boolean): string[] {
  const lines = stdout.split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (compact) return lines;
  const values: string[] = [];
  for (const line of lines) {
    const continues = values.length > 0 && /^[\s}\]]/.test(line);
    if (continues) values[values.length - 1] += `\n${line}`;
    else values.push(line);
  }
  return values;
}

/** One output as it is; several as a JSON array (or, with raw output, text lines). */
export function jqResult(stdout: string, raw: boolean, compact: boolean): DerivedContent {
  if (stdout.length > MAX_JQ_OUTPUT) {
    throw new Error(
      `jq's output is over ${MAX_JQ_OUTPUT / 1024 / 1024} MB; narrow the filter (e.g. with limit(100; …))`,
    );
  }
  if (raw) {
    if (stdout === '') throw new Error('The filter gave no output');
    return textResult(stdout.endsWith('\n') ? stdout : `${stdout}\n`, 'text/plain');
  }
  const values = splitJqValues(stdout, compact);
  const [only] = values;
  if (only === undefined) throw new Error('The filter gave no output');
  const json =
    values.length === 1
      ? only
      : compact
        ? `[${values.join(',')}]`
        : `[\n${values.map(v => `  ${indentAfterFirst(v, '  ')}`).join(',\n')}\n]`;
  return textResult(`${json}\n`, 'application/json');
}

export const queryImpls = [
  implement(queryGroupBy, {
    value: isSource,
    applies: appliesTo,
    async run({ value, content }, { field: ref, output, aggregates, sort, missing }, ctx) {
      const field = resolveField(value, ref);
      const aggs = output === 'summary' ? parseAggregates(aggregates, value) : [];
      const groups = await groupItems(itemsOf(value), field, { missing, sort }, ctx);
      if (!groups.length) throw new Error(`No item has ${field.name}`);
      const suffix = `by-${field.name}`;
      if (output === 'object') {
        return textResult(
          orderedObjectJson(groups.map(g => [g.text, g.items])) + '\n',
          'application/json',
          fileName(content, suffix, 'json'),
        );
      }
      if (output === 'groups') {
        const out = groups.map(g => ({ key: g.key, count: g.items.length, items: g.items }));
        return textResult(
          JSON.stringify(out, null, 2) + '\n',
          'application/json',
          fileName(content, suffix, 'json'),
        );
      }
      const { columns, rows } = await summaryRows(groups, field.name, aggs, ctx);
      return tableResult(value, columns, rows, content, suffix);
    },
  }),
  implement(queryCountBy, {
    value: isSource,
    applies: appliesTo,
    async run({ value, content }, { field: ref, missing }, ctx) {
      const field = resolveField(value, ref);
      const groups = await groupItems(itemsOf(value), field, { missing, sort: 'countDesc' }, ctx);
      if (!groups.length) throw new Error(`No item has ${field.name}`);
      const { columns, rows } = await summaryRows(groups, field.name, [], ctx);
      return tableResult(value, columns, rows, content, `count-by-${field.name}`);
    },
  }),
  implement(queryDistinct, {
    value: isSource,
    applies: appliesTo,
    async run({ value, content }, { field: ref, sort }, ctx) {
      const field = resolveField(value, ref);
      const groups = await groupItems(
        itemsOf(value),
        field,
        {
          missing: 'skip',
          sort: sort === 'asc' ? 'keyAsc' : sort === 'count' ? 'countDesc' : 'first',
        },
        ctx,
      );
      if (!groups.length) throw new Error(`No item has ${field.name}`);
      return textResult(
        JSON.stringify(
          groups.map(g => g.key),
          null,
          2,
        ) + '\n',
        'application/json',
        fileName(content, `${field.name}-values`, 'json'),
      );
    },
  }),
  implement(queryJq, {
    value: jqSource,
    async run({ value }, { filter, raw, compact, slurp, args, timeout }, ctx) {
      if (filter.trim() === '') throw new Error('Enter a jq filter, e.g. .');
      const parsedArgs = parseJqArgs(args);
      const jq = await ctx.service('jq', isJqService);
      if (!jq) throw new Error("The jq module isn't available");
      ctx.progress(undefined, 'Running jq…');
      const stdout = await jq.run(
        jqInput(value),
        filter,
        { raw, compact, slurp, args: parsedArgs },
        { signal: ctx.signal, timeout },
      );
      return jqResult(stdout, raw, compact);
    },
  }),
];
