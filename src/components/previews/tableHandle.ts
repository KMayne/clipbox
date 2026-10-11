import type { TableInfo, ValueHandle } from '../../core/types';

/**
 * A view of one table of a multi-table value (see `Summary.tables`) as a single-table handle,
 * so `RecordsTable` can show it unchanged.
 */
export function tableHandle(handle: ValueHandle, index: number, table: TableInfo): ValueHandle {
  return {
    ...handle,
    summary: { ...handle.summary, extent: table.extent, columns: table.columns },
    rows: (from, to) => handle.rows(from, to, index),
  };
}
