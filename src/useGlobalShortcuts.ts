import { useEffect } from 'react';
import { isEditable, openFile } from './capture/sources';
import { copySelection } from './capture/copyToClipboard';
import { removeSelectedCapture } from './commands';
import { navOrder, useCaptureStore } from './state/captureStore';
import { useUiStore, type InspectorTab } from './state/uiStore';

const TABS: Record<string, InspectorTab> = {
  '1': 'preview',
  '2': 'schema',
  '3': 'raw',
};

/** Moves the selection by `delta` through the visible chips and collection headers. */
export function moveSelection(delta: number): void {
  const { captures, selection, collection, select, selectCollection } = useCaptureStore.getState();
  const order = navOrder(captures);
  if (order.length === 0) return;
  const i = order.findIndex(s =>
    'collection' in s
      ? s.collection === collection
      : s.entryId === selection?.entryId && s.kind === selection?.kind,
  );
  const next = order[Math.min(order.length - 1, Math.max(0, i + delta))];
  if (!next) return;
  if ('collection' in next) selectCollection(next.collection);
  else select(next);
}

export function useGlobalShortcuts() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const ui = useUiStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ui.setPaletteOpen(!ui.paletteOpen);
        return;
      }
      if (ui.paletteOpen || isEditable(e.target)) return;
      const tab = TABS[e.key];
      if (mod && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        openFile();
      } else if (mod && e.key.toLowerCase() === 'c') {
        if (window.getSelection()?.toString()) return; // let the browser copy selected text
        e.preventDefault();
        void copySelection(useCaptureStore.getState().selection);
      } else if (mod || e.altKey) {
        return;
      } else if (tab) {
        ui.setTab(tab);
      } else if (e.key === 'w') {
        ui.toggleWrap();
      } else if (e.key === 'a') {
        ui.toggleSidebar();
      } else if (e.key === 'i') {
        ui.toggleSection('info');
      } else if (e.key === 'j' || e.key === 'k') {
        moveSelection(e.key === 'j' ? 1 : -1);
      } else if (e.key === 'Delete') {
        removeSelectedCapture();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
