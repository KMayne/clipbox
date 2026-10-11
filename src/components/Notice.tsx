import { css, cx } from '@emotion/css';
import { useUiStore } from '../state/uiStore';
import { theme } from '../theme';
import { media, ui } from './ui';

const styles = {
  notice: css`
    position: fixed;
    bottom: 16px;
    right: 16px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    background: ${theme.raised};
    border: 1px solid ${theme.border};
    border-radius: 4px;
    z-index: 200;
    /* Phones: above the bottom navigation */
    ${media.mobile} {
      left: 12px;
      right: 12px;
      bottom: calc(68px + env(safe-area-inset-bottom));
    }
  `,
  error: css`
    border-color: ${theme.error};
    color: ${theme.error};
  `,
};

export function Notice() {
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
