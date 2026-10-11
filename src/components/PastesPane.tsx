import { css } from '@emotion/css';
import { mdiArrowTopRight, mdiChevronDown, mdiChevronRight, mdiClose, mdiGithub } from '@mdi/js';
import { Icon } from '@mdi/react';
import { kindName } from '../core/kinds';
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
  parent: css`
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 0;
    background: none;
    border: none;
    color: ${theme.muted};
    text-align: left;
    &:enabled {
      cursor: pointer;
    }
    &:enabled:hover {
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

const time = (at: number) => new Date(at).toLocaleTimeString('en-GB');

/** The author's site: its root when deployed under a subpath (e.g. /clipbox/), else the live URL. */
const SITE_URL = import.meta.env.BASE_URL !== '/' ? '/' : 'https://kianmayne.co.uk/';
const REPO_URL = 'https://github.com/KMayne/clipbox';

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
  const n = capture.entries.length;
  return (
    <div className={styles.capture} data-testid="capture">
      <div className={styles.header} onClick={() => toggle(capture.id)}>
        <Icon path={capture.collapsed ? mdiChevronRight : mdiChevronDown} size={0.7} />
        <span>{time(capture.at)}</span>
        <span className={ui.muted}>·</span>
        {capture.parent ? (
          <ParentLink parent={capture.parent} />
        ) : (
          <span className={ui.muted}>
            {capture.source} · {n} format{n === 1 ? '' : 's'}
          </span>
        )}
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

/** "from ‹parent label› › ‹derivation›"; clicking selects the parent interpretation. */
function ParentLink({ parent }: { parent: NonNullable<CaptureView['parent']> }) {
  // Select the capture (a stable reference), not findEntry's fresh object
  const capture = useCaptureStore(s =>
    s.captures.find(c => c.entries.some(e => e.id === parent.entryId)),
  );
  const entry = capture?.entries.find(e => e.id === parent.entryId);
  const interpretation = entry?.interpretations.find(i => i.kind === parent.kind);
  const parentLabel = interpretation?.label ?? kindName(parent.kind);
  const text = `from ${parentLabel} › ${parent.label}`;
  return (
    <button
      className={styles.parent}
      data-testid="derived-from"
      disabled={!capture}
      title={capture ? `Select ${parentLabel}` : 'The original capture was removed'}
      onClick={e => {
        e.stopPropagation();
        if (!capture) return;
        const { toggle, select } = useCaptureStore.getState();
        if (capture.collapsed) toggle(capture.id);
        select({ entryId: parent.entryId, kind: parent.kind });
      }}
    >
      {text}
    </button>
  );
}
