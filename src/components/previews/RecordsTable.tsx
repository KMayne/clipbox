import { css } from '@emotion/css';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useRef } from 'react';
import type { ValueHandle } from '../../core/types';
import { theme } from '../../theme';
import { useChunks } from '../useChunks';
import { preview } from './styles';

const ROW = 24;
const COL_WIDTH = 160;
const INDEX_WIDTH = 56;

const styles = {
  header: css`
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    background: ${theme.panel};
    border-bottom: 1px solid ${theme.border};
  `,
  row: css`
    position: absolute;
    left: 0;
    display: flex;
    height: ${ROW}px;
    border-bottom: 1px solid #2c2c2c;
  `,
  cell: css`
    flex: none;
    padding: 0 8px;
    line-height: ${ROW}px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border-right: 1px solid #2c2c2c;
  `,
  headCell: css`
    display: flex;
    flex-direction: column;
    line-height: 1.3;
    padding: 4px 8px;
    font-family: ${theme.sans};
  `,
  type: css`
    color: ${theme.muted};
    font-size: 11px;
  `,
  index: css`
    color: #6a6a6a;
    text-align: right;
  `,
  null: css`
    color: #6a6a6a;
    font-style: italic;
  `,
};

function Cell({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className={styles.null}>null</span>;
  if (typeof value === 'object') return <>{JSON.stringify(value)}</>;
  return <>{String(value)}</>;
}

export function RecordsTable({ handle }: { handle: ValueHandle }) {
  const columns = handle.summary.columns ?? [];
  const parentRef = useRef<HTMLDivElement>(null);
  const { ensure, get } = useChunks<Record<string, unknown>>(handle, 'rows');
  const virtualizer = useVirtualizer({
    count: handle.summary.extent,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW,
    overscan: 20,
  });
  const items = virtualizer.getVirtualItems();
  const first = items[0]?.index ?? 0;
  const last = items.at(-1)?.index ?? 0;
  useEffect(() => ensure(first, last), [ensure, first, last]);
  const width = INDEX_WIDTH + columns.length * COL_WIDTH;

  return (
    <div ref={parentRef} className={preview.scroller} data-testid="records-table">
      <div className={styles.header} style={{ width }}>
        <span className={styles.cell} style={{ width: INDEX_WIDTH }} />
        {columns.map(c => (
          <span
            key={c.name}
            className={`${styles.cell} ${styles.headCell}`}
            style={{ width: COL_WIDTH }}
            title={c.name}
          >
            {c.name}
            <span className={styles.type}>{c.type}</span>
          </span>
        ))}
      </div>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width }}>
        {items.map(item => {
          const row = get(item.index);
          return (
            <div
              key={item.key}
              className={styles.row}
              style={{ transform: `translateY(${item.start}px)`, width }}
            >
              <span className={`${styles.cell} ${styles.index}`} style={{ width: INDEX_WIDTH }}>
                {item.index + 1}
              </span>
              {columns.map(c => (
                <span key={c.name} className={styles.cell} style={{ width: COL_WIDTH }}>
                  {row && <Cell value={row[c.name]} />}
                </span>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
