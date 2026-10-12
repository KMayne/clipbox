import { css } from '@emotion/css';
import type { EntryId } from '../core/types';
import { findEntry, useCaptureStore } from '../state/captureStore';
import { engine } from '../engine/engineClient';
import { theme } from '../theme';
import { HexDump } from './previews/HexView';
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
    font-size: var(--text-sm);
    white-space: pre-wrap;
    word-break: break-all;
  `,
};

/** The entry's original content: its text, or a hex dump when it isn't text. */
export function RawView({ entryId }: { entryId: EntryId }) {
  const raw = useAsync(entryId, () => engine.raw(entryId));
  const size = useCaptureStore(s => findEntry(s.captures, entryId)?.entry.size ?? 0);
  if (raw.status !== 'ok')
    return <div className={ui.empty}>{raw.status === 'error' ? raw.error : 'Loading…'}</div>;
  const { text, truncated } = raw.value;
  if (text === undefined) return <HexSource entryId={entryId} size={size} />;
  return (
    <div className={styles.wrap}>
      <pre className={styles.pre}>{text}</pre>
      {truncated && <p className={ui.muted}>Truncated at 100 KB</p>}
    </div>
  );
}

/** A paged hex dump of the entry's original bytes. */
export function HexSource({ entryId, size }: { entryId: EntryId; size?: number }) {
  const known = useCaptureStore(s => findEntry(s.captures, entryId)?.entry.size ?? 0);
  return (
    <HexDump id={entryId} size={size ?? known} read={(from, to) => readBytes(entryId, from, to)} />
  );
}

/** Bytes arriving from the worker are checked like any other worker value. */
async function readBytes(entryId: EntryId, from: number, to: number): Promise<Uint8Array> {
  const bytes: unknown = await engine.rawBytes(entryId, from, to);
  if (!(bytes instanceof Uint8Array)) throw new Error('Unexpected bytes from the engine');
  return bytes;
}
