import Papa from 'papaparse';
import type { Database, SqlJsStatic, SqlValue } from 'sql.js';
import { formatBytes, formatCount, plural } from '../../core/format';
import { hasKind } from '../../core/guards';
import { unsupportedSlice, type Interpreter } from '../../core/interpreter';
import type { ColumnInfo, StatRow, TableInfo } from '../../core/types';
import { isSqlite } from './detect';

export interface SqliteColumn {
  name: string;
  /** Declared type, e.g. "INTEGER"; empty if none. */
  type: string;
  pk: boolean;
  notnull: boolean;
}

export interface SqliteTable {
  name: string;
  /**
   * Row count. Not counted at open (a full scan per table is slow on big databases): it's an
   * estimate from sqlite_stat1 if present, else null, until `countRows` runs.
   */
  rows: number | null;
  /** True once `rows` is an exact count. */
  exact: boolean;
  /** Set if counting failed (e.g. a virtual table whose module sql.js lacks). */
  countError?: string;
  columns: SqliteColumn[];
}

export interface SqliteObject {
  type: string;
  name: string;
  table: string;
  sql: string | null;
}

export interface SqliteValue {
  kind: 'sqlite';
  /** In-memory copy, opened with query_only; never written back. */
  db: Database;
  size: number;
  tables: SqliteTable[];
  /** Everything in sqlite_master: tables, views, indexes, triggers. */
  objects: SqliteObject[];
  pageSize: number;
  pageCount: number;
  schemaVersion: number;
  userVersion: number;
  encoding: string;
}

export const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;

function query(db: Database, sql: string, params: SqlValue[] = []): SqlValue[][] {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    const out: SqlValue[][] = [];
    while (stmt.step()) out.push(stmt.get());
    return out;
  } finally {
    stmt.free();
  }
}

const str = (v: SqlValue | undefined) => (typeof v === 'string' ? v : '');
const num = (v: SqlValue | undefined) => (typeof v === 'number' ? v : 0);
const pragma = (db: Database, name: string) => query(db, `PRAGMA ${name}`)[0]?.[0];

const BLOB_PREVIEW = 32;

function hex(b: Uint8Array): string {
  let s = '';
  for (const byte of b) s += byte.toString(16).padStart(2, '0');
  return s;
}

/** Blobs as SQL hex literals, truncated for previews. */
export function cellValue(v: SqlValue, truncate: boolean): unknown {
  if (!(v instanceof Uint8Array)) return v;
  if (!truncate || v.length <= BLOB_PREVIEW) return `x'${hex(v)}'`;
  return `x'${hex(v.subarray(0, BLOB_PREVIEW))}…' (${formatBytes(v.length)})`;
}

export function openDatabase(SQL: SqlJsStatic, bytes: Uint8Array): SqliteValue {
  let data = bytes;
  // WAL-mode files (format versions 2) can't be opened from memory; read them as rollback-journal
  if (bytes[18] === 2 || bytes[19] === 2) {
    data = bytes.slice();
    data[18] = 1;
    data[19] = 1;
  }
  const db = new SQL.Database(data);
  db.run('PRAGMA query_only = ON');
  const objects = query(db, 'SELECT type, name, tbl_name, sql FROM sqlite_master').map(
    ([type, name, table, sql]): SqliteObject => ({
      type: str(type),
      name: str(name),
      table: str(table),
      sql: typeof sql === 'string' ? sql : null,
    }),
  );
  const estimates = statEstimates(db);
  const tables = objects
    .filter(o => o.type === 'table' && !o.name.startsWith('sqlite_'))
    .map((o): SqliteTable => {
      const columns = query(db, `PRAGMA table_info(${quoteIdent(o.name)})`).map(
        ([, name, type, notnull, , pk]): SqliteColumn => ({
          name: str(name),
          type: str(type),
          notnull: num(notnull) === 1,
          pk: num(pk) > 0,
        }),
      );
      return { name: o.name, rows: estimates.get(o.name) ?? null, exact: false, columns };
    });
  return {
    kind: 'sqlite',
    db,
    size: bytes.length,
    tables,
    objects,
    pageSize: num(pragma(db, 'page_size')),
    pageCount: num(pragma(db, 'page_count')),
    schemaVersion: num(pragma(db, 'schema_version')),
    userVersion: num(pragma(db, 'user_version')),
    encoding: str(pragma(db, 'encoding')),
  };
}

/** Row estimates recorded by ANALYZE, if the database has them; cheap to read. */
function statEstimates(db: Database): Map<string, number> {
  const out = new Map<string, number>();
  try {
    for (const [tbl, stat] of query(db, 'SELECT tbl, stat FROM sqlite_stat1')) {
      const n = Number(str(stat).split(' ')[0]);
      if (typeof tbl === 'string' && Number.isFinite(n))
        out.set(tbl, Math.max(out.get(tbl) ?? 0, n));
    }
  } catch {
    // no sqlite_stat1 table: ANALYZE was never run
  }
  return out;
}

/** Exact row count for one table, cached on the value. Runs only when asked (table selected). */
export function countRows(v: SqliteValue, table: number): number {
  const t = tableAt(v, table);
  if (t.exact && t.rows !== null) return t.rows;
  try {
    t.rows = num(query(v.db, `SELECT count(*) FROM ${quoteIdent(t.name)}`)[0]?.[0]);
    t.exact = true;
    return t.rows;
  } catch (err) {
    t.countError = err instanceof Error ? err.message : String(err);
    throw err;
  }
}

