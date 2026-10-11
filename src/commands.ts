import { copySelection } from './capture/copyToClipboard';
import { openFile, readClipboard } from './capture/sources';
import { findEntry, useCaptureStore } from './state/captureStore';
import { useUiStore, type InspectorTab } from './state/uiStore';

export interface Command {
  id: string;
  title: string;
  shortcut?: string;
  run(): void;
}

const tabCommand = (tab: InspectorTab, key: string): Command => ({
  id: `tab.${tab}`,
  title: `Show ${tab[0]!.toUpperCase()}${tab.slice(1)}`,
  shortcut: key,
  run: () => useUiStore.getState().setTab(tab),
});

export function removeSelectedCapture(): void {
  const { captures, selection, remove } = useCaptureStore.getState();
  const found = selection && findEntry(captures, selection.entryId);
  if (found) remove(found.capture.id);
}

export const commands: Command[] = [
  { id: 'clipboard.read', title: 'Read clipboard', run: () => void readClipboard() },
  { id: 'file.open', title: 'Open file…', shortcut: 'Ctrl+O', run: openFile },
  {
    id: 'value.copy',
    title: 'Copy current value',
    shortcut: 'Ctrl+C',
    run: () => void copySelection(useCaptureStore.getState().selection),
  },
  tabCommand('preview', '1'),
  tabCommand('stats', '2'),
  tabCommand('schema', '3'),
  tabCommand('raw', '4'),
  {
    id: 'view.wrap',
    title: 'Toggle line wrap',
    shortcut: 'W',
    run: () => useUiStore.getState().toggleWrap(),
  },
  {
    id: 'capture.remove',
    title: 'Remove selected capture',
    shortcut: 'Del',
    run: removeSelectedCapture,
  },
  {
    id: 'capture.clear',
    title: 'Clear all captures',
    run: () => useCaptureStore.getState().clear(),
  },
];
