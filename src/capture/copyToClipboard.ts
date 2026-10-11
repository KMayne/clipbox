import type { Selection } from '../state/captureStore';
import { useUiStore } from '../state/uiStore';
import { engine } from '../engine/engineClient';

async function toPng(bytes: Uint8Array<ArrayBuffer>, mime: string): Promise<Blob> {
  const blob = new Blob([bytes], { type: mime });
  if (mime === 'image/png') return blob;
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.drawImage(bitmap, 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
}

/** Copies the selected value in its natural format. */
export async function copySelection(selection: Selection | null): Promise<void> {
  const { notify } = useUiStore.getState();
  if (!selection) return notify('Nothing selected');
  try {
    const payload = await engine.exportValue(selection.entryId, selection.kind);
    const parts: Record<string, Blob> = {};
    if (payload.image) parts['image/png'] = await toPng(payload.image.bytes, payload.image.mime);
    if (payload.html) parts['text/html'] = new Blob([payload.html], { type: 'text/html' });
    if (payload.text !== undefined)
      parts['text/plain'] = new Blob([payload.text], { type: 'text/plain' });
    if (Object.keys(parts).length === 0)
      return notify(`Can't copy ${selection.kind} values`, 'error');
    await navigator.clipboard.write([new ClipboardItem(parts)]);
    notify('Copied');
  } catch (err) {
    notify(`Copy failed: ${String(err)}`, 'error');
  }
}
