import { css } from '@emotion/css';
import { mdiChevronDown, mdiChevronRight, mdiClose } from '@mdi/js';
import { Icon } from '@mdi/react';
import { useCaptureStore, type CaptureView } from '../state/captureStore';
import { theme } from '../theme';
import { moveSelection } from '../useGlobalShortcuts';
import { EntryRow } from './EntryRow';
import { ui } from './ui';

const styles = {
  pane: css`
    display: flex;
    flex-direction: column;
    height: 100%;
    background: ${theme.panel};
    outline: none;
  `,
  heading: css`
    padding: 8px 10px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    color: ${theme.muted};
  `,
  list: css`
    flex: 1;
    overflow-y: auto;
  `,
  capture: css`
    border-bottom: 1px solid ${theme.subtle};
  `,
  header: css`
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 6px;
    cursor: pointer;
    user-select: none;
    &:hover {
      background: ${theme.hover};
    }
    & > .remove {
      visibility: hidden;
      margin-left: auto;
    }
    &:hover > .remove {
      visibility: visible;
    }
  `,
  footer: css`
    padding: 8px 10px;
    border-top: 1px solid ${theme.subtle};
  `,
};

const time = (at: number) => new Date(at).toLocaleTimeString('en-GB');

export function PastesPane() {
  const captures = useCaptureStore(s => s.captures);
  const clear = useCaptureStore(s => s.clear);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      moveSelection(e.key === 'ArrowDown' ? 1 : -1);
    }
  };

  return (
    <section className={styles.pane} tabIndex={0} onKeyDown={onKeyDown} aria-label="Pastes">
      <div className={styles.heading}>PASTES</div>
      <div className={styles.list}>
        {captures.length === 0 && (
          <div className={ui.empty}>Paste (Ctrl+V) or drop a file to start</div>
        )}
        {captures.map(c => (
          <CaptureItem key={c.id} capture={c} />
        ))}
      </div>
      {captures.length > 0 && (
        <div className={styles.footer}>
          <button className={ui.button} onClick={clear}>
            Clear all
          </button>
        </div>
      )}
    </section>
  );
}

function CaptureItem({ capture }: { capture: CaptureView }) {
  const toggle = useCaptureStore(s => s.toggle);
  const remove = useCaptureStore(s => s.remove);
  const n = capture.entries.length;
  return (
    <div className={styles.capture} data-testid="capture">
      <div className={styles.header} onClick={() => toggle(capture.id)}>
        <Icon path={capture.collapsed ? mdiChevronRight : mdiChevronDown} size={0.7} />
        <span>{time(capture.at)}</span>
        <span className={ui.muted}>
          · {capture.source} · {n} format{n === 1 ? '' : 's'}
        </span>
        <button
          className={`${ui.iconButton} remove`}
          title="Remove"
          onClick={e => {
            e.stopPropagation();
            remove(capture.id);
          }}
        >
          <Icon path={mdiClose} size={0.6} />
        </button>
      </div>
      {!capture.collapsed && capture.entries.map(e => <EntryRow key={e.id} entry={e} />)}
    </div>
  );
}
