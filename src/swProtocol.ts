/** Types shared by the page (swClient.ts) and the service worker (sw.ts). No runtime code. */

export interface ModulesManifest {
  version: string;
  core: string[];
  /** `version` is the module's main library version, when the build could read it. */
  modules: Record<string, { files: string[]; bytes: number; version?: string }>;
}

/** Page → service worker. */
export type SwRequest =
  | { type: 'status' }
  | { type: 'download'; id: string }
  /** Deletes this version's caches and downloads them again (core plus downloaded modules). */
  | { type: 'repair' }
  | { type: 'skipWaiting' };

/** Service worker → page, over the request's MessagePort. */
export type SwResponse =
  | { type: 'status'; cached: string[] }
  | { type: 'progress'; done: number; total: number }
  | { type: 'done' }
  | { type: 'error'; message: string };

/*
 * Share target (manifest `share_target`): the service worker stashes each POSTed form field in
 * Cache Storage and redirects to the app, which ingests and deletes them (capture/share.ts).
 * Both sides declare their copies of these strings with these types, so they can't drift apart.
 */

/** The share target's URL, relative to the app's base. */
export type ShareAction = 'share-target';
/** Cache holding stashed shares (kept across service worker updates). */
export type ShareCacheName = 'clipbox-share';
/** Stashed parts live at `<base>__clipbox/share/<share id>/<part index>`. */
export type SharePath = '__clipbox/share/';
/** The query parameter the redirect adds: `?share=<share id>`. */
export type ShareParam = 'share';
/** Response headers on a stashed part: its form field and, for files, the URI-encoded file name. */
export type ShareHeaders = { field: 'x-clipbox-field'; filename: 'x-clipbox-filename' };
