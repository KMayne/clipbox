import { isRecord } from '../../guards';
// Only the module's light types: sql.js stays in the module's chunks
import { isSqliteService } from '../../../modules/sqlite/types';
import { sqliteSchema, sqliteTableJson } from '../catalog/sqlite';
import { implement } from '../types';
import { pick } from './spreadsheet';
import { textResult, withExtension } from './util';

/** The plain-data fields of the sqlite module's value these actions read. */
interface SqliteInfo {
  kind: 'sqlite';
  tables: { name: string }[];
  objects: { type: string; name: string; sql: string | null }[];
}

const isSqliteInfo = (v: unknown): v is SqliteInfo =>
  isRecord(v) &&
  v.kind === 'sqlite' &&
  Array.isArray(v.tables) &&
  v.tables.every(t => isRecord(t) && typeof t.name === 'string') &&
  Array.isArray(v.objects) &&
  v.objects.every(
    o =>
      isRecord(o) &&
      typeof o.type === 'string' &&
      typeof o.name === 'string' &&
      (o.sql === null || typeof o.sql === 'string'),
  );

const ORDER = ['table', 'index', 'view', 'trigger'];
const rank = (type: string) => (ORDER.includes(type) ? ORDER.indexOf(type) : ORDER.length);

/**
 * The CREATE statements, tables first, then indexes, views and triggers (each in file order).
 * SQLite's own objects (sqlite_sequence, automatic indexes) are left out: they can't be created.
 */
export function schemaSql(objects: SqliteInfo['objects']): string {
  const statements = objects
    .map((o, i) => ({ ...o, i }))
    .filter(o => o.sql && !o.name.startsWith('sqlite_'))
    .sort((a, b) => rank(a.type) - rank(b.type) || a.i - b.i)
    .map(o => `${(o.sql ?? '').trim().replace(/;$/, '')};`);
  return statements.length ? `${statements.join('\n\n')}\n` : '';
}

export const sqliteImpls = [
  implement(sqliteTableJson, {
    value: isSqliteInfo,
    applies: ({ value }) => value.tables.length > 0,
    async run({ value }, { table }, ctx) {
      const i = pick(value.tables, table, 'table');
      const service = await ctx.service('sqlite', isSqliteService);
      if (!service) throw new Error("The SQLite module isn't available");
      const rows = service.tableRows(value, i);
      return textResult(
        `${JSON.stringify(rows, null, 2)}\n`,
        'application/json',
        `${value.tables[i]?.name ?? 'table'}.json`,
      );
    },
  }),
  implement(sqliteSchema, {
    value: isSqliteInfo,
    applies: ({ value }) => value.objects.some(o => o.sql),
    run: ({ value, content }) =>
      textResult(
        schemaSql(value.objects),
        'application/sql',
        withExtension(content.name, 'sql', 'schema'),
      ),
  }),
];
