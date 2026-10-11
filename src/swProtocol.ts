/** Types shared by the page (swClient.ts) and the service worker (sw.ts). No runtime code. */

export interface ModulesManifest {
  version: string;
  core: string[];
  modules: Record<string, { files: string[]; bytes: number }>;
}

/** Page → service worker. */
export type SwRequest =
  | { type: 'status' }
  | { type: 'download'; id: string }
  | { type: 'remove'; id: string }
  | { type: 'skipWaiting' };

/** Service worker → page, over the request's MessagePort. */
export type SwResponse =
  | { type: 'status'; cached: string[] }
  | { type: 'progress'; done: number; total: number }
  | { type: 'done' }
  | { type: 'error'; message: string };
