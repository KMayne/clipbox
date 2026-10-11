import { css, cx } from '@emotion/css';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useRef } from 'react';
import type { ValueHandle } from '../../core/types';
import { useUiStore } from '../../state/uiStore';
import { theme } from '../../theme';
import { useChunks } from '../useChunks';
import { preview } from './styles';

const ROW = 18;

const styles = {
  line: css`
    position: absolute;
    left: 0;
    width: 100%;
    display: flex;
    line-height: ${ROW}px;
  `,
  gutter: css`
    flex: none;
    padding: 0 10px 0 12px;
    text-align: right;
    color: ${theme.faint};
    user-select: none;
    border-right: 1px solid ${theme.subtle};
  `,
  text: css`
    padding: 0 12px;
    white-space: pre;
  `,
  wrap: css`
    white-space: pre-wrap;
    word-break: break-all;
    min-width: 0;
  `,
};

export function TextView({ handle }: { handle: ValueHandle }) {
  const wrap = useUiStore(s => s.wrap);
  const count = handle.summary.extent;
  const parentRef = useRef<HTMLDivElement>(null);
  const { ensure, get } = useChunks(handle.lines);
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW,
    overscan: 20,
  });
  const items = virtualizer.getVirtualItems();
  const first = items[0]?.index ?? 0;
  const last = items.at(-1)?.index ?? 0;
  useEffect(() => ensure(first, last), [ensure, first, last]);
  const gutter = `${String(count).length + 1}ch`;

  return (
    <div ref={parentRef} className={preview.scroller} data-testid="text-view">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative', minWidth: '100%' }}>
        {items.map(item => (
          <div
            key={item.key}
            data-index={item.index}
            ref={wrap ? virtualizer.measureElement : undefined}
            className={styles.line}
            style={{ transform: `translateY(${item.start}px)` }}
          >
            <span className={styles.gutter} style={{ width: gutter }}>
              {item.index + 1}
            </span>
            <span className={cx(styles.text, wrap && styles.wrap)}>{get(item.index) ?? ''}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
