/*
 * Service worker: precaches the app shell and lets the user download lazily-loaded modules for
 * offline use. Built by vite/modulesManifest.ts, which inlines the build manifest below.
 * Not bundled: only type imports are allowed (stripped by the build), so no Zod here.
 */
import type { ModulesManifest, SwRequest, SwResponse } from './swProtocol';

// Type-checked separately with the WebWorker lib (tsconfig.sw.json)
declare const self: ServiceWorkerGlobalScope;
declare const __MANIFEST__: ModulesManifest;
const MANIFEST: ModulesManifest = __MANIFEST__;

/** Messages come from our own pages, but they're still untyped data: check before use. */
function parseRequest(data: unknown): SwRequest | null {
  if (typeof data !== 'object' || data === null || !('type' in data)) return null;
  const id = 'id' in data && typeof data.id === 'string' ? data.id : null;
  switch (data.type) {
    case 'status':
    case 'skipWaiting':
      return { type: data.type };
    case 'download':
    case 'remove':
      return id === null ? null : { type: data.type, id };
    default:
      return null;
  }
}

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every(x => typeof x === 'string');

const PREFIX = 'clipbox-';
const CORE_CACHE = `${PREFIX}core-${MANIFEST.version}`;
const META_CACHE = `${PREFIX}meta`;
const DOWNLOADED_KEY = '/__clipbox/downloaded';
const moduleCache = (id: string) => `${PREFIX}mod-${id}-${MANIFEST.version}`;
/** Directory the app is served from (e.g. https://host/clipbox/), so it works under any base path. */
const BASE = self.registration.scope;
const url = (file: string) => new URL(file, BASE).href;

async function readDownloaded(): Promise<string[]> {
  const res = await (await caches.open(META_CACHE)).match(DOWNLOADED_KEY);
  const ids: unknown = res ? await res.json() : [];
  return isStringArray(ids) ? ids : [];
}

async function writeDownloaded(ids: string[]): Promise<void> {
  const body = JSON.stringify([...new Set(ids)]);
  await (await caches.open(META_CACHE)).put(DOWNLOADED_KEY, new Response(body));
}

async function download(id: string, onProgress: (done: number, total: number) => void) {
  const mod = MANIFEST.modules[id];
  if (!mod) throw new Error(`Unknown module '${id}'`);
  const cache = await caches.open(moduleCache(id));
  let done = 0;
  for (const file of mod.files) {
    if (!(await cache.match(url(file)))) {
      const res = await fetch(url(file), { cache: 'no-cache' });
      if (!res.ok) throw new Error(`Failed to fetch ${file}: ${res.status}`);
      await cache.put(url(file), res);
    }
    onProgress(++done, mod.files.length);
  }
  await writeDownloaded([...(await readDownloaded()), id]);
}

async function isCached(id: string): Promise<boolean> {
  const mod = MANIFEST.modules[id];
  if (!mod || !(await caches.has(moduleCache(id)))) return false;
  const keys = await (await caches.open(moduleCache(id))).keys();
  return keys.length >= mod.files.length;
}

self.addEventListener('install', e => {
  e.waitUntil(
    (async () => {
      await (
        await caches.open(CORE_CACHE)
      ).addAll([BASE, url('modules-manifest.json'), ...MANIFEST.core.map(url)]);
      // First install: take over immediately. Updates wait for the user to click Reload.
      if (!self.registration.active) await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    (async () => {
      const current = new Set([
        CORE_CACHE,
        META_CACHE,
        ...Object.keys(MANIFEST.modules).map(moduleCache),
      ]);
      for (const name of await caches.keys()) {
        if (name.startsWith(PREFIX) && !current.has(name)) await caches.delete(name);
      }
      await self.clients.claim();
      // Re-download modules the user had downloaded under the previous version
      const downloaded = (await readDownloaded()).filter(id => MANIFEST.modules[id]);
      await writeDownloaded(downloaded);
      for (const id of downloaded) await download(id, () => {}).catch(() => {});
    })(),
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    (async () => {
      // Build files are content-hashed, so Vary (e.g. Origin from vite preview) can be ignored
      const key = req.mode === 'navigate' ? BASE : req;
      return (await caches.match(key, { ignoreVary: true })) ?? fetch(req);
    })(),
  );
});

self.addEventListener('message', e => {
  const port = e.ports[0];
  const reply = (msg: SwResponse) => port?.postMessage(msg);
  const req = parseRequest(e.data);
  if (!req) return reply({ type: 'error', message: 'Unrecognised request' });
  const work = (async () => {
    try {
      switch (req.type) {
        case 'status': {
          const ids = Object.keys(MANIFEST.modules);
          const checks = await Promise.all(ids.map(async id => ({ id, ok: await isCached(id) })));
          return reply({ type: 'status', cached: checks.filter(c => c.ok).map(c => c.id) });
        }
        case 'download':
          await download(req.id, (done, total) => reply({ type: 'progress', done, total }));
          return reply({ type: 'done' });
        case 'remove':
          await caches.delete(moduleCache(req.id));
          await writeDownloaded((await readDownloaded()).filter(id => id !== req.id));
          return reply({ type: 'done' });
        case 'skipWaiting':
          await self.skipWaiting();
          return reply({ type: 'done' });
      }
    } catch (err) {
      reply({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  })();
  e.waitUntil(work);
});
