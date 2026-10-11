import { css, cx } from '@emotion/css';
import {
  mdiCogOutline,
  mdiClipboardArrowDownOutline,
  mdiConsoleLine,
  mdiFileUploadOutline,
  mdiPackageVariantClosed,
} from '@mdi/js';
import { Icon } from '@mdi/react';
import { openFile, readClipboard } from '../capture/sources';
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
  /** The Ctrl+K hint doubles as the palette's button. */
  paletteHint: css`
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 4px;
    background: none;
    border: none;
    border-radius: 3px;
    color: inherit;
    cursor: pointer;
    &:hover {
      color: ${theme.text};
      background: ${theme.hover};
    }
  `,
};

const openPalette = () => useUiStore.getState().setPaletteOpen(true);

/**
 * Read clipboard, Open file, the palette and Settings. `compact` (phones) drops the title and the
 * keyboard hints and makes Read clipboard the primary button, since there's no Ctrl+V.
 */
export function TopBar({ compact = false }: { compact?: boolean }) {
  return (
    <header className={cx(styles.bar, compact && styles.compactBar)}>
      <span className={styles.title}>
        <Icon path={mdiPackageVariantClosed} size={0.8} color={theme.accent} />
        {!compact && 'Clipbox'}
      </span>
      <button className={cx(ui.button, compact && ui.primary)} onClick={() => void readClipboard()}>
        <Icon path={mdiClipboardArrowDownOutline} size={0.7} />
        Read clipboard
      </button>
      {compact ? (
        <button
          className={ui.iconButton}
          title="Open file"
          aria-label="Open file"
          onClick={openFile}
        >
          <Icon path={mdiFileUploadOutline} size={0.8} />
        </button>
      ) : (
        <button className={ui.button} onClick={openFile}>
          <Icon path={mdiFileUploadOutline} size={0.7} />
          Open file
        </button>
      )}
      <span className={styles.hints}>
        {compact ? (
          <button
            className={ui.iconButton}
            title="Commands"
            aria-label="Commands"
            onClick={openPalette}
          >
            <Icon path={mdiConsoleLine} size={0.8} />
          </button>
        ) : (
          <>
            <span>
              <kbd className={ui.kbd}>Ctrl+V</kbd> paste
            </span>
            <button className={styles.paletteHint} aria-label="Commands" onClick={openPalette}>
              <kbd className={ui.kbd}>Ctrl+K</kbd> commands
            </button>
            <SidebarToggle />
          </>
        )}
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
      <PanelRightIcon open={open} />
    </button>
  );
}

/** The usual "toggle right panel" glyph: a window outline with a divider; the panel fills in when open. */
function PanelRightIcon({ open }: { open: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      {open && (
        <rect x="15" y="4" width="6" height="16" rx="1" fill="currentColor" opacity="0.35" />
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
      <line x1="15" y1="4" x2="15" y2="20" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}
