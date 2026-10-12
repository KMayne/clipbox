import { css, cx } from '@emotion/css';
import { useMemo } from 'react';
import { formatBytes, formatCount } from '../../core/format';
import type { ValueHandle } from '../../core/types';
import { wasmLayoutSchema, type WasmLayout } from '../../core/wasm/types';
import type { Selection } from '../../state/captureStore';
import { tableIndexFor, useUiStore } from '../../state/uiStore';
import { theme } from '../../theme';
import { ui } from '../ui';
import { useAsync } from '../useAsync';
import { RecordsTable } from './RecordsTable';
import { preview } from './styles';
import { tableHandle } from './tableHandle';

/** Sections shown as bars before "and N more". */
const MAX_BARS = 24;

const styles = {
  top: css`
    flex: none;
    max-height: 50%;
    overflow: auto;
    padding: 12px 16px 8px;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    align-items: start;
    gap: 10px 16px;
    font-family: ${theme.sans};
    font-size: var(--text-base);
    border-bottom: 1px solid ${theme.subtle};
  `,
  card: css`
    padding: 10px 14px;
    background: ${theme.panel};
    border: 1px solid ${theme.border};
    border-radius: 6px;
  `,
  title: css`
    margin: 0;
    font-size: var(--text-lg);
    font-weight: 600;
    color: ${theme.text};
    overflow-wrap: anywhere;
  `,
  sub: css`
    color: ${theme.muted};
  `,
  badges: css`
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 6px;
  `,
  badge: css`
    padding: 0 6px;
    border: 1px solid ${theme.accent};
    border-radius: 3px;
    font-size: var(--text-xs);
    line-height: calc(18px * var(--font-scale));
    color: ${theme.accent};
    white-space: nowrap;
  `,
  facts: css`
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 4px 18px;
    margin: 10px 0 0;
    div {
      display: flex;
      gap: 8px;
      min-width: 0;
    }
    dt {
      flex: none;
      color: ${theme.muted};
    }
    dd {
      margin: 0;
      font-family: ${theme.mono};
      font-size: var(--text-sm);
      overflow-wrap: anywhere;
    }
  `,
  bars: css`
    display: grid;
    grid-template-columns: minmax(80px, max-content) 1fr auto;
    align-items: center;
    gap: 2px 10px;
    font-size: var(--text-sm);
  `,
  barName: css`
    font-family: ${theme.mono};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  track: css`
    height: 8px;
    background: ${theme.subtle};
    border-radius: 2px;
    overflow: hidden;
    > span {
      display: block;
      height: 100%;
      min-width: 1px;
    }
  `,
  size: css`
    color: ${theme.muted};
    text-align: right;
    font-variant-numeric: tabular-nums;
  `,
  warnings: css`
    grid-column: 1 / -1;
    margin: 0;
    padding-left: 18px;
    color: ${theme.warning};
  `,
  tabs: css`
    flex: none;
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
    font-size: var(--text-xs);
  `,
};

/** A section's bar colour: code, data and custom sections stand apart. */
function barColour(s: WasmLayout['sections'][number]) {
  if (s.custom) return theme.faint;
  if (s.name === 'code') return theme.accent;
  if (s.name === 'data') return theme.success;
  return theme.warning;
}

/** WebAssembly module: facts and section sizes above tabs of imports, exports, functions and sections. */
export function WasmView({ handle, selection }: { handle: ValueHandle; selection: Selection }) {
  const layout = useAsync(`wasm-layout:${selection.entryId}`, async () =>
    wasmLayoutSchema.parse(await handle.json()),
  );
  const tables = handle.summary.tables ?? [];
  const { entryId, kind } = selection;
  const active = useUiStore(s => tableIndexFor(s.activeTable, entryId, kind));
  const setActiveTable = useUiStore(s => s.setActiveTable);
  const table = tables[active];
  const single = useMemo(
    () => (table ? tableHandle(handle, active, table) : null),
    [handle, active, table],
  );

  return (
    <div className={preview.column} data-testid="wasm-view">
      <div className={styles.top}>
        {layout.status === 'loading' && <div className={ui.muted}>Loading…</div>}
        {layout.status === 'error' && <div className={ui.muted}>{layout.error}</div>}
        {layout.status === 'ok' && <Overview layout={layout.value} />}
      </div>
      <div className={styles.tabs} role="tablist" aria-label="Tables">
        {tables.map((t, i) => (
          <button
            key={t.name}
            role="tab"
            aria-selected={i === active}
            className={cx(styles.tab, i === active && styles.active)}
            onClick={() => setActiveTable({ entryId, kind, index: i })}
          >
            {t.name}
            <span className={styles.count}>{formatCount(t.extent)}</span>
          </button>
        ))}
      </div>
      <div className={preview.fill}>
        {single && single.summary.extent > 0 ? (
          <RecordsTable key={active} handle={single} />
        ) : (
          <div className={ui.empty}>Nothing here</div>
        )}
      </div>
    </div>
  );
}

function Overview({ layout: l }: { layout: WasmLayout }) {
  const bars = [...l.sections].sort((a, b) => b.size - a.size).slice(0, MAX_BARS);
  const largest = bars[0]?.size ?? 0;
  return (
    <>
      <div className={styles.card} data-testid="wasm-header">
        <h3 className={styles.title}>{l.title}</h3>
        <div className={styles.sub}>
          {l.format} · {formatBytes(l.size)}
        </div>
        {l.badges.length > 0 && (
          <div className={styles.badges}>
            {l.badges.map(b => (
              <span key={b} className={styles.badge}>
                {b}
              </span>
            ))}
          </div>
        )}
        <dl className={styles.facts}>
          {l.facts.map((f, i) => (
            <div key={`${f.label}-${i}`}>
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
      </div>
      {bars.length > 0 && (
        <div className={styles.bars} aria-label="Section sizes" data-testid="wasm-sections">
          {bars.map((s, i) => (
            <SectionBar key={i} section={s} largest={largest} total={l.size} />
          ))}
          {l.sections.length > bars.length && (
            <div className={ui.muted}>and {formatCount(l.sections.length - bars.length)} more</div>
          )}
        </div>
      )}
      {l.warnings.length > 0 && (
        <ul className={styles.warnings}>
          {l.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
    </>
  );
}

function SectionBar({
  section: s,
  largest,
  total,
}: {
  section: WasmLayout['sections'][number];
  largest: number;
  total: number;
}) {
  const share = total > 0 ? Math.round((s.size / total) * 100) : 0;
  return (
    <>
      <span className={styles.barName} title={s.custom ? `Custom section ${s.name}` : s.name}>
        {s.name}
      </span>
      <span className={styles.track} aria-hidden>
        <span
          style={{
            width: `${largest > 0 ? (s.size / largest) * 100 : 0}%`,
            background: barColour(s),
          }}
        />
      </span>
      <span className={styles.size}>
        {formatBytes(s.size)} · {share}%
      </span>
    </>
  );
}
