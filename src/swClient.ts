import type { ModuleId } from './modules/types';
import { useUiStore } from './state/uiStore';

export type CacheState =
  | { state: 'unsupported' }
  | { state: 'none' }
  | { state: 'downloading'; progress: number }
  | { state: 'cached' };

export interface ModulesManifest {
  version: string;
  core: string[];
  modules: Record<string, { files: string[]; bytes: number }>;
}

/** Messages understood by src/sw.ts. */
export type SwRequest =
  | { type: 'status' }
  | { type: 'download'; id: ModuleId }
  | { type: 'remove'; id: ModuleId }
  | { type: 'skipWaiting' };

export type SwResponse =
  | { type: 'status'; cached: ModuleId[] }
  | { type: 'progress'; done: number; total: number }
  | { type: 'done' }
  | { type: 'error'; message: string };

const supported = import.meta.env.PROD && 'serviceWorker' in navigator;

async function worker(): Promise<ServiceWorker> {
  const reg = await navigator.serviceWorker.ready;
  if (!reg.active) throw new Error('No active service worker');
  return reg.active;
}

/** Sends a request over a MessageChannel; resolves on the first non-progress reply. */
async function request(
  msg: SwRequest,
  onProgress?: (fraction: number) => void,
): Promise<SwResponse> {
  const target = await worker();
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = (e: MessageEvent<SwResponse>) => {
      const res = e.data;
      if (res.type === 'progress') onProgress?.(res.total ? res.done / res.total : 0);
      else if (res.type === 'error') reject(new Error(res.message));
      else resolve(res);
    };
    target.postMessage(msg, [channel.port2]);
  });
}

let manifest: Promise<ModulesManifest | null> | null = null;

export const sw = {
  supported,

  register(): void {
    if (!supported) return;
    void navigator.serviceWorker.register('/sw.js', { type: 'module' }).then(reg => {
      const announce = (waiting: ServiceWorker) =>
        useUiStore.getState().notify('Update available', 'info', {
          label: 'Reload',
          run: () => waiting.postMessage({ type: 'skipWaiting' } satisfies SwRequest),
        });
      if (reg.waiting && navigator.serviceWorker.controller) announce(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const installing = reg.installing;
        installing?.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller)
            announce(installing);
        });
      });
    });
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      location.reload();
    });
  },

  manifest(): Promise<ModulesManifest | null> {
    manifest ??= fetch('/modules-manifest.json')
      .then(r => (r.ok ? (r.json() as Promise<ModulesManifest>) : null))
      .catch(() => null);
    return manifest;
  },

  async status(): Promise<Record<string, CacheState>> {
    const m = await sw.manifest();
    if (!supported || !m) return {};
    const res = await request({ type: 'status' });
    const cached = res.type === 'status' ? new Set(res.cached) : new Set<ModuleId>();
    return Object.fromEntries(
      Object.keys(m.modules).map(id => [
        id,
        { state: cached.has(id) ? 'cached' : 'none' } as CacheState,
      ]),
    );
  },

  async download(id: ModuleId, onProgress: (fraction: number) => void): Promise<void> {
    await request({ type: 'download', id }, onProgress);
  },

  async remove(id: ModuleId): Promise<void> {
    if (supported) await request({ type: 'remove', id });
  },
};
