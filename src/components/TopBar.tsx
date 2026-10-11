import { css, cx } from '@emotion/css';
import { mdiCogOutline, mdiConsoleLine, mdiPackageVariantClosed } from '@mdi/js';
import { Icon } from '@mdi/react';
import { useUiStore } from '../state/uiStore';
import { theme } from '../theme';
import { ui } from './ui';

const styles = {
  bar: css`
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    /* Under a translucent status bar (iOS home screen, viewport-fit=cover) */
    padding-top: max(6px, env(safe-area-inset-top));
    background: ${theme.panel};
    border-bottom: 1px solid ${theme.subtle};
  `,
  compactBar: css`
    gap: 4px;
    padding-left: 8px;
    padding-right: 4px;
  `,
  title: css`
    display: flex;
    align-items: center;
    gap: 6px;
    margin-right: 12px;
    font-weight: 600;
  `,
  hints: css`
    margin-left: auto;
    display: flex;
    gap: 10px;
    align-items: center;
    color: ${theme.muted};
  `,
};

const openPalette = () => useUiStore.getState().setPaletteOpen(true);

/**
 * The panel toggles, the palette and Settings. Paste, Open file and Clear all live in the Pastes
 * panel's heading, and keyboard shortcuts in the sidebar. `compact` (phones) drops the title and
 * the panel toggles.
 */
export function TopBar({ compact = false }: { compact?: boolean }) {
  return (
    <header className={cx(styles.bar, compact && styles.compactBar)}>
      <span className={styles.title}>
        <Icon path={mdiPackageVariantClosed} size={0.8} color={theme.accent} />
        {!compact && 'Clipbox'}
      </span>
      {!compact && <PastesToggle />}
      <span className={styles.hints}>
        <button
          className={ui.iconButton}
          title="Commands (Ctrl+K)"
          aria-label="Commands"
          onClick={openPalette}
        >
          <Icon path={mdiConsoleLine} size={0.8} />
        </button>
        {!compact && <SidebarToggle />}
        <button
          className={ui.iconButton}
          title="Settings"
          aria-label="Settings"
          onClick={() => useUiStore.getState().openSettings()}
        >
          <Icon path={mdiCogOutline} size={0.8} />
        </button>
      </span>
    </header>
  );
}

/** Shows or hides the left Pastes panel. */
function PastesToggle() {
  const open = useUiStore(s => s.pastesOpen);
  return (
    <button
      className={ui.iconButton}
      title={`${open ? 'Hide' : 'Show'} pastes (P)`}
      aria-label="Pastes panel"
      aria-pressed={open}
      onClick={() => useUiStore.getState().togglePastes()}
    >
      <PanelIcon side="left" open={open} />
    </button>
  );
}

/** Shows or hides the right sidebar (Info and Actions), like an editor's panel toggle. */
function SidebarToggle() {
  const open = useUiStore(s => s.sidebarOpen);
  const label = `${open ? 'Hide' : 'Show'} sidebar (A)`;
  return (
    <button
      className={ui.iconButton}
      title={label}
      aria-label="Sidebar"
      aria-pressed={open}
      onClick={() => useUiStore.getState().toggleSidebar()}
    >
      <PanelIcon side="right" open={open} />
    </button>
  );
}

/** The usual panel-toggle glyph: a window outline with a divider; the panel fills in when open. */
function PanelIcon({ side, open }: { side: 'left' | 'right'; open: boolean }) {
  const divider = side === 'left' ? 9 : 15;
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      {open && (
        <rect
          x={side === 'left' ? 3 : 15}
          y="4"
          width="6"
          height="16"
          rx="1"
          fill="currentColor"
          opacity="0.35"
        />
      )}
      <rect
        x="3"
        y="4"
        width="18"
        height="16"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <line x1={divider} y1="4" x2={divider} y2="20" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}
