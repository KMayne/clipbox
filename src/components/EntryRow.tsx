import { css, cx } from '@emotion/css';
import { formatBytes } from '../core/format';
import { kindName } from '../core/kinds';
import { moduleInfo } from '../modules/registry';
import { useUiStore } from '../state/uiStore';
import type { Interpretation } from '../core/types';
import { useCaptureStore, type EntryView } from '../state/captureStore';
import { kindColor, theme } from '../theme';
import { ui } from './ui';

const styles = {
  entry: css`
    padding: 4px 8px 6px 24px;
  `,
  meta: css`
    display: flex;
    align-items: baseline;
    gap: 6px;
    min-width: 0;
  `,
  mime: css`
    padding: 0 4px;
    border-radius: 3px;
    background: ${theme.raised};
    font-family: ${theme.mono};
    font-size: 11px;
    white-space: nowrap;
  `,
  name: css`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  preview: css`
    margin: 2px 0 4px;
    color: ${theme.muted};
    font-family: ${theme.mono};
    font-size: 11px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  `,
  thumb: css`
    display: block;
    max-height: 32px;
    max-width: 96px;
    margin: 4px 0;
    border: 1px solid ${theme.subtle};
  `,
  chips: css`
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  `,
  chip: css`
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 1px 8px;
    border: 1px solid ${theme.subtle};
    border-radius: 10px;
    background: none;
    font-size: 12px;
    cursor: pointer;
    &:hover {
      background: ${theme.hover};
    }
  `,
  inactive: css`
    opacity: 0.55;
    border-style: dashed;
  `,
  selected: css`
    border-color: ${theme.accent};
    background: rgba(78, 161, 255, 0.15);
  `,
  dot: css`
    width: 7px;
    height: 7px;
    border-radius: 50%;
  `,
  error: css`
    color: ${theme.error};
    font-size: 12px;
  `,
};

export function EntryRow({ entry }: { entry: EntryView }) {
  const ingest = useCaptureStore(s => s.ingest);
  return (
    <div className={styles.entry} data-testid="entry" data-mime={entry.mime}>
      <div className={styles.meta}>
        <span className={styles.mime}>{entry.mime}</span>
        {entry.name && <span className={styles.name}>{entry.name}</span>}
        <span className={ui.muted}>{formatBytes(entry.size)}</span>
      </div>
      {entry.thumbUrl ? (
        <img className={styles.thumb} src={entry.thumbUrl} alt="" />
      ) : (
        entry.preview && <div className={styles.preview}>{entry.preview}</div>
      )}
      {entry.status === 'pending' && <span className={ui.muted}>Analysing…</span>}
      {entry.status === 'error' && <span className={styles.error}>{entry.error}</span>}
      {entry.status === 'confirm' && (
        <button className={ui.button} onClick={() => void ingest(entry.id)}>
          Large entry ({formatBytes(entry.size)}) — analyse anyway
        </button>
      )}
      <div className={styles.chips}>
        {entry.interpretations.map(i => (
          <InterpretationChip key={i.kind} interpretation={i} />
        ))}
      </div>
    </div>
  );
}

function chipText(i: Interpretation): string {
  const name = kindName(i.kind);
  switch (i.status) {
    case 'ready':
      return i.label ?? name;
    case 'loading':
      return `${name} · …`;
    case 'off':
      return `${name} · module off`;
    case 'error':
      return `${name} · unavailable`;
  }
}

function InterpretationChip({ interpretation: i }: { interpretation: Interpretation }) {
  const selected = useCaptureStore(
    s => s.selection?.entryId === i.entryId && s.selection.kind === i.kind,
  );
  const select = useCaptureStore(s => s.select);
  const inactive = i.status === 'off' || i.status === 'error';
  const title =
    i.status === 'off'
      ? `${moduleInfo(i.module ?? '')?.title ?? i.module} is off — click to open Settings`
      : i.status === 'error'
        ? i.error
        : i.status === 'loading'
          ? `Loading ${moduleInfo(i.module ?? '')?.title ?? 'module'}…`
          : undefined;
  return (
    <button
      className={cx(styles.chip, selected && styles.selected, inactive && styles.inactive)}
      aria-pressed={selected}
      data-testid="chip"
      data-kind={i.kind}
      data-status={i.status}
      title={title}
      onClick={() =>
        i.status === 'off'
          ? useUiStore.getState().openSettings(i.module)
          : select({ entryId: i.entryId, kind: i.kind })
      }
    >
      <span className={styles.dot} style={{ background: kindColor(i.kind) }} />
      {chipText(i)}
    </button>
  );
}
