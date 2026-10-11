import initSqlJs, { type SqlJsStatic } from 'sql.js';
// Imported as a URL so the build emits it and the modules manifest lists it under 'sqlite'
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';
import { register } from '../../core/interpreter';
import { createSqliteInterpreter } from './sqlite';

let sql: Promise<SqlJsStatic> | null = null;
const load = () =>
  (sql ??= initSqlJs({ locateFile: () => wasmUrl }).catch((err: unknown) => {
    sql = null; // allow a retry, e.g. once back online
    throw err;
  }));

export const interpreters = [register(createSqliteInterpreter(load))];
