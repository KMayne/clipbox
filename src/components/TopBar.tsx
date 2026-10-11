import { css } from '@emotion/css';
import {
  mdiClipboardArrowDownOutline,
  mdiFileUploadOutline,
  mdiPackageVariantClosed,
} from '@mdi/js';
import { Icon } from '@mdi/react';
import { openFile, readClipboard } from '../capture/sources';
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
      </span>
    </header>
  );
}
