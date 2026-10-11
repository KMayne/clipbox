import { z } from 'zod';
import type { ModuleId } from './modules/types';
import type { ModulesManifest, SwRequest, SwResponse } from './swProtocol';
import { useUiStore } from './state/uiStore';

export type CacheState =
  | { state: 'unsupported' }
  | { state: 'none' }
  | { state: 'downloading'; progress: number }
  | { state: 'cached' };

export type { ModulesManifest } from './swProtocol';

const manifestSchema = z.object({
  version: z.string(),
  core: z.array(z.string()),
  modules: z.record(z.string(), z.object({ files: z.array(z.string()), bytes: z.number() })),
}) satisfies z.ZodType<ModulesManifest>;

const responseSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('status'), cached: z.array(z.string()) }),
  z.object({ type: z.literal('progress'), done: z.number(), total: z.number() }),
  z.object({ type: z.literal('done') }),
  z.object({ type: z.literal('error'), message: z.string() }),
]) satisfies z.ZodType<SwResponse>;

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
    channel.port1.onmessage = (e: MessageEvent<unknown>) => {
      const parsed = responseSchema.safeParse(e.data);
      if (!parsed.success) return reject(new Error('Malformed service worker response'));
      const res = parsed.data;
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
    // Reload only when an update replaces the controlling worker. On a first visit the new
    // worker claims the page (controller goes null → set), which must not reload it.
    let hadController = navigator.serviceWorker.controller !== null;
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) {
        hadController = true;
        return;
      }
      if (reloading) return;
      reloading = true;
      location.reload();
    });
  },

  manifest(): Promise<ModulesManifest | null> {
    manifest ??= fetch('/modules-manifest.json')
      .then(async r => (r.ok ? manifestSchema.parse(await r.json()) : null))
      .catch(() => null);
    return manifest;
  },

  async status(): Promise<Record<string, CacheState>> {
    const m = await sw.manifest();
    if (!supported || !m) return {};
    const res = await request({ type: 'status' });
    const cached = res.type === 'status' ? new Set(res.cached) : new Set<ModuleId>();
    return Object.fromEntries(
      Object.keys(m.modules).map((id): [string, CacheState] => [
        id,
        { state: cached.has(id) ? 'cached' : 'none' },
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
