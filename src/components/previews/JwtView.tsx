import { css, cx } from '@emotion/css';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { claimTime, jwtStatus, TIME_CLAIMS } from '../../core/interpreters/jwt';
import { formatRelative } from '../../core/time';
import type { ValueHandle } from '../../core/types';
import { theme } from '../../theme';
import { ui } from '../ui';
import { useAsync } from '../useAsync';
import { preview } from './styles';

// The json slice crosses the worker boundary as unknown; validate it
const tokenSchema = z.object({
  header: z.record(z.string(), z.unknown()),
  payload: z.record(z.string(), z.unknown()),
});

const styles = {
  wrap: css`
    padding: 12px 16px;
    font-family: ${theme.sans};
    font-size: 13px;
  `,
  badges: css`
    display: flex;
    gap: 8px;
    align-items: center;
    margin-bottom: 12px;
  `,
  badge: css`
    padding: 1px 8px;
    border-radius: 10px;
    font-size: 12px;
    font-weight: 600;
    color: #1e1e1e;
  `,
  expired: css`
    background: ${theme.error};
  `,
  pending: css`
    background: #e5c07b;
  `,
  valid: css`
    background: #98c379;
  `,
  table: css`
    border-collapse: collapse;
    margin-bottom: 16px;
    td {
      padding: 3px 16px 3px 0;
      vertical-align: top;
    }
    td:first-child {
      color: ${theme.muted};
      font-family: ${theme.mono};
      font-size: 12px;
    }
  `,
  value: css`
    font-family: ${theme.mono};
    font-size: 12px;
    word-break: break-all;
  `,
  heading: css`
    margin: 12px 0 4px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    color: ${theme.muted};
  `,
  pre: css`
    margin: 0;
    padding: 8px 10px;
    background: ${theme.panel};
    border: 1px solid ${theme.subtle};
    border-radius: 4px;
    font-family: ${theme.mono};
    font-size: 12px;
    white-space: pre-wrap;
    word-break: break-all;
  `,
};

/** Current time, refreshed periodically so relative times stay current. */
function useNow(intervalMs = 15_000): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

const isTimeClaim = (k: string) => TIME_CLAIMS.some(c => c === k);

function claimValue(payload: Record<string, unknown>, key: string, now: number): string {
  const at = isTimeClaim(key) ? claimTime(payload, key) : null;
  if (at !== null) return `${new Date(at).toLocaleString()} (${formatRelative(at, now)})`;
  const v = payload[key];
  return typeof v === 'string' ? v : JSON.stringify(v);
}

export function JwtView({ handle }: { handle: ValueHandle }) {
  const now = useNow();
  const token = useAsync('json', async () => tokenSchema.parse(await handle.json()));
  if (token.status === 'loading') return null;
  if (token.status === 'error') return <div className={ui.empty}>{token.error}</div>;
  const { header, payload } = token.value;
  const status = jwtStatus(payload, now);
  const exp = claimTime(payload, 'exp');
  const nbf = claimTime(payload, 'nbf');

  return (
    <div className={preview.scroller}>
      <div className={styles.wrap} data-testid="jwt-view">
        <div className={styles.badges}>
          {status === 'expired' && (
            <span className={cx(styles.badge, styles.expired)} data-testid="jwt-status">
              Expired{exp !== null && ` ${formatRelative(exp, now)}`}
            </span>
          )}
          {status === 'not yet valid' && (
            <span className={cx(styles.badge, styles.pending)} data-testid="jwt-status">
              Not yet valid{nbf !== null && ` · valid ${formatRelative(nbf, now)}`}
            </span>
          )}
          {status === 'valid' && (
            <span className={cx(styles.badge, styles.valid)} data-testid="jwt-status">
              Valid{exp !== null && ` · expires ${formatRelative(exp, now)}`}
            </span>
          )}
          <span className={ui.muted}>Signature not verified</span>
        </div>
        <div className={styles.heading}>CLAIMS</div>
        <table className={styles.table} data-testid="jwt-claims">
          <tbody>
            {Object.keys(payload).map(k => (
              <tr key={k}>
                <td>{k}</td>
                <td className={styles.value}>{claimValue(payload, k, now)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className={styles.heading}>HEADER</div>
        <pre className={styles.pre}>{JSON.stringify(header, null, 2)}</pre>
        <div className={styles.heading}>PAYLOAD</div>
        <pre className={styles.pre}>{JSON.stringify(payload, null, 2)}</pre>
      </div>
    </div>
  );
}
