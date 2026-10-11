/*
 * Service worker: precaches the app shell and lets the user download lazily-loaded modules for
 * offline use. Built by vite/modulesManifest.ts, which inlines the build manifest below.
 * Not bundled with the app: no imports.
 */
import type { ModulesManifest, SwRequest, SwResponse } from './swClient';

// Minimal ServiceWorker typings (the WebWorker lib conflicts with DOM in this tsconfig)
interface ExtendableEvent extends Event {
  waitUntil(p: Promise<unknown>): void;
}
interface FetchEvent extends ExtendableEvent {
  request: Request;
  respondWith(r: Promise<Response>): void;
}
interface ExtendableMessageEvent extends ExtendableEvent {
  data: SwRequest;
  ports: readonly MessagePort[];
}
interface SwScope {
  registration: { active: unknown };
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void> };
  location: Location;
  addEventListener(type: 'install' | 'activate', fn: (e: ExtendableEvent) => void): void;
  addEventListener(type: 'fetch', fn: (e: FetchEvent) => void): void;
  addEventListener(type: 'message', fn: (e: ExtendableMessageEvent) => void): void;
}

declare const __MANIFEST__: ModulesManifest;
const MANIFEST: ModulesManifest = __MANIFEST__;
const scope = self as unknown as SwScope;

const PREFIX = 'clipbox-';
const CORE_CACHE = `${PREFIX}core-${MANIFEST.version}`;
const META_CACHE = `${PREFIX}meta`;
const DOWNLOADED_KEY = '/__clipbox/downloaded';
const moduleCache = (id: string) => `${PREFIX}mod-${id}-${MANIFEST.version}`;
const url = (file: string) => `/${file}`;

async function readDownloaded(): Promise<string[]> {
  const res = await (await caches.open(META_CACHE)).match(DOWNLOADED_KEY);
  return res ? ((await res.json()) as string[]) : [];
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

scope.addEventListener('install', e => {
  e.waitUntil(
    (async () => {
      await (
        await caches.open(CORE_CACHE)
      ).addAll(['/', '/modules-manifest.json', ...MANIFEST.core.map(url)]);
      // First install: take over immediately. Updates wait for the user to click Reload.
      if (!scope.registration.active) await scope.skipWaiting();
    })(),
  );
});

scope.addEventListener('activate', e => {
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
      await scope.clients.claim();
      // Re-download modules the user had downloaded under the previous version
      const downloaded = (await readDownloaded()).filter(id => MANIFEST.modules[id]);
      await writeDownloaded(downloaded);
      for (const id of downloaded) await download(id, () => {}).catch(() => {});
    })(),
  );
});

scope.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== scope.location.origin) return;
  e.respondWith(
    (async () => {
      // Build files are content-hashed, so Vary (e.g. Origin from vite preview) can be ignored
      const key = req.mode === 'navigate' ? '/' : req;
      return (await caches.match(key, { ignoreVary: true })) ?? fetch(req);
    })(),
  );
});

scope.addEventListener('message', e => {
  const port = e.ports[0];
  const reply = (msg: SwResponse) => port?.postMessage(msg);
  const req = e.data;
  const work = (async () => {
    try {
      switch (req.type) {
        case 'status': {
          const ids = Object.keys(MANIFEST.modules);
          const cached = (await Promise.all(ids.map(isCached))).flatMap((ok, i) =>
            ok ? [ids[i]!] : [],
          );
          return reply({ type: 'status', cached });
        }
        case 'download':
          await download(req.id, (done, total) => reply({ type: 'progress', done, total }));
          return reply({ type: 'done' });
        case 'remove':
          await caches.delete(moduleCache(req.id));
          await writeDownloaded((await readDownloaded()).filter(id => id !== req.id));
          return reply({ type: 'done' });
        case 'skipWaiting':
          await scope.skipWaiting();
          return reply({ type: 'done' });
      }
    } catch (err) {
      reply({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  })();
  e.waitUntil(work);
});
