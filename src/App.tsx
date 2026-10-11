import { css } from '@emotion/css';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { useDropCapture, usePasteCapture } from './capture/sources';
import { CommandPalette } from './components/CommandPalette';
import { DropOverlay } from './components/DropOverlay';
import { Inspector } from './components/Inspector';
import { MobileLayout } from './components/MobileLayout';
import { Notice } from './components/Notice';
import { PastesPane } from './components/PastesPane';
import { Sidebar } from './components/Sidebar';
import { SiteLinks } from './components/SiteLinks';
import { ConfirmDialog } from './components/ConfirmDialog';
import { SettingsDialog } from './components/SettingsDialog';
import { TopBar } from './components/TopBar';
import { useIsMobile } from './components/useMediaQuery';
import { useUiStore } from './state/uiStore';
import { theme } from './theme';
import { useGlobalShortcuts } from './useGlobalShortcuts';

const styles = {
  app: css`
    display: flex;
    flex-direction: column;
    height: 100%;
    /* Landscape phones: keep clear of the notch (the bars pad their own top and bottom) */
    padding: 0 env(safe-area-inset-right) 0 env(safe-area-inset-left);
  `,
  main: css`
    flex: 1;
    min-height: 0;
  `,
  /** Below the panes: the source and author links. */
  footer: css`
    display: flex;
    justify-content: flex-end;
    padding: 3px 12px;
    background: ${theme.panel};
    border-top: 1px solid ${theme.subtle};
  `,
  separator: css`
    width: 1px;
    background: ${theme.subtle};
    &[data-separator='hover'],
    &[data-separator='active'] {
      background: ${theme.accent};
    }
  `,
};

export function App() {
  usePasteCapture();
  useGlobalShortcuts();
  const dragging = useDropCapture();
  const sidebarOpen = useUiStore(s => s.sidebarOpen);
  const mobile = useIsMobile();

  return (
    <div className={styles.app}>
      <TopBar compact={mobile} />
      {mobile ? <MobileLayout /> : <Desktop sidebarOpen={sidebarOpen} />}
      {!mobile && (
        <footer className={styles.footer}>
          <SiteLinks />
        </footer>
      )}
      <CommandPalette />
      <ConfirmDialog />
      <SettingsDialog />
      <Notice />
      {dragging && <DropOverlay />}
    </div>
  );
}

/** Resizable panes: Pastes | Inspector | Sidebar (Info and Actions); the outer two collapse. */
function Desktop({ sidebarOpen }: { sidebarOpen: boolean }) {
  const pastesOpen = useUiStore(s => s.pastesOpen);
  return (
    <Group className={styles.main}>
      {pastesOpen && (
        <>
          <Panel id="pastes" defaultSize="30" minSize={220}>
            <PastesPane />
          </Panel>
          <Separator className={styles.separator} />
        </>
      )}
      <Panel id="inspector" minSize={320}>
        <Inspector />
      </Panel>
      {sidebarOpen && (
        <>
          <Separator className={styles.separator} />
          <Panel id="sidebar" defaultSize="22" minSize={200}>
            <Sidebar />
          </Panel>
        </>
      )}
    </Group>
  );
}
