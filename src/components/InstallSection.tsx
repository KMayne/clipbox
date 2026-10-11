import { css } from '@emotion/css';
import { mdiCellphoneArrowDown } from '@mdi/js';
import { Icon } from '@mdi/react';
import { canInstall, useInstallStore } from '../state/install';
import { theme } from '../theme';
import { ui } from './ui';

const styles = {
  section: css`
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px 12px;
    margin-bottom: 20px;
  `,
  h3: css`
    margin: 0;
    font-size: 11px;
    letter-spacing: 0.06em;
    color: ${theme.muted};
  `,
  text: css`
    flex: 1 1 240px;
    color: ${theme.muted};
    font-size: 12px;
  `,
};

/** Settings → App: "Install app" while the browser offers it; nothing once installed. */
export function InstallSection() {
  const installable = useInstallStore(canInstall);
  if (!installable) return null;
  return (
    <section className={styles.section} aria-label="App">
      <h3 className={styles.h3}>APP</h3>
      <span className={styles.text}>
        Install Clipbox to open it from your home screen or dock, use it offline, and share text,
        links and files to it.
      </span>
      <button className={ui.button} onClick={() => void useInstallStore.getState().install()}>
        <Icon path={mdiCellphoneArrowDown} size={0.7} />
        Install app
      </button>
    </section>
  );
}
