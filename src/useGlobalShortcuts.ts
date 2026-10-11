import { useEffect } from 'react';
import { isEditable, openFile } from './capture/sources';
import { copySelection } from './capture/copyToClipboard';
import { removeSelectedCapture } from './commands';
import { chipOrder, useCaptureStore } from './state/captureStore';
import { useUiStore, type InspectorTab } from './state/uiStore';

const TABS: Record<string, InspectorTab> = {
  '1': 'preview',
  '2': 'stats',
  '3': 'schema',
  '4': 'raw',
};

/** Moves the chip selection by `delta` through the visible chips. */
export function moveSelection(delta: number): void {
  const { captures, selection, select } = useCaptureStore.getState();
  const order = chipOrder(captures);
  if (order.length === 0) return;
  const i = order.findIndex(s => s.entryId === selection?.entryId && s.kind === selection?.kind);
  const next = order[Math.min(order.length - 1, Math.max(0, i + delta))];
  if (next) select(next);
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
      if (mod && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        openFile();
      } else if (mod && e.key.toLowerCase() === 'c') {
        if (window.getSelection()?.toString()) return; // let the browser copy selected text
        e.preventDefault();
        void copySelection(useCaptureStore.getState().selection);
      } else if (mod || e.altKey) {
        return;
      } else if (TABS[e.key]) {
        ui.setTab(TABS[e.key]!);
      } else if (e.key === 'w') {
        ui.toggleWrap();
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
