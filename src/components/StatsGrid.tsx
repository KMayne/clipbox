import { css } from '@emotion/css';
import type { StatRow } from '../core/types';
import { theme } from '../theme';

const styles = {
  wrap: css`
    height: 100%;
    overflow: auto;
    padding: 12px 16px;
  `,
  grid: css`
    display: grid;
    grid-template-columns: minmax(120px, max-content) 1fr;
    gap: 4px 24px;
    align-items: baseline;
  `,
  /** Narrow columns for the sidebar. */
  compact: css`
    padding: 4px 10px 10px;
    & [data-testid='stats'] {
      grid-template-columns: minmax(72px, 40%) 1fr;
      gap: 3px 10px;
      font-size: 12px;
    }
  `,
  label: css`
    color: ${theme.muted};
  `,
  value: css`
    font-family: ${theme.mono};
    font-size: 12px;
    word-break: break-word;
  `,
  nested: css`
    grid-column: 1 / -1;
    margin: 2px 0 8px 12px;
    padding-left: 12px;
    border-left: 1px solid ${theme.subtle};
  `,
};

export function StatsGrid({ rows, compact = false }: { rows: StatRow[]; compact?: boolean }) {
  return (
    <div className={compact ? styles.compact : styles.wrap}>
      <Grid rows={rows} />
    </div>
  );
}

function Grid({ rows }: { rows: StatRow[] }) {
  return (
    <div className={styles.grid} data-testid="stats">
      {rows.map((r, i) => (
        <Row key={`${r.label}-${i}`} row={r} />
      ))}
    </div>
  );
}

function Row({ row }: { row: StatRow }) {
  return (
    <>
      <span className={styles.label}>{row.label}</span>
      <span className={styles.value}>{row.value}</span>
      {row.children && row.children.length > 0 && (
        <div className={styles.nested}>
          <Grid rows={row.children} />
        </div>
      )}
    </>
  );
}
