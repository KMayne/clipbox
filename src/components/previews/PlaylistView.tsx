import { css, cx } from '@emotion/css';
import { useMemo, useState } from 'react';
import { formatCount } from '../../core/format';
import type { ValueHandle } from '../../core/types';
import { theme } from '../../theme';
import { ui } from '../ui';
import { RecordsTable } from './RecordsTable';
import { preview } from './styles';
import { tableHandle } from './tableHandle';

const styles = {
  facts: css`
    display: flex;
    flex-wrap: wrap;
    gap: 4px 16px;
    padding: 6px 12px;
    border-bottom: 1px solid ${theme.subtle};
    font-size: 12px;
  `,
  factLabel: css`
    color: ${theme.muted};
    margin-right: 4px;
  `,
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
  count: css`
    margin-left: 6px;
    color: ${theme.muted};
    font-size: 11px;
  `,
};

/** Stats shown above the table, when present (the rest stay in the Info section). */
const FACTS = [
  'Playlist type',
  'Total duration',
  'Target duration',
  'Encryption',
  'Discontinuities',
  'Partial segments',
  'Highest',
  'Renditions',
  'Title',
];

/**
 * A playlist's tables: variants (by bandwidth), renditions and I-frame streams for an HLS master
 * playlist, segments for a media playlist, tracks for a plain M3U, under a line of key facts.
 */
export function PlaylistView({ handle }: { handle: ValueHandle }) {
  const tables = handle.summary.tables ?? [];
  const [active, setActive] = useState(0);
  const table = tables[active];
  const view = useMemo(
    () => (table ? tableHandle(handle, active, table) : null),
    [handle, active, table],
  );
  const facts = FACTS.flatMap(label => {
    const stat = handle.summary.stats.find(s => s.label === label);
    return stat ? [stat] : [];
  });

  return (
    <div className={preview.column} data-testid="playlist-view">
      {facts.length > 0 && (
        <div className={styles.facts} data-testid="playlist-facts">
          {facts.map(f => (
            <span key={f.label}>
              <span className={styles.factLabel}>{f.label}</span>
              {f.value}
            </span>
          ))}
        </div>
      )}
      {tables.length > 1 && (
        <div className={styles.tabs} role="tablist" aria-label="Playlist tables">
          {tables.map((t, i) => (
            <button
              key={i}
              role="tab"
              aria-selected={i === active}
              className={cx(styles.tab, i === active && styles.active)}
              onClick={() => setActive(i)}
            >
              {t.name}
              <span className={styles.count}>{formatCount(t.extent)}</span>
            </button>
          ))}
        </div>
      )}
      <div className={preview.fill}>
        {view && view.summary.extent > 0 ? (
          <RecordsTable key={active} handle={view} />
        ) : (
          <div className={ui.empty}>No entries</div>
        )}
      </div>
    </div>
  );
}
