import { css } from '@emotion/css';
import type { EntryId } from '../core/types';
import { engine } from '../engine/engineClient';
import { theme } from '../theme';
import { ui } from './ui';
import { useAsync } from './useAsync';

const styles = {
  wrap: css`
    height: 100%;
    overflow: auto;
    padding: 12px 16px;
  `,
  pre: css`
    margin: 0;
    font-family: ${theme.mono};
    font-size: 12px;
    white-space: pre-wrap;
    word-break: break-all;
  `,
};

export function RawView({ entryId }: { entryId: EntryId }) {
  const raw = useAsync(entryId, () => engine.raw(entryId));
  if (raw.status !== 'ok')
    return <div className={ui.empty}>{raw.status === 'error' ? raw.error : 'Loading…'}</div>;
  const { text, base64, truncated } = raw.value;
  return (
    <div className={styles.wrap}>
      {base64 !== undefined && <p className={ui.muted}>Binary content, shown as base64</p>}
      <pre className={styles.pre}>{text ?? base64}</pre>
      {truncated && <p className={ui.muted}>Truncated at 100 KB</p>}
    </div>
  );
}
