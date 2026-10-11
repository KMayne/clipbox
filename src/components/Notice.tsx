import { css, cx } from '@emotion/css';
import { useUiStore } from '../state/uiStore';
import { theme } from '../theme';

const styles = {
  notice: css`
    position: fixed;
    bottom: 16px;
    right: 16px;
    padding: 8px 12px;
    background: ${theme.raised};
    border: 1px solid ${theme.border};
    border-radius: 4px;
    z-index: 200;
  `,
  error: css`
    border-color: ${theme.error};
    color: ${theme.error};
  `,
};

export function Notice() {
  const notice = useUiStore(s => s.notice);
  if (!notice) return null;
  return (
    <div role="status" className={cx(styles.notice, notice.tone === 'error' && styles.error)}>
      {notice.message}
    </div>
  );
}
