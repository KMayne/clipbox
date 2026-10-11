import { css } from '@emotion/css';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { useDropCapture, usePasteCapture } from './capture/sources';
import { CommandPalette } from './components/CommandPalette';
import { DropOverlay } from './components/DropOverlay';
import { Inspector } from './components/Inspector';
import { Notice } from './components/Notice';
import { PastesPane } from './components/PastesPane';
import { Sidebar } from './components/Sidebar';
import { SettingsDialog } from './components/SettingsDialog';
import { TopBar } from './components/TopBar';
import { useUiStore } from './state/uiStore';
import { theme } from './theme';
import { useGlobalShortcuts } from './useGlobalShortcuts';

const styles = {
  app: css`
    display: flex;
    flex-direction: column;
    height: 100%;
  `,
  main: css`
    flex: 1;
    min-height: 0;
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

  return (
    <div className={styles.app}>
      <TopBar />
      <Group className={styles.main}>
        <Panel id="pastes" defaultSize="30" minSize={220}>
          <PastesPane />
        </Panel>
        <Separator className={styles.separator} />
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
      <CommandPalette />
      <SettingsDialog />
      <Notice />
      {dragging && <DropOverlay />}
    </div>
  );
}
