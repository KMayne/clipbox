import { css, cx } from '@emotion/css';
import { mdiClipboardTextMultipleOutline, mdiFlashOutline, mdiTextBoxSearchOutline } from '@mdi/js';
import { Icon } from '@mdi/react';
import { useCaptureStore } from '../state/captureStore';
import { useUiStore, type MobilePane } from '../state/uiStore';
import { theme } from '../theme';
import { Inspector } from './Inspector';
import { PastesPane } from './PastesPane';
import { Sidebar } from './Sidebar';

const styles = {
  main: css`
    flex: 1;
    min-height: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    & > * {
      flex: 1;
      min-height: 0;
    }
  `,
  nav: css`
    display: flex;
    background: ${theme.panel};
    border-top: 1px solid ${theme.subtle};
    padding-bottom: env(safe-area-inset-bottom);
  `,
  tab: css`
    flex: 1;
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    min-height: 56px;
    padding: 6px 4px;
    background: none;
    border: none;
    border-top: 2px solid transparent;
    color: ${theme.muted};
    font-size: var(--text-xs);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  `,
  active: css`
    color: ${theme.accent};
    border-top-color: ${theme.accent};
  `,
  badge: css`
    position: absolute;
    top: 4px;
    left: calc(50% + 8px);
    min-width: 16px;
    padding: 0 4px;
    border-radius: 8px;
    background: ${theme.raised};
    color: ${theme.text};
    font-size: var(--text-2xs);
    line-height: calc(16px * var(--font-scale));
  `,
};

const PANES: { id: MobilePane; label: string; icon: string }[] = [
  { id: 'pastes', label: 'Pastes', icon: mdiClipboardTextMultipleOutline },
  { id: 'inspector', label: 'Inspector', icon: mdiTextBoxSearchOutline },
  { id: 'sidebar', label: 'Actions', icon: mdiFlashOutline },
];

/**
 * The phone layout: one pane at a time (Pastes, Inspector, or the sidebar's Info and Actions)
 * above a bottom navigation bar. Choosing a paste opens the Inspector, and so does any new capture,
 * such as a paste, a share or an action's result (state/mobileNav.ts).
 */
export function MobileLayout() {
  const pane = useUiStore(s => s.pane);
  return (
    <>
      <main className={styles.main} id="mobile-pane">
        {pane === 'pastes' && <PastesPane />}
        {pane === 'inspector' && <Inspector />}
        {pane === 'sidebar' && <Sidebar />}
      </main>
      <BottomNav pane={pane} />
    </>
  );
}

function BottomNav({ pane }: { pane: MobilePane }) {
  const count = useCaptureStore(s => s.captures.length);
  return (
    <nav className={styles.nav} aria-label="Panes">
      {PANES.map(p => (
        <button
          key={p.id}
          className={cx(styles.tab, pane === p.id && styles.active)}
          aria-current={pane === p.id ? 'page' : undefined}
          aria-controls="mobile-pane"
          onClick={() => useUiStore.getState().showPane(p.id)}
        >
          <Icon path={p.icon} size={0.9} />
          {p.label}
          {p.id === 'pastes' && count > 0 && (
            <span className={styles.badge} aria-hidden>
              {count}
            </span>
          )}
        </button>
      ))}
    </nav>
  );
}
