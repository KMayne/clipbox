import { css, cx } from '@emotion/css';
import {
  mdiChevronDown,
  mdiChevronRight,
  mdiClipboardArrowDownOutline,
  mdiClose,
  mdiContentPaste,
  mdiDeleteSweepOutline,
  mdiFileUploadOutline,
} from '@mdi/js';
import { Icon } from '@mdi/react';
import { openFile, readClipboard } from '../capture/sources';
import { formatBytes, formatCount, plural } from '../core/format';
import {
  isCollection,
  useCaptureStore,
  visibleEntries,
  type CaptureView,
} from '../state/captureStore';
import { useUiStore } from '../state/uiStore';
import { theme } from '../theme';
import { confirmClearAll } from '../commands';
import { moveSelection } from '../useGlobalShortcuts';
import { EntryRow } from './EntryRow';
import { ParentLink } from './ParentLink';
import { media, ui } from './ui';
import { useIsMobile } from './useMediaQuery';

const styles = {
  pane: css`
    display: flex;
    flex-direction: column;
    height: 100%;
    background: ${theme.panel};
    outline: none;
  `,
  heading: css`
    display: flex;
    align-items: center;
    gap: 2px;
    min-height: 32px;
    padding: 2px 6px 2px 10px;
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: 0.06em;
    color: ${theme.muted};
    border-bottom: 1px solid ${theme.subtle};
    & > span:first-child {
      margin-right: auto;
    }
  `,
  tools: css`
    display: flex;
    gap: 2px;
    & > button {
      padding: 4px;
    }
    & > button:disabled {
      opacity: 0.4;
      cursor: default;
    }
    ${media.mobile} {
      & > button {
        min-width: 40px;
        min-height: 40px;
        justify-content: center;
        align-items: center;
      }
    }
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
    /* No hover on touch screens */
    ${media.touch} {
      min-height: 44px;
      & > .remove {
        visibility: visible;
      }
    }
  `,
  selectedHeader: css`
    background: ${theme.accentSoft};
    &:hover {
      background: ${theme.accentSoft};
    }
  `,
  count: css`
    white-space: nowrap;
  `,
  more: css`
    display: block;
    width: 100%;
    padding: 4px 8px 6px 24px;
    background: none;
    border: none;
    color: ${theme.muted};
    text-align: left;
    font-size: var(--text-sm);
    cursor: pointer;
    &:hover {
      color: ${theme.text};
      text-decoration: underline;
    }
  `,
  /** Phones have no Ctrl+V: offer the clipboard and files directly. */
  start: css`
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 32px 16px;
    color: ${theme.muted};
    text-align: center;
    & > button {
      min-width: 200px;
      justify-content: center;
    }
  `,
};

/** Captures with more entries than this list them as compact one-line rows. */
const COMPACT_FROM = 4;

const time = (at: number) => new Date(at).toLocaleTimeString('en-GB');

/** Moves focus into the collection grid if one is shown (Enter on a selected collection). */
function focusCollectionGrid(): boolean {
  if (!useCaptureStore.getState().collection) return false;
  const tile = document.querySelector<HTMLElement>(
    '[data-testid=collection-grid] [data-testid=tile][tabindex="0"]',
  );
  tile?.focus();
  return tile !== null;
}

export function PastesPane() {
  const captures = useCaptureStore(s => s.captures);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      moveSelection(e.key === 'ArrowDown' ? 1 : -1);
    } else if (
      (e.key === 'Enter' || e.key === 'ArrowRight') &&
      e.target === e.currentTarget &&
      focusCollectionGrid()
    ) {
      e.preventDefault();
    }
  };

  return (
    <section className={styles.pane} tabIndex={0} onKeyDown={onKeyDown} aria-label="Pastes">
      <div className={styles.heading}>
        <span>PASTES</span>
        <span className={styles.tools} role="toolbar" aria-label="Pastes">
          <button
            className={ui.iconButton}
            title="Paste from the clipboard (Ctrl+V)"
            aria-label="Read clipboard"
            onClick={() => void readClipboard()}
          >
            <Icon path={mdiContentPaste} size={0.7} />
          </button>
          <button
            className={ui.iconButton}
            title="Open file (Ctrl+O)"
            aria-label="Open file"
            onClick={openFile}
          >
            <Icon path={mdiFileUploadOutline} size={0.7} />
          </button>
          <button
            className={ui.iconButton}
            title="Clear all pastes"
            aria-label="Clear all"
            disabled={captures.length === 0}
            onClick={confirmClearAll}
          >
            <Icon path={mdiDeleteSweepOutline} size={0.7} />
          </button>
        </span>
      </div>
      <div className={styles.list}>
        {captures.length === 0 && <EmptyPastes />}
        {captures.map(c => (
          <CaptureItem key={c.id} capture={c} />
        ))}
      </div>
    </section>
  );
}

