import { css, cx } from '@emotion/css';
import { useMemo, useState } from 'react';
import type { ValueHandle } from '../../core/types';
import { theme } from '../../theme';
import { ui } from '../ui';
import { RecordsTable } from './RecordsTable';
import { preview } from './styles';
import { tableHandle } from './tableHandle';

const styles = {
  tabs: css`
    display: flex;
    gap: 2px;
    padding: 4px 8px 0;
    overflow-x: auto;
    border-bottom: 1px solid ${theme.subtle};
  `,
  tab: css`
    padding: 4px 10px;
    background: none;
    border: 1px solid transparent;
    border-bottom: none;
    border-radius: 4px 4px 0 0;
    color: ${theme.muted};
    cursor: pointer;
    white-space: nowrap;
    &:hover {
      color: ${theme.text};
    }
  `,
  active: css`
    color: ${theme.text};
    background: ${theme.panel};
    border-color: ${theme.subtle};
  `,
  dims: css`
    margin-left: 6px;
    color: ${theme.muted};
    font-size: 11px;
  `,
};

/** Sheet tabs over a records table of the selected sheet. */
export function SpreadsheetView({ handle }: { handle: ValueHandle }) {
  const tables = handle.summary.tables ?? [];
  const [active, setActive] = useState(0);
  const table = tables[active];
  const sheet = useMemo(
    () => (table ? tableHandle(handle, active, table) : null),
    [handle, active, table],
  );

  return (
    <div className={preview.column}>
      <div className={styles.tabs} role="tablist" aria-label="Sheets">
        {tables.map((t, i) => (
          <button
            key={i}
            role="tab"
            aria-selected={i === active}
            className={cx(styles.tab, i === active && styles.active)}
            onClick={() => setActive(i)}
          >
            {t.name}
            <span className={styles.dims}>
              {t.extent}×{t.columns.length}
            </span>
          </button>
        ))}
      </div>
      <div className={preview.fill}>
        {sheet && sheet.summary.columns?.length ? (
          <RecordsTable key={active} handle={sheet} />
        ) : (
          <div className={ui.empty}>Empty sheet</div>
        )}
      </div>
    </div>
  );
}
