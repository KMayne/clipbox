/** The sqlite module's service, typed and checked without importing sql.js. */
import { isRecord } from '../../core/guards';

export interface SqliteService {
  /** Every row of the `table`-th table, keyed by column; blobs as `x'…'` hex literals. */
  tableRows(value: unknown, table: number): Record<string, unknown>[];
}

export const isSqliteService = (s: unknown): s is SqliteService =>
  isRecord(s) && typeof s.tableRows === 'function';
