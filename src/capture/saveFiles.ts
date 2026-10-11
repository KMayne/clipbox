import { create } from 'zustand';
import { baseFileName, uniqueFileNames, type NamingEntry } from '../core/filenames';
import { plural } from '../core/format';
import type { CaptureId, EntryId } from '../core/types';
import {
  bestInterpretation,
  findEntry,
  useCaptureStore,
  type CaptureView,
  type EntryView,
} from '../state/captureStore';
import { useUiStore } from '../state/uiStore';

/** The File System Access directory picker (Chromium); not in TypeScript's DOM lib. */
declare global {
  interface Window {
    showDirectoryPicker?: (options?: {
      id?: string;
      mode?: 'read' | 'readwrite';
      startIn?: string;
    }) => Promise<FileSystemDirectoryHandle>;
  }
}

/** Progress of the running "Download all" (one at a time). */
export interface SaveProgress {
  captureId: CaptureId;
  done: number;
  total: number;
}

interface SaveState {
  progress: SaveProgress | null;
  cancelled: boolean;
  cancel(): void;
}

export const useSaveStore = create<SaveState>(set => ({
  progress: null,
  cancelled: false,
  cancel: () => set({ cancelled: true }),
}));

const naming = (e: EntryView): NamingEntry => ({
  name: e.name,
  mime: e.mime,
  kind: bestInterpretation(e)?.kind,
});

/** The capture being inspected: the collection, else the selected entry's capture. */
export function currentCapture(): CaptureView | undefined {
  const { captures, selection, collection } = useCaptureStore.getState();
  if (collection) return captures.find(c => c.id === collection);
  return selection ? findEntry(captures, selection.entryId)?.capture : undefined;
}

/** The entry being inspected, if one is selected (not a collection). */
export function currentEntry(): EntryView | undefined {
  const { captures, selection } = useCaptureStore.getState();
  return selection ? findEntry(captures, selection.entryId)?.entry : undefined;
}

/** Downloads one entry's raw bytes through the browser's usual download flow. */
export function downloadEntry(entryId: EntryId): void {
  const found = findEntry(useCaptureStore.getState().captures, entryId);
  if (!found) return;
  const { capture, entry } = found;
  const name = baseFileName(naming(entry), capture.entries.indexOf(entry) + 1);
  const url = URL.createObjectURL(entry.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  // Give the download a moment to start before the URL goes away
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const isAbort = (err: unknown) => err instanceof DOMException && err.name === 'AbortError';

async function existingNames(dir: FileSystemDirectoryHandle): Promise<string[]> {
  const names: string[] = [];
  try {
    for await (const name of dir.keys()) names.push(name);
  } catch {
    // listing unsupported or denied: only de-duplicate within the collection
  }
  return names;
}

/**
 * Writes every entry of `captureId` into a folder the user picks, with de-duplicated names that
 * don't overwrite files already there. Progress is shown as a notice with a Cancel button.
 */
export async function downloadAll(captureId: CaptureId): Promise<void> {
  const { notify, dismissNotice } = useUiStore.getState();
  const capture = useCaptureStore.getState().captures.find(c => c.id === captureId);
  if (!capture) return;
  if (useSaveStore.getState().progress) return notify('Already saving files');
  if (!window.showDirectoryPicker)
    return notify('Saving to a folder needs a Chromium browser', 'error');

  let dir: FileSystemDirectoryHandle;
  try {
    dir = await window.showDirectoryPicker({ id: 'clipbox-download-all', mode: 'readwrite' });
  } catch (err) {
    if (isAbort(err)) return; // the user closed the picker
    return notify(`Couldn't open the folder: ${String(err)}`, 'error');
  }

  const entries = capture.entries;
  const names = uniqueFileNames(entries.map(naming), await existingNames(dir));
  const total = entries.length;
  const cancel = { label: 'Cancel', run: () => useSaveStore.getState().cancel() };
  const report = (done: number) => {
    useSaveStore.setState({ progress: { captureId, done, total } });
    notify(`Saving ${done} of ${total} to ${dir.name}…`, 'info', cancel);
  };
  useSaveStore.setState({ cancelled: false });
  report(0);
  let done = 0;
  try {
    for (const [i, entry] of entries.entries()) {
      if (useSaveStore.getState().cancelled) break;
      const name = names[i];
      if (!name) continue;
      const file = await dir.getFileHandle(name, { create: true });
      const out = await file.createWritable();
      try {
        await out.write(entry.blob);
        await out.close();
      } catch (err) {
        await out.abort().catch(() => undefined);
        throw err;
      }
      report(++done);
    }
    dismissNotice();
    if (useSaveStore.getState().cancelled)
      notify(`Cancelled after saving ${plural(done, 'file')} to ${dir.name}`);
    else notify(`Saved ${plural(done, 'file')} to ${dir.name}`);
  } catch (err) {
    notify(
      isAbort(err)
        ? `Cancelled after saving ${plural(done, 'file')}`
        : `Saving failed after ${plural(done, 'file')}: ${String(err)}`,
      'error',
    );
  } finally {
    useSaveStore.setState({ progress: null, cancelled: false });
  }
}
