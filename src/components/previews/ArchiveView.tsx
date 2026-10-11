import { css } from '@emotion/css';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useRef } from 'react';
import { FORCE_PREFIX, GUARD_MESSAGE } from '../../core/archive/types';
import { formatBytes } from '../../core/format';
import type { ValueHandle } from '../../core/types';
import { useCaptureStore, type Selection } from '../../state/captureStore';
import { useUiStore } from '../../state/uiStore';
import { theme } from '../../theme';
import { ui } from '../ui';
import { useChunks } from '../useChunks';
import { preview } from './styles';

const ROW = 26;
const COLUMNS = [
  { key: 'size', label: 'Size', width: 90 },
  { key: 'compressed', label: 'Compressed', width: 100 },
  { key: 'modified', label: 'Modified', width: 170 },
  { key: 'action', label: '', width: 70 },
] as const;
const FIXED = COLUMNS.reduce((n, c) => n + c.width, 0);

const styles = {
  header: css`
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    background: ${theme.panel};
    border-bottom: 1px solid ${theme.border};
    font-family: ${theme.sans};
  `,
  row: css`
    position: absolute;
    left: 0;
    right: 0;
    display: flex;
    height: ${ROW}px;
    border-bottom: 1px solid #2c2c2c;
    &:hover {
      background: ${theme.hover};
    }
  `,
  cell: css`
    flex: none;
    padding: 0 8px;
    line-height: ${ROW}px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  path: css`
    flex: 1;
    min-width: 200px;
  `,
  num: css`
    text-align: right;
  `,
  dir: css`
    color: ${theme.muted};
  `,
  open: css`
    padding: 0 6px;
    font-size: 11px;
  `,
  note: css`
    padding: 16px;
    color: ${theme.muted};
    font-family: ${theme.sans};
  `,
};

interface Row {
  path: string;
  size: number;
  compressedSize: number | null;
  modified: string | null;
  isDir: boolean;
}

function toRow(r: Record<string, unknown>): Row | null {
  const { path, size, compressedSize, modified, isDir } = r;
  if (typeof path !== 'string' || typeof size !== 'number') return null;
  return {
    path,
    size,
    compressedSize: typeof compressedSize === 'number' ? compressedSize : null,
    modified: typeof modified === 'string' ? modified : null,
    isDir: isDir === true,
  };
}

/** Opens an entry as a derived capture; a size/ratio guard offers "Extract anyway". */
async function openArchiveEntry(selection: Selection, path: string, force = false) {
  const { derive } = useCaptureStore.getState();
  const { notify } = useUiStore.getState();
  try {
    await derive(selection, { id: force ? FORCE_PREFIX + path : path, label: path });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!force && message.includes(GUARD_MESSAGE)) {
      notify(message, 'error', {
        label: 'Extract anyway',
        run: () => void openArchiveEntry(selection, path, true),
      });
    } else {
      notify(`Opening ${path} failed: ${message}`, 'error');
    }
  }
}

export function ArchiveView({ handle }: { handle: ValueHandle }) {
  const selection = useCaptureStore(s => s.selection);
  const parentRef = useRef<HTMLDivElement>(null);
  const { ensure, get } = useChunks(handle.rows);
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

  if (handle.summary.extent === 0) {
    const note = handle.summary.stats.find(s => s.label === 'Note')?.value;
    return <div className={styles.note}>{note ?? 'The archive is empty.'}</div>;
  }

  return (
    <div ref={parentRef} className={preview.scroller} data-testid="archive-table">
      <div className={styles.header} style={{ minWidth: 200 + FIXED }}>
        <span className={`${styles.cell} ${styles.path}`}>Path</span>
        {COLUMNS.map(c => (
          <span
            key={c.key}
            className={`${styles.cell} ${c.key === 'modified' || c.key === 'action' ? '' : styles.num}`}
            style={{ width: c.width }}
          >
            {c.label}
          </span>
        ))}
      </div>
      <div
        style={{ height: virtualizer.getTotalSize(), position: 'relative', minWidth: 200 + FIXED }}
      >
        {items.map(item => {
          const raw = get(item.index);
          const row = raw ? toRow(raw) : null;
          return (
            <div
              key={item.key}
              className={styles.row}
              style={{ transform: `translateY(${item.start}px)` }}
              data-testid="archive-row"
            >
              <span
                className={`${styles.cell} ${styles.path} ${row?.isDir ? styles.dir : ''}`}
                title={row?.path}
              >
                {row?.path}
              </span>
              <span className={`${styles.cell} ${styles.num}`} style={{ width: 90 }}>
                {row && !row.isDir ? formatBytes(row.size) : ''}
              </span>
              <span className={`${styles.cell} ${styles.num}`} style={{ width: 100 }}>
                {row?.compressedSize != null && !row.isDir ? formatBytes(row.compressedSize) : ''}
              </span>
              <span className={styles.cell} style={{ width: 170 }}>
                {row?.modified?.replace('T', ' ') ?? ''}
              </span>
              <span className={styles.cell} style={{ width: 70 }}>
                {row && !row.isDir && selection && (
                  <button
                    className={`${ui.button} ${styles.open}`}
                    aria-label={`Open ${row.path}`}
                    onClick={() => void openArchiveEntry(selection, row.path)}
                  >
                    Open
                  </button>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
