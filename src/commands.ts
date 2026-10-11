import { copySelection } from './capture/copyToClipboard';
import { currentCapture, currentEntry, downloadAll, downloadEntry } from './capture/saveFiles';
import { openFile, readClipboard } from './capture/sources';
import { hasSettings } from './core/actions/types';
import { runAction, runDerivation, selectionActions } from './state/actions';
import { useCaptureStore, type Selection } from './state/captureStore';
import { useInstallStore } from './state/install';
import { useUiStore, type InspectorView } from './state/uiStore';
import { viewClassOf } from './state/views';

export interface Command {
  id: string;
  title: string;
  /** What the palette matches first, e.g. an action's title without its group. */
  name?: string;
  shortcut?: string;
  run(): void;
}

/** Shows `view` for the selected value, remembering it for that class of kind. */
export function showView(view: InspectorView): void {
  const { selection } = useCaptureStore.getState();
  useUiStore.getState().setView(viewClassOf(selection?.kind), view);
}

const viewCommand = (view: InspectorView, title: string, key: string): Command => ({
  id: `view.${view}`,
  title,
  shortcut: key,
  run: () => showView(view),
});

export function removeSelectedCapture(): void {
  const capture = currentCapture();
  if (capture) useCaptureStore.getState().remove(capture.id);
}

/**
 * Palette entries for the selection's actions ("<Group>: <Title>") and derivations
 * ("Open: <Label>"). Actions with settings open the sidebar with their form focused.
 */
export async function selectionCommands(selection: Selection): Promise<Command[]> {
  const { actions, derivations } = await selectionActions(selection);
  return [
    ...derivations.map(d => ({
      id: `open.${d.id}`,
      title: `Open: ${d.label}`,
      name: d.label,
      run: () => void runDerivation(selection, d),
    })),
    ...actions.map(a => ({
      id: `action.${a.id}`,
      title: `${a.group}: ${a.title}${hasSettings(a) ? '…' : ''}`,
      name: a.title,
      run: () =>
        hasSettings(a) ? useUiStore.getState().focusAction(a.id) : void runAction(selection, a),
    })),
  ];
}

/** Listed only while the browser offers installation (state/install.ts). */
export const installCommand: Command = {
  id: 'app.install',
  title: 'Install app',
  run: () => void useInstallStore.getState().install(),
};

export const commands: Command[] = [
  { id: 'clipboard.read', title: 'Read clipboard', run: () => void readClipboard() },
  { id: 'file.open', title: 'Open file…', shortcut: 'Ctrl+O', run: openFile },
  {
    id: 'value.copy',
    title: 'Copy current value',
    shortcut: 'Ctrl+C',
    run: () => void copySelection(useCaptureStore.getState().selection),
  },
  {
    id: 'value.download',
    title: 'Download current entry',
    name: 'Download',
    run() {
      const entry = currentEntry();
      if (entry) downloadEntry(entry.id);
      else useUiStore.getState().notify('Select an entry to download');
    },
  },
  {
    id: 'capture.downloadAll',
    title: 'Download all items of this capture…',
    name: 'Download all',
    run() {
      const capture = currentCapture();
      if (capture) void downloadAll(capture.id);
      else useUiStore.getState().notify('Nothing selected');
    },
  },
  {
    id: 'view.sidebar',
    title: 'Toggle sidebar',
    shortcut: 'A',
    run: () => useUiStore.getState().toggleSidebar(),
  },
  {
    id: 'view.info',
    title: 'Toggle Info section',
    shortcut: 'I',
    run: () => useUiStore.getState().toggleSection('info'),
  },
  {
    id: 'view.actions',
    title: 'Toggle Actions section',
    run: () => useUiStore.getState().toggleSection('actions'),
  },
  { id: 'settings.open', title: 'Settings', run: () => useUiStore.getState().openSettings() },
  viewCommand('preview', 'Show Preview', '1'),
  viewCommand('split', 'Show Split view (raw and preview)', '2'),
  viewCommand('raw', 'Show Raw', '3'),
  {
    id: 'view.schema',
    title: 'Toggle Schema section',
    run: () => useUiStore.getState().toggleSection('schema'),
  },
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
