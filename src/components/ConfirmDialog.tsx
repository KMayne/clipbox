import { css, cx } from '@emotion/css';
import { useEffect, useRef } from 'react';
import { useUiStore } from '../state/uiStore';
import { theme } from '../theme';
import { media, ui } from './ui';

const styles = {
  backdrop: css`
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 18vh 12px 12px;
    z-index: 200;
  `,
  dialog: css`
    width: min(420px, 100%);
    padding: 16px 20px;
    background: ${theme.panel};
    border: 1px solid ${theme.border};
    border-radius: 6px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
    ${media.mobile} {
      padding: 14px;
    }
  `,
  title: css`
    margin: 0 0 8px;
    font-size: 15px;
  `,
  message: css`
    margin: 0 0 16px;
    color: ${theme.muted};
  `,
  buttons: css`
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  `,
  danger: css`
    background: ${theme.error};
    border-color: ${theme.error};
    color: ${theme.onAccent};
    font-weight: 600;
    &:hover {
      background: ${theme.error};
      filter: brightness(1.1);
    }
  `,
};

/** "Are you sure?" for destructive commands. Escape or Cancel dismisses; Cancel has focus. */
export function ConfirmDialog() {
  const request = useUiStore(s => s.confirm);
  const close = useUiStore(s => s.closeConfirm);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!request) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [request, close]);

  if (!request) return null;
  const confirm = () => {
    close();
    request.onConfirm();
  };
  return (
    <div className={styles.backdrop} onMouseDown={close}>
      <div
        className={styles.dialog}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        onMouseDown={e => e.stopPropagation()}
      >
        <h2 id="confirm-title" className={styles.title}>
          {request.title}
        </h2>
        <p id="confirm-message" className={styles.message}>
          {request.message}
        </p>
        <div className={styles.buttons}>
          <button ref={cancelRef} className={ui.button} onClick={close}>
            Cancel
          </button>
          <button className={cx(ui.button, styles.danger)} onClick={confirm}>
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
