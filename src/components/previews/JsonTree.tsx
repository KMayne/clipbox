import { css } from '@emotion/css';
import { mdiChevronDown, mdiChevronRight } from '@mdi/js';
import { Icon } from '@mdi/react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JsonChild, JsonPath, ValueHandle } from '../../core/types';
import { theme } from '../../theme';
import { ui } from '../ui';
import { useAsync } from '../useAsync';
import { preview } from './styles';

const ROW = 20;
const PAGE = 500;
const AUTO_EXPAND_MAX = 20;

const TYPE_COLORS: Record<JsonChild['type'], string> = {
  string: '#98c379',
  number: '#d19a66',
  boolean: '#56b6c2',
  null: '#7f848e',
  object: theme.muted,
  array: theme.muted,
};

const styles = {
  row: css`
    position: absolute;
    left: 0;
    display: flex;
    align-items: center;
    gap: 4px;
    height: ${ROW}px;
    padding-right: 12px;
    white-space: pre;
    cursor: default;
    &:hover {
      background: ${theme.hover};
    }
  `,
  toggle: css`
    display: inline-flex;
    width: 16px;
    flex: none;
    color: ${theme.muted};
  `,
  key: css`
    color: #61afef;
  `,
  index: css`
    color: #7f848e;
  `,
  more: css`
    color: ${theme.accent};
    cursor: pointer;
    &:hover {
      text-decoration: underline;
    }
  `,
};

const keyOf = (p: JsonPath) => JSON.stringify(p);

interface Loaded {
  items: JsonChild[];
  total: number;
}

type Row =
  | { type: 'node'; path: JsonPath; child: JsonChild; depth: number }
  | { type: 'more'; path: JsonPath; depth: number; loaded: number; total: number };

export function JsonTree({ handle }: { handle: ValueHandle }) {
  const { schema } = handle.summary;
  if (schema?.t !== 'array' && schema?.t !== 'object') return <ScalarView handle={handle} />;
  return <Tree handle={handle} />;
}

function ScalarView({ handle }: { handle: ValueHandle }) {
  const value = useAsync('full', () => handle.getSlice({ type: 'full' }));
  return (
    <pre className={preview.scroller} style={{ margin: 0, padding: 12 }}>
      {value.status === 'ok' ? JSON.stringify(value.value, null, 2) : ''}
    </pre>
  );
}

function Tree({ handle }: { handle: ValueHandle }) {
  const [nodes, setNodes] = useState(() => new Map<string, Loaded>());
  /** Expanded paths → their child count. */
  const [expanded, setExpanded] = useState(() => new Map([[keyOf([]), handle.summary.extent]]));
  const [requested] = useState(() => new Set<string>());

  const load = useCallback(
    async (path: JsonPath, from: number, total: number) => {
      const items = await handle.getSlice({ type: 'children', path, from, to: from + PAGE });
      setNodes(prev => {
        const next = new Map(prev);
        const before = from > 0 ? (prev.get(keyOf(path))?.items ?? []) : [];
        next.set(keyOf(path), { items: [...before, ...items], total });
        return next;
      });
      if (path.length === 0 && total <= AUTO_EXPAND_MAX) {
        setExpanded(prev => {
          const next = new Map(prev);
          for (const c of items) if (c.childCount) next.set(keyOf([c.key]), c.childCount);
          return next;
        });
      }
    },
    [handle],
  );

  useEffect(() => {
    for (const [key, total] of expanded) {
      if (requested.has(key)) continue;
      requested.add(key);
      void load(JSON.parse(key) as JsonPath, 0, total);
    }
  }, [expanded, load, requested]);

  const toggle = (path: JsonPath, total: number) =>
    setExpanded(prev => {
      const next = new Map(prev);
      const key = keyOf(path);
      if (next.has(key)) next.delete(key);
      else next.set(key, total);
      return next;
    });

  const rows = useMemo(() => {
    const out: Row[] = [];
    const walk = (path: JsonPath, depth: number) => {
      const node = nodes.get(keyOf(path));
      if (!node) return;
      for (const child of node.items) {
        const childPath = [...path, child.key];
        out.push({ type: 'node', path: childPath, child, depth });
        if (child.childCount !== undefined && expanded.has(keyOf(childPath)))
          walk(childPath, depth + 1);
      }
      if (node.items.length < node.total) {
        out.push({ type: 'more', path, depth, loaded: node.items.length, total: node.total });
      }
    };
    walk([], 0);
    return out;
  }, [nodes, expanded]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW,
    overscan: 20,
  });

  if (handle.summary.extent === 0) {
    return <div className={ui.empty}>Empty {handle.summary.schema?.t}</div>;
  }

  return (
    <div ref={parentRef} className={preview.scroller} data-testid="json-tree">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative', minWidth: '100%' }}>
        {virtualizer.getVirtualItems().map(item => {
          const row = rows[item.index]!;
          const style = {
            transform: `translateY(${item.start}px)`,
            paddingLeft: 8 + row.depth * 16,
          };
          if (row.type === 'more') {
            return (
              <div key={item.key} className={styles.row} style={style}>
                <span className={styles.toggle} />
                <span
                  className={styles.more}
                  onClick={() => void load(row.path, row.loaded, row.total)}
                >
                  … {row.total - row.loaded} more
                </span>
              </div>
            );
          }
          const { child, path } = row;
          const container = child.childCount !== undefined;
          const open = expanded.has(keyOf(path));
          return (
            <div
              key={item.key}
              className={styles.row}
              style={style}
              onClick={() => container && toggle(path, child.childCount!)}
            >
              <span className={styles.toggle}>
                {container && <Icon path={open ? mdiChevronDown : mdiChevronRight} size={0.6} />}
              </span>
              {typeof child.key === 'number' ? (
                <span className={styles.index}>{child.key}</span>
              ) : (
                <span className={styles.key}>{child.key}</span>
              )}
              <span className={styles.index}>:</span>
              <span style={{ color: TYPE_COLORS[child.type] }}>{child.preview}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