function EmptyPastes() {
  const mobile = useIsMobile();
  if (!mobile) return <div className={ui.empty}>Paste (Ctrl+V) or drop a file to start</div>;
  return (
    <div className={styles.start}>
      Nothing here yet. Copy something, then:
      <button className={`${ui.button} ${ui.primary}`} onClick={() => void readClipboard()}>
        <Icon path={mdiClipboardArrowDownOutline} size={0.8} />
        Read clipboard
      </button>
      <button className={ui.button} onClick={openFile}>
        <Icon path={mdiFileUploadOutline} size={0.8} />
        Open file
      </button>
      <span>You can also share text, links and files to Clipbox once it's installed.</span>
    </div>
  );
}

function CaptureItem({ capture }: { capture: CaptureView }) {
  const toggle = useCaptureStore(s => s.toggle);
  const remove = useCaptureStore(s => s.remove);
  const showAll = useCaptureStore(s => s.showAll);
  const selected = useCaptureStore(s => s.collection === capture.id);
  const n = capture.entries.length;
  const collection = isCollection(capture);
  const shown = visibleEntries(capture);
  const hidden = capture.collapsed ? 0 : n - shown.length;
  const compact = n > COMPACT_FROM;
  const total = capture.entries.reduce((sum, e) => sum + e.size, 0);
  return (
    <div className={styles.capture} data-testid="capture">
      <div
        className={cx(styles.header, selected && styles.selectedHeader)}
        data-testid="capture-header"
        aria-current={selected || undefined}
        title={collection ? 'Show as a collection' : undefined}
        onClick={() => {
          if (!collection) return toggle(capture.id);
          useCaptureStore.getState().selectCollection(capture.id);
          useUiStore.getState().showPane('inspector');
        }}
      >
        <button
          className={ui.iconButton}
          aria-label={capture.collapsed ? 'Expand' : 'Collapse'}
          aria-expanded={!capture.collapsed}
          onClick={e => {
            e.stopPropagation();
            toggle(capture.id);
          }}
        >
          <Icon path={capture.collapsed ? mdiChevronRight : mdiChevronDown} size={0.7} />
        </button>
        <span>{time(capture.at)}</span>
        <span className={ui.muted}>·</span>
        {capture.parent ? (
          <>
            <ParentLink parent={capture.parent} />
            {collection && (
              <span className={cx(ui.muted, styles.count)} data-testid="capture-count">
                · {plural(n, 'item')}
              </span>
            )}
          </>
        ) : (
          <span className={ui.muted} data-testid="capture-count">
            {capture.source} · {countLabel(capture.source, n)}
          </span>
        )}
        {collection && <span className={cx(ui.muted, styles.count)}>· {formatBytes(total)}</span>}
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
      {shown.map(e => (
        <EntryRow key={e.id} entry={e} compact={compact} />
      ))}
      {hidden > 0 && (
        <button className={styles.more} data-testid="show-all" onClick={() => showAll(capture.id)}>
          Show all {formatCount(n)} ({formatCount(hidden)} more)
        </button>
      )}
    </div>
  );
}

/**
 * Pastes hold one entry per clipboard format; drops and derived captures hold files; shares hold
 * text, a link and files.
 */
const countLabel = (source: CaptureView['source'], n: number) => {
  switch (source) {
    case 'paste':
    case 'read':
      return plural(n, 'format');
    case 'share':
      return plural(n, 'item');
    case 'drop':
    case 'file':
    case 'derived':
      return plural(n, 'file');
  }
};
