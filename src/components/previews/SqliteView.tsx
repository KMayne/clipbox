import { css, cx } from '@emotion/css';
import { useEffect, useMemo, useState } from 'react';
import { formatCount } from '../../core/format';
import type { TableInfo, ValueHandle } from '../../core/types';
import { theme } from '../../theme';
import { ModulePreview } from '../ModulePreview';
import { ui } from '../ui';
import { useAsync } from '../useAsync';
import { RecordsTable } from './RecordsTable';
import { preview } from './styles';
import { tableHandle } from './tableHandle';

const styles = {
  layout: css`
    position: absolute;
    inset: 0;
    display: flex;
  `,
  list: css`
    flex: none;
    width: 200px;
    overflow-y: auto;
    padding: 4px 0;
    border-right: 1px solid ${theme.subtle};
  `,
  item: css`
    display: flex;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    padding: 4px 10px;
    background: none;
    border: none;
    color: ${theme.text};
    text-align: left;
    cursor: pointer;
    &:hover {
      background: ${theme.hover};
    }
  `,
  selected: css`
    background: ${theme.raised};
    box-shadow: inset 2px 0 ${theme.accent};
  `,
  name: css`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  count: css`
    color: ${theme.muted};
    font-size: var(--text-xs);
  `,
  main: css`
    position: relative;
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  `,
  schema: css`
    flex: none;
    border-top: 1px solid ${theme.subtle};
    summary {
      padding: 6px 12px;
      cursor: pointer;
      color: ${theme.muted};
    }
  `,
  sqlBox: css`
    position: relative;
    height: 220px;
  `,
  pre: css`
    position: absolute;
    inset: 0;
    margin: 0;
    padding: 8px 12px;
    overflow: auto;
  `,
};

function SchemaSql({ handle }: { handle: ValueHandle }) {
  const sql = useAsync('schema', () => handle.text());
  // The editor module's text preview reads `text()` and highlights per `summary.language`
  const sqlHandle = useMemo(
    (): ValueHandle => ({
      ...handle,
      summary: { ...handle.summary, kind: 'text', language: 'sql' },
    }),
    [handle],
  );
  const text = sql.status === 'ok' ? sql.value : '';
  return (
    <div className={styles.sqlBox}>
      <ModulePreview
        module="editor"
        kind="text"
        handle={sqlHandle}
        fallback={<pre className={cx(styles.pre, ui.mono)}>{text}</pre>}
      />
    </div>
  );
}

type Count = number | { error: string };

/** List label for a table: exact count, "~n" estimate, or "—" if not counted yet. */
function countLabel(t: TableInfo, count: Count | undefined): string {
  if (typeof count === 'number') return formatCount(count);
  if (count) return '!';
  if (t.exact !== false) return formatCount(t.extent);
  return t.extent > 0 ? `~${formatCount(t.extent)}` : '—';
}

/**
 * Table list on the left; the selected table's rows (read with LIMIT/OFFSET) on the right.
 * Row counts aren't computed when the database opens (a full scan per table); the selected
 * table is counted on demand, once.
 */
export function SqliteView({ handle }: { handle: ValueHandle }) {
  const tables = handle.summary.tables ?? [];
  const [active, setActive] = useState(0);
  const [schemaOpen, setSchemaOpen] = useState(false);
  const [counts, setCounts] = useState<ReadonlyMap<number, Count>>(new Map());
  const table = tables[active];
  const count = counts.get(active);
  const needsCount = table !== undefined && table.exact === false && count === undefined;

  useEffect(() => {
    if (!needsCount) return;
    let live = true;
    handle.count(active).then(
      n => live && setCounts(prev => new Map(prev).set(active, n)),
      (err: unknown) =>
        live && setCounts(prev => new Map(prev).set(active, { error: String(err) })),
    );
    return () => {
      live = false;
    };
  }, [handle, active, needsCount]);

  const view = useMemo(() => {
    if (!table) return null;
    if (table.exact !== false) return tableHandle(handle, active, table);
    if (typeof count !== 'number') return null;
    return tableHandle(handle, active, { ...table, extent: count, exact: true });
  }, [handle, active, table, count]);

  return (
    <div className={styles.layout}>
      <nav className={styles.list} aria-label="Tables">
        {tables.map((t, i) => (
          <button
            key={i}
            className={cx(styles.item, i === active && styles.selected)}
            aria-pressed={i === active}
            onClick={() => setActive(i)}
          >
            <span className={styles.name}>{t.name}</span>
            <span className={styles.count}>{countLabel(t, counts.get(i))}</span>
          </button>
        ))}
        {tables.length === 0 && <div className={ui.empty}>No tables</div>}
      </nav>
      <div className={styles.main}>
        <div className={preview.fill}>
          {view ? (
            <RecordsTable key={active} handle={view} />
          ) : typeof count === 'object' ? (
            <div className={ui.empty}>Couldn't read this table: {count.error}</div>
          ) : (
            table && <div className={ui.empty}>Counting rows…</div>
          )}
        </div>
        <details
          className={styles.schema}
          open={schemaOpen}
          onToggle={e => setSchemaOpen(e.currentTarget.open)}
        >
          <summary>Schema SQL</summary>
          {schemaOpen && <SchemaSql handle={handle} />}
        </details>
      </div>
    </div>
  );
}
