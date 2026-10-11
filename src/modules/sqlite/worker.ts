import initSqlJs, { type SqlJsStatic } from 'sql.js';
// Imported as a URL so the build emits it and the modules manifest lists it under 'sqlite'
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';
import { register } from '../../core/interpreter';
import { createSqliteInterpreter, tableRows } from './sqlite';
import type { SqliteService } from './types';

let sql: Promise<SqlJsStatic> | null = null;
const load = () =>
  (sql ??= initSqlJs({ locateFile: () => wasmUrl }).catch((err: unknown) => {
    sql = null; // allow a retry, e.g. once back online
    throw err;
  }));

const sqliteInterpreter = createSqliteInterpreter(load);

export const interpreters = [register(sqliteInterpreter)];

/** Used by the core "Table as JSON" action through `ctx.service('sqlite', isSqliteService)`. */
export const service: SqliteService = {
  tableRows(value, table) {
    if (!sqliteInterpreter.isValue(value)) throw new Error('Not an SQLite value');
    return tableRows(value, table, 0, Infinity, false);
  },
};
