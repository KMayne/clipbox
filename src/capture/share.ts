import { useCaptureStore } from '../state/captureStore';
import { useUiStore } from '../state/uiStore';
import {
  partFromResponse,
  SHARE_CACHE,
  SHARE_PARAM,
  shareEntries,
  shareKey,
  type SharedPart,
} from './sharePayload';
import { fileEntry } from './sources';

/*
 * Installed-app entry points: Android's share sheet (manifest `share_target`, stashed by the
 * service worker) and desktop file handling (manifest `file_handlers`, via `launchQueue`).
 */

/**
 * Ingests shares the service worker stashed, oldest first, as 'share' captures, then deletes them.
 * Called once at startup; the share's redirect (`?share=<id>`) is dropped from the address.
 */
export async function consumeShares(): Promise<void> {
  const url = new URL(location.href);
  const shared = url.searchParams.has(SHARE_PARAM);
  if (shared) {
    url.searchParams.delete(SHARE_PARAM);
    history.replaceState(history.state, '', url);
  }
  if (!('caches' in window) || !(await caches.has(SHARE_CACHE))) return;
  try {
    const cache = await caches.open(SHARE_CACHE);
    const shares = new Map<string, { index: number; request: Request }[]>();
    for (const request of await cache.keys()) {
      const key = shareKey(request.url);
      if (!key) {
        await cache.delete(request);
        continue;
      }
      shares.set(key.id, [...(shares.get(key.id) ?? []), { index: key.index, request }]);
    }
    let added = 0;
    for (const keys of shares.values()) {
      const parts: SharedPart[] = [];
      for (const { request } of keys.sort((a, b) => a.index - b.index)) {
        const res = await cache.match(request);
        const part = res && (await partFromResponse(res));
        if (part) parts.push(part);
        await cache.delete(request);
      }
      const entries = await shareEntries(parts);
      if (entries.length > 0) {
        useCaptureStore.getState().add('share', entries);
        added++;
      }
    }
    if (shared && added === 0) useUiStore.getState().notify('Nothing was shared');
  } catch (err) {
    useUiStore.getState().notify(`Couldn't read the share: ${String(err)}`, 'error');
  }
}

/** Files opened with the installed app (desktop Chromium's "Open with") become a capture. */
export function startFileHandling(): void {
  window.launchQueue?.setConsumer(async params => {
    const files = await Promise.all(
      params.files.filter(h => h instanceof FileSystemFileHandle).map(h => h.getFile()),
    );
    if (files.length > 0) useCaptureStore.getState().add('file', files.map(fileEntry));
  });
}
