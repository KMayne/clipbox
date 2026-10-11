import { css, cx } from '@emotion/css';
import { useMemo, useState } from 'react';
import { formatCount } from '../../core/format';
import type { ValueHandle } from '../../core/types';
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
    font-size: 11px;
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

/** Table list on the left; the selected table's rows (read with LIMIT/OFFSET) on the right. */
export function SqliteView({ handle }: { handle: ValueHandle }) {
  const tables = handle.summary.tables ?? [];
  const [active, setActive] = useState(0);
  const [schemaOpen, setSchemaOpen] = useState(false);
  const table = tables[active];
  const view = useMemo(
    () => (table ? tableHandle(handle, active, table) : null),
    [handle, active, table],
  );

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
            <span className={styles.count}>{formatCount(t.extent)}</span>
          </button>
        ))}
        {tables.length === 0 && <div className={ui.empty}>No tables</div>}
      </nav>
      <div className={styles.main}>
        <div className={preview.fill}>{view && <RecordsTable key={active} handle={view} />}</div>
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
