import { css, cx } from '@emotion/css';
import {
  mdiCogOutline,
  mdiClipboardArrowDownOutline,
  mdiFileUploadOutline,
  mdiPackageVariantClosed,
  mdiPageLayoutSidebarRight,
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
    background: ${theme.panel};
    border-bottom: 1px solid ${theme.subtle};
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

export function TopBar() {
  return (
    <header className={styles.bar}>
      <span className={styles.title}>
        <Icon path={mdiPackageVariantClosed} size={0.8} color={theme.accent} />
        Clipbox
      </span>
      <button className={ui.button} onClick={() => void readClipboard()}>
        <Icon path={mdiClipboardArrowDownOutline} size={0.7} />
        Read clipboard
      </button>
      <button className={ui.button} onClick={openFile}>
        <Icon path={mdiFileUploadOutline} size={0.7} />
        Open file
      </button>
      <span className={styles.hints}>
        <span>
          <kbd className={ui.kbd}>Ctrl+V</kbd> paste
        </span>
        <span>
          <kbd className={ui.kbd}>Ctrl+K</kbd> commands
        </span>
        <SidebarToggle />
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

const toggleStyles = {
  open: css`
    color: ${theme.accent};
    &:hover {
      color: ${theme.accent};
    }
  `,
};

/** Shows or hides the right sidebar (Info and Actions), like an editor's panel toggle. */
function SidebarToggle() {
  const open = useUiStore(s => s.sidebarOpen);
  const label = `${open ? 'Hide' : 'Show'} sidebar (A)`;
  return (
    <button
      className={cx(ui.iconButton, open && toggleStyles.open)}
      title={label}
      aria-label="Sidebar"
      aria-pressed={open}
      onClick={() => useUiStore.getState().toggleSidebar()}
    >
      <Icon path={mdiPageLayoutSidebarRight} size={0.8} />
    </button>
  );
}