const tableAt = (v: SqliteValue, i = 0): SqliteTable => {
  const t = v.tables[i];
  if (!t) throw new Error(`No table ${i}`);
  return t;
};

/** A window of a table's rows, keyed by column name; only that window is read. */
export function tableRows(
  v: SqliteValue,
  table: number,
  from: number,
  to: number,
  truncate = true,
): Record<string, unknown>[] {
  const t = tableAt(v, table);
  const names = t.columns.map(c => c.name);
  const select = `SELECT ${names.map(quoteIdent).join(', ') || '*'} FROM ${quoteIdent(t.name)}`;
  const limit = Math.max(0, to - from);
  const rows =
    to === Infinity
      ? query(v.db, select)
      : query(v.db, `${select} LIMIT ? OFFSET ?`, [limit, from]);
  return rows.map(row => {
    const rec: Record<string, unknown> = {};
    names.forEach((n, i) => (rec[n] = cellValue(row[i] ?? null, truncate)));
    return rec;
  });
}

export function tableCsv(v: SqliteValue, table: number): string {
  const t = tableAt(v, table);
  const fields = t.columns.map(c => c.name);
  const rows = tableRows(v, table, 0, Infinity, false);
  return Papa.unparse({ fields, data: rows.map(r => fields.map(f => r[f] ?? '')) });
}

const columnType = (c: SqliteColumn) =>
  [c.type || 'any', c.pk && 'pk', c.notnull && !c.pk && 'not null'].filter(Boolean).join(' · ');

const tableInfo = (t: SqliteTable): TableInfo => ({
  name: t.name,
  extent: t.rows ?? 0,
  exact: t.exact,
  columns: t.columns.map((c): ColumnInfo => ({ name: c.name, type: columnType(c) })),
});

const rowCount = (t: SqliteTable) =>
  t.rows === null
    ? 'rows not counted'
    : t.exact
      ? plural(t.rows, 'row')
      : `~${plural(t.rows, 'row')} (estimate)`;

export function schemaSql(v: SqliteValue): string {
  return v.objects.flatMap(o => (o.sql ? [`${o.sql};`] : [])).join('\n\n');
}

function objectStats(v: SqliteValue, type: string, label: string): StatRow {
  const items = v.objects.filter(o => o.type === type);
  return {
    label,
    value: formatCount(items.length),
    children: items.map(o => ({ label: o.name, value: `on ${o.table}` })),
  };
}

export function sqliteLabel(v: SqliteValue): string {
  return ['SQLite', plural(v.tables.length, 'table'), formatBytes(v.size)].join(' · ');
}

/** `load` provides sql.js: the worker passes its WASM URL, tests use the Node build. */
export function createSqliteInterpreter(
  load: () => Promise<SqlJsStatic>,
): Interpreter<SqliteValue> {
  return {
    kind: 'sqlite',
    isValue: (v): v is SqliteValue => hasKind(v, 'sqlite'),
    // Real detection is the cheap core detector in ./detect.ts; this runs only once loaded
    detect: c => (isSqlite(c) ? 0.98 : 0),
    async parse(c) {
      if (!isSqlite(c)) throw new Error('Not an SQLite database');
      return openDatabase(await load(), c.bytes);
    },
    label: sqliteLabel,
    summarise(v) {
      const tables = v.tables.map(tableInfo);
      return {
        stats: [
          {
            label: 'Tables',
            value: formatCount(v.tables.length),
            children: v.tables.map(t => ({
              label: t.name,
              value: `${rowCount(t)} · ${plural(t.columns.length, 'column')}`,
              children: t.columns.map(c => ({ label: c.name, value: columnType(c) })),
            })),
          },
          objectStats(v, 'view', 'Views'),
          objectStats(v, 'index', 'Indexes'),
          objectStats(v, 'trigger', 'Triggers'),
          { label: 'Page size', value: formatBytes(v.pageSize) },
          { label: 'Pages', value: formatCount(v.pageCount) },
          { label: 'Schema version', value: String(v.schemaVersion) },
          { label: 'User version', value: String(v.userVersion) },
          { label: 'Encoding', value: v.encoding },
        ],
        extent: tables[0]?.extent ?? 0,
        columns: tables[0]?.columns ?? [],
        tables,
      };
    },
    slice(v, req) {
      if (req.type === 'rows') return tableRows(v, req.table ?? 0, req.from, req.to);
      if (req.type === 'text') return schemaSql(v);
      if (req.type === 'count') return countRows(v, req.table);
      return unsupportedSlice('sqlite', req);
    },
    export: v => ({ text: schemaSql(v) }),
    derivations: v =>
      v.tables.map((t, i) => ({ id: `table:${i}`, label: `Table ${t.name} as CSV` })),
    derive(v, id) {
      const i = Number(id.slice('table:'.length));
      const t = tableAt(v, i);
      return {
        mime: 'text/csv',
        name: `${t.name}.csv`,
        bytes: new TextEncoder().encode(tableCsv(v, i)),
      };
    },
  };
}
