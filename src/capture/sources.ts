import { useEffect, useState } from 'react';
import { useCaptureStore, type NewEntry } from '../state/captureStore';
import { useUiStore } from '../state/uiStore';

/*
 * Capture sources. Each one turns some platform input into entries and hands them to
 * captureStore.add(); a future Electron source (native clipboard formats) plugs in the same way.
 */

const add = (...args: Parameters<ReturnType<typeof useCaptureStore.getState>['add']>) =>
  useCaptureStore.getState().add(...args);

export function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export const fileEntry = (file: File): NewEntry => ({
  mime: file.type || 'application/octet-stream',
  name: file.name,
  size: file.size,
  blob: file,
});

export function entriesFromDataTransfer(dt: DataTransfer): NewEntry[] {
  const entries: NewEntry[] = [];
  for (const type of dt.types) {
    if (type === 'Files') continue;
    const data = dt.getData(type);
    if (data === '') continue;
    const blob = new Blob([data], { type });
    entries.push({ mime: type, size: blob.size, blob });
  }
  for (const file of dt.files) entries.push(fileEntry(file));
  return entries;
}

export function usePasteCapture() {
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (!e.clipboardData || isEditable(e.target)) return;
      e.preventDefault();
      add('paste', entriesFromDataTransfer(e.clipboardData));
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, []);
}

/** Returns whether a drag is over the window, for the overlay. */
export function useDropCapture(): boolean {
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    let depth = 0;
    const onEnter = (e: DragEvent) => {
      e.preventDefault();
      if (depth++ === 0) setDragging(true);
    };
    const onLeave = () => {
      if (--depth === 0) setDragging(false);
    };
    const onOver = (e: DragEvent) => e.preventDefault();
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      depth = 0;
      setDragging(false);
      if (e.dataTransfer) add('drop', entriesFromDataTransfer(e.dataTransfer));
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
    };
  }, []);
  return dragging;
}

export async function readClipboard(): Promise<void> {
  try {
    const items = await navigator.clipboard.read();
    const entries: NewEntry[] = [];
    for (const item of items) {
      for (const type of item.types) {
        const blob = await item.getType(type);
        entries.push({ mime: type, size: blob.size, blob });
      }
    }
    if (entries.length === 0) useUiStore.getState().notify('Clipboard is empty');
    add('read', entries);
  } catch (err) {
    const denied = err instanceof DOMException && err.name === 'NotAllowedError';
    useUiStore
      .getState()
      .notify(denied ? 'Clipboard permission denied — use Ctrl+V instead' : String(err), 'error');
  }
}

export function openFile(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.onchange = () => add('file', [...(input.files ?? [])].map(fileEntry));
  input.click();
}
