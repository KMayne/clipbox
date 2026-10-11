import { css, cx } from '@emotion/css';
import { mdiArrowTopRight, mdiChevronDown, mdiChevronRight, mdiClose, mdiGithub } from '@mdi/js';
import { Icon } from '@mdi/react';
import { formatBytes, formatCount, plural } from '../core/format';
import {
  isCollection,
  useCaptureStore,
  visibleEntries,
  type CaptureView,
} from '../state/captureStore';
import { theme } from '../theme';
import { moveSelection } from '../useGlobalShortcuts';
import { EntryRow } from './EntryRow';
import { ParentLink } from './ParentLink';
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
    font-size: 12px;
    cursor: pointer;
    &:hover {
      color: ${theme.text};
      text-decoration: underline;
    }
  `,
  links: css`
    margin-left: auto;
    display: flex;
    gap: 10px;
  `,
  credit: css`
    display: inline-flex;
    align-items: center;
    gap: 2px;
    font-size: 11px;
    /* Subtle but at least 4.5:1 against the panel in every scheme. */
    color: color-mix(in srgb, ${theme.muted}, ${theme.text} 30%);
    text-decoration: none;
    &:hover {
      color: ${theme.text};
      text-decoration: underline;
    }
  `,
  footer: css`
    display: flex;
    align-items: center;
    min-height: 44px;
    padding: 8px 10px;
    border-top: 1px solid ${theme.subtle};
  `,
};

/** Captures with more entries than this list them as compact one-line rows. */
const COMPACT_FROM = 4;

const time = (at: number) => new Date(at).toLocaleTimeString('en-GB');

/** The author's site: its root when deployed under a subpath (e.g. /clipbox/), else the live URL. */
const SITE_URL = import.meta.env.BASE_URL !== '/' ? '/' : 'https://kianmayne.co.uk/';
const REPO_URL = 'https://github.com/KMayne/clipbox';

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
  const clear = useCaptureStore(s => s.clear);

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
      <div className={styles.heading}>PASTES</div>
      <div className={styles.list}>
        {captures.length === 0 && (
          <div className={ui.empty}>Paste (Ctrl+V) or drop a file to start</div>
        )}
        {captures.map(c => (
          <CaptureItem key={c.id} capture={c} />
        ))}
      </div>
      <div className={styles.footer}>
        {captures.length > 0 && (
          <button className={ui.button} onClick={clear}>
            Clear all
          </button>
        )}
        <div className={styles.links}>
          <a
            className={styles.credit}
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            title="Source on GitHub (opens in a new tab)"
          >
            <Icon path={mdiGithub} size={0.5} />
            Source
            <Icon path={mdiArrowTopRight} size={0.45} />
          </a>
          <a
            className={styles.credit}
            href={SITE_URL}
            target="_blank"
            rel="noopener noreferrer"
            title="Opens in a new tab"
          >
            KianMayne.co.uk
            <Icon path={mdiArrowTopRight} size={0.45} />
          </a>
        </div>
      </div>
    </section>
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
        onClick={() =>
          collection ? useCaptureStore.getState().selectCollection(capture.id) : toggle(capture.id)
        }
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

/** Pastes hold one entry per clipboard format; drops and derived captures hold files. */
const countLabel = (source: CaptureView['source'], n: number) =>
  source === 'paste' || source === 'read' ? plural(n, 'format') : plural(n, 'file');
