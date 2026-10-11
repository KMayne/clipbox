import { css } from '@emotion/css';
import { mdiContentCopy } from '@mdi/js';
import { Icon } from '@mdi/react';
import { z } from 'zod';
import type { CardData } from '../../core/smallValue';
import type { ValueHandle } from '../../core/types';
import { useUiStore } from '../../state/uiStore';
import { theme } from '../../theme';
import { ui } from '../ui';
import { useAsync } from '../useAsync';

const cardSchema: z.ZodType<CardData> = z.object({
  rows: z.array(z.object({ label: z.string(), value: z.string() })),
  swatch: z.string().optional(),
  table: z
    .object({ title: z.string(), columns: z.array(z.string()), rows: z.array(z.array(z.string())) })
    .optional(),
});

const styles = {
  wrap: css`
    position: absolute;
    inset: 0;
    overflow: auto;
    padding: 16px;
  `,
  swatch: css`
    width: 100%;
    max-width: 480px;
    height: 120px;
    margin-bottom: 16px;
    border: 1px solid ${theme.border};
    border-radius: 6px;
    /* checkerboard so alpha is visible */
    background-image:
      linear-gradient(45deg, #666 25%, transparent 25%),
      linear-gradient(-45deg, #666 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #666 75%),
      linear-gradient(-45deg, transparent 75%, #666 75%);
    background-size: 16px 16px;
    background-position:
      0 0,
      0 8px,
      8px -8px,
      -8px 0;
    background-color: #999;
  `,
  grid: css`
    display: grid;
    grid-template-columns: minmax(110px, max-content) 1fr auto;
    gap: 6px 16px;
    align-items: center;
  `,
  label: css`
    color: ${theme.muted};
  `,
  value: css`
    font-family: ${theme.mono};
    font-size: 13px;
    word-break: break-all;
    user-select: all;
  `,
  title: css`
    margin: 20px 0 6px;
    color: ${theme.muted};
    font-weight: 600;
  `,
  table: css`
    border-collapse: collapse;
    font-family: ${theme.mono};
    font-size: 12px;
    td,
    th {
      padding: 3px 12px 3px 0;
      text-align: left;
      border-bottom: 1px solid ${theme.subtle};
      word-break: break-all;
    }
    th {
      color: ${theme.muted};
      font-family: ${theme.sans};
      font-weight: normal;
    }
  `,
};

async function copy(text: string) {
  const { notify } = useUiStore.getState();
  try {
    await navigator.clipboard.writeText(text);
    notify('Copied');
  } catch (err) {
    notify(`Copy failed: ${String(err)}`, 'error');
  }
}

/** Labelled representations of a small value (timestamp, UUID, URL, colour), each copyable. */
export function ValueCard({ handle }: { handle: ValueHandle }) {
  const key = `${handle.summary.kind}:${handle.summary.label}`;
  const data = useAsync(key, async () => cardSchema.parse(await handle.json()));
  if (data.status === 'loading') return <div className={ui.empty}>Loading…</div>;
  if (data.status === 'error') return <div className={ui.empty}>{data.error}</div>;
  const { rows, swatch, table } = data.value;
  return (
    <div className={styles.wrap} data-testid="value-card">
      {swatch && (
        <div className={styles.swatch}>
          <div style={{ background: swatch, width: '100%', height: '100%', borderRadius: 5 }} />
        </div>
      )}
      <div className={styles.grid}>
        {rows.map((r, i) => (
          <Row key={`${r.label}-${i}`} label={r.label} value={r.value} />
        ))}
      </div>
      {table && (
        <>
          <div className={styles.title}>{table.title}</div>
          <table className={styles.table} data-testid="value-card-table">
            <thead>
              <tr>
                {table.columns.map(c => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span className={styles.label}>{label}</span>
      <span className={styles.value} data-testid="card-value">
        {value}
      </span>
      <button
        className={ui.iconButton}
        title={`Copy ${label}`}
        aria-label={`Copy ${label}`}
        onClick={() => void copy(value)}
      >
        <Icon path={mdiContentCopy} size={0.6} />
      </button>
    </>
  );
}
