import { css, cx } from '@emotion/css';
import { useUiStore } from '../state/uiStore';
import { theme } from '../theme';
import { RunsStrip } from './RunProgress';
import { media, ui } from './ui';

const styles = {
  /** Bottom right: running actions above the notice. Clicks pass through the gaps. */
  area: css`
    position: fixed;
    bottom: 16px;
    right: 16px;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
    max-width: calc(100vw - 32px);
    z-index: 200;
    pointer-events: none;
    /* Phones: above the bottom navigation */
    ${media.mobile} {
      left: 12px;
      right: 12px;
      max-width: none;
      align-items: stretch;
      bottom: calc(68px + env(safe-area-inset-bottom));
    }
  `,
  notice: css`
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    background: ${theme.raised};
    border: 1px solid ${theme.border};
    border-radius: 4px;
    pointer-events: auto;
  `,
  error: css`
    border-color: ${theme.error};
    color: ${theme.error};
  `,
};

/** The notice area: running actions (`RunsStrip`) and the current notice. */
export function Notice() {
  return (
    <div className={styles.area}>
      <RunsStrip />
      <NoticeBox />
    </div>
  );
}

function NoticeBox() {
  const notice = useUiStore(s => s.notice);
  const dismiss = useUiStore(s => s.dismissNotice);
  if (!notice) return null;
  const { action } = notice;
  return (
    <div role="status" className={cx(styles.notice, notice.tone === 'error' && styles.error)}>
      {notice.message}
      {action && (
        <>
          <button
            className={ui.button}
            onClick={() => {
              dismiss();
              action.run();
            }}
          >
            {action.label}
          </button>
          <button className={ui.iconButton} onClick={dismiss} aria-label="Dismiss">
            ✕
          </button>
        </>
      )}
    </div>
  );
}
