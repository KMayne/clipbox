import {
  clear as idbClear,
  createStore,
  delMany,
  entries as idbEntries,
  get as idbGet,
  keys as idbKeys,
  set as idbSet,
  type UseStore,
} from 'idb-keyval';
import { z } from 'zod';
import { create } from 'zustand';
import { sha256 } from '../core/hash';
import type { Capture, CaptureId, CaptureSourceId, EntryId, RawEntry } from '../core/types';
import type { CaptureEvent, CaptureView } from './captureStore';

/*
 * Saves captures to IndexedDB so they survive a reload.
 *
 * Two idb-keyval stores: capture metadata keyed by capture id, and blobs keyed by their SHA-256
 * so identical content is stored once. Blobs no capture references are garbage-collected.
 * Everything read back is validated; malformed records are dropped.
 */

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
/** Mirrors captureStore's MAX_CAPTURES; not imported so this module stays free of the engine. */
const MAX_SAVED = 50;

// ---- Settings ----------------------------------------------------------------------------

export const KEEP_FOR = ['1d', '7d', '30d', 'forever'] as const;
export type KeepFor = (typeof KEEP_FOR)[number];

export const KEEP_FOR_MS: Record<KeepFor, number | null> = {
  '1d': DAY,
  '7d': 7 * DAY,
  '30d': 30 * DAY,
  forever: null,
};

const SETTINGS_KEY = 'clipbox.settings';

const settingsSchema = z.object({
  keepHistory: z.boolean().catch(true).default(true),
  keepFor: z.enum(KEEP_FOR).catch('7d').default('7d'),
});

export type HistorySettings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: HistorySettings = { keepHistory: true, keepFor: '7d' };

export function loadSettings(): HistorySettings {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
    const parsed = settingsSchema.safeParse(raw);
    return parsed.success ? parsed.data : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(settings: HistorySettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // storage unavailable: settings just won't persist
  }
}

// ---- Stored records ------------------------------------------------------------------------

const SOURCES = [
  'paste',
  'read',
  'drop',
  'file',
  'share',
  'derived',
] as const satisfies readonly CaptureSourceId[];

const storedEntrySchema = z.object({
  id: z.templateLiteral(['en-', z.string()]),
  mime: z.string(),
  size: z.number().int().nonnegative(),
  name: z.string().optional(),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
});

const storedCaptureSchema = z.object({
  id: z.templateLiteral(['c-', z.string()]),
  at: z.number().finite(),
  source: z.enum(SOURCES),
  entries: z.array(storedEntrySchema).min(1),
  /** Set for derived captures; the parent may since have been removed. */
  parent: z
    .object({
      entryId: z.templateLiteral(['en-', z.string()]),
      kind: z.string(),
      label: z.string(),
    })
    .optional(),
});

export type StoredEntry = z.infer<typeof storedEntrySchema>;
export type StoredCapture = z.infer<typeof storedCaptureSchema>;

const blobSchema = z.instanceof(Blob);

// ---- Database ------------------------------------------------------------------------------

export interface HistoryDbOptions {
  /** IndexedDB database names; overridden in tests. */
  capturesDb?: string;
  blobsDb?: string;
}

export class HistoryDb {
  private readonly captures: UseStore;
  private readonly blobs: UseStore;
  /** Operations run one at a time so GC never races a save. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor({ capturesDb = 'clipbox', blobsDb = 'clipbox-blobs' }: HistoryDbOptions = {}) {
    this.captures = createStore(capturesDb, 'captures');
    this.blobs = createStore(blobsDb, 'blobs');
  }

  private run<T>(op: () => Promise<T>): Promise<T> {
    const next = this.queue.then(op);
    this.queue = next.catch(() => {});
    return next;
  }

  /** Writes a capture and any of its blobs not already stored. */
  save(capture: StoredCapture, blobs: Map<string, Blob>): Promise<void> {
    return this.run(async () => {
      for (const [hash, blob] of blobs) {
        const existing: unknown = await idbGet(hash, this.blobs);
        if (!blobSchema.safeParse(existing).success) await idbSet(hash, blob, this.blobs);
      }
      await idbSet(capture.id, capture, this.captures);
    });
  }

  /** Valid captures, newest first. Malformed records are deleted. */
  list(): Promise<StoredCapture[]> {
    return this.run(() => this.listNow());
  }

  private async listNow(): Promise<StoredCapture[]> {
    const valid: StoredCapture[] = [];
    const bad: IDBValidKey[] = [];
    for (const [key, value] of await idbEntries(this.captures)) {
      const parsed = storedCaptureSchema.safeParse(value);
      if (parsed.success && parsed.data.id === key) valid.push(parsed.data);
      else bad.push(key);
    }
    if (bad.length > 0) await delMany(bad, this.captures);
    return valid.sort((a, b) => b.at - a.at);
  }

  async blob(hash: string): Promise<Blob | undefined> {
    const parsed = blobSchema.safeParse(await this.run(() => idbGet(hash, this.blobs)));
    return parsed.success ? parsed.data : undefined;
  }

  remove(ids: CaptureId[]): Promise<void> {
    return this.run(async () => {
      await delMany(ids, this.captures);
      await this.gcNow();
    });
  }

  /**
   * Deletes captures older than `maxAge` (null: never expire) or beyond the newest `limit`,
   * then garbage-collects blobs. Returns the ids removed.
   */
  prune(maxAge: number | null, now: number, limit = MAX_SAVED): Promise<CaptureId[]> {
    return this.run(async () => {
      const all = await this.listNow();
      const doomed = all
        .filter((c, i) => i >= limit || (maxAge !== null && now - c.at > maxAge))
        .map(c => c.id);
      if (doomed.length > 0) await delMany(doomed, this.captures);
      await this.gcNow();
      return doomed;
    });
  }

  /** Deletes blobs that no remaining capture references. */
  gc(): Promise<void> {
    return this.run(() => this.gcNow());
  }

  private async gcNow() {
    const referenced = new Set((await this.listNow()).flatMap(c => c.entries.map(e => e.hash)));
    const orphans = (await idbKeys(this.blobs)).filter(
      k => typeof k !== 'string' || !referenced.has(k),
    );
    if (orphans.length > 0) await delMany(orphans, this.blobs);
  }

  blobKeys(): Promise<IDBValidKey[]> {
    return this.run(() => idbKeys(this.blobs));
  }

  clear(): Promise<void> {
    return this.run(async () => {
      await idbClear(this.captures);
      await idbClear(this.blobs);
    });
  }
}

// ---- Wiring ----------------------------------------------------------------------------------

/** The slice of captureStore persistence needs; injected so tests can fake it. */
export interface CaptureHost {
  captures(): Pick<CaptureView, 'id' | 'at'>[];
  restore(captures: Capture[]): void;
  remove(id: CaptureId): void;
  subscribe(fn: (e: CaptureEvent) => void): () => void;
}

export interface PersistenceDeps {
  db: HistoryDb;
  host: CaptureHost;
  settings(): HistorySettings;
  now?: () => number;
  onError?: (err: unknown) => void;
}

interface Pending {
  capture: StoredCapture;
  blobs: Map<EntryId, Blob>;
  hashes: Map<EntryId, string>;
}

export class Persistence {
  private readonly db: HistoryDb;
  private readonly host: CaptureHost;
  private readonly settings: () => HistorySettings;
  private readonly now: () => number;
  private readonly onError: (err: unknown) => void;
  private readonly pending = new Map<CaptureId, Pending>();
  private unsubscribe?: () => void;
  private timer?: ReturnType<typeof setInterval>;

  constructor({ db, host, settings, now = Date.now, onError = console.error }: PersistenceDeps) {
    this.db = db;
    this.host = host;
    this.settings = settings;
    this.now = now;
    this.onError = onError;
  }

  /** Subscribes to capture events, restores saved history and starts the hourly expiry. */
  async start(): Promise<void> {
    this.unsubscribe = this.host.subscribe(e => this.onEvent(e));
    this.timer = setInterval(() => void this.expire(), HOUR);
    try {
      if (!this.settings().keepHistory) return await this.db.clear();
      await this.restore();
    } catch (err) {
      this.onError(err);
    }
  }

  stop() {
    this.unsubscribe?.();
    clearInterval(this.timer);
  }

  private maxAge() {
    return KEEP_FOR_MS[this.settings().keepFor];
  }

  private async restore() {
    await this.db.prune(this.maxAge(), this.now());
    const restored: Capture[] = [];
    // Anything pasted while we were reading is already live (and may already be saved)
    const live = new Set(this.host.captures().map(c => c.id));
    for (const c of await this.db.list()) {
      if (live.has(c.id)) continue;
      const entries: RawEntry[] = [];
      for (const e of c.entries) {
        const blob = await this.db.blob(e.hash);
        if (!blob) break;
        entries.push({ id: e.id, mime: e.mime, size: e.size, name: e.name, blob });
      }
      if (entries.length === c.entries.length) restored.push({ ...c, entries });
      else await this.db.remove([c.id]); // a blob went missing: drop the capture
    }
    this.host.restore(restored);
  }

  /** Removes expired captures from memory and storage. Runs on startup and hourly. */
  async expire(): Promise<void> {
    if (!this.settings().keepHistory) return;
    const maxAge = this.maxAge();
    const now = this.now();
    try {
      if (maxAge !== null)
        for (const c of this.host.captures()) if (now - c.at > maxAge) this.host.remove(c.id);
      await this.db.prune(maxAge, now);
    } catch (err) {
      this.onError(err);
    }
  }

  /** Turning history off deletes everything stored; turning it on saves new captures only. */
  async setKeepHistory(on: boolean): Promise<void> {
    if (on) return;
    this.pending.clear();
    await this.db.clear();
  }

  async clearStorage(): Promise<void> {
    this.pending.clear();
    await this.db.clear();
  }

  private onEvent(e: CaptureEvent) {
    switch (e.type) {
      case 'added':
        if (this.settings().keepHistory) this.track(e.capture);
        break;
      case 'settled':
        void this.settle(e.captureId, e.entryId, e.hash);
        break;
      case 'removed':
        e.captureIds.forEach(id => this.pending.delete(id));
        this.db.remove(e.captureIds).catch(this.onError);
        break;
      case 'cleared':
        this.clearStorage().catch(this.onError);
        break;
    }
  }

  private track(view: CaptureView) {
    this.pending.set(view.id, {
      // Hashes are filled in as entries settle
      capture: {
        id: view.id,
        at: view.at,
        source: view.source,
        ...(view.parent && { parent: view.parent }),
        entries: view.entries.map(({ id, mime, size, name }) => ({
          id,
          mime,
          size,
          name,
          hash: '',
        })),
      },
      blobs: new Map(view.entries.map(e => [e.id, e.blob])),
      hashes: new Map(),
    });
    // Entries awaiting a size confirmation won't be ingested yet, so hash them here
    for (const e of view.entries) if (e.status !== 'pending') void this.settle(view.id, e.id);
  }

  private async settle(captureId: CaptureId, entryId: EntryId, hash?: string) {
    const p = this.pending.get(captureId);
    const blob = p?.blobs.get(entryId);
    if (!p || !blob) return;
    try {
      // Ingest failed: hash it ourselves
      const h = hash ?? (await sha256(new Uint8Array(await blob.arrayBuffer())));
      p.hashes.set(entryId, h);
      if (p.hashes.size < p.capture.entries.length || this.pending.get(captureId) !== p) return;
      this.pending.delete(captureId);
      const capture: StoredCapture = {
        ...p.capture,
        entries: p.capture.entries.map(e => ({ ...e, hash: p.hashes.get(e.id) ?? '' })),
      };
      const blobs = new Map<string, Blob>();
      for (const e of capture.entries) {
        const b = p.blobs.get(e.id);
        if (b) blobs.set(e.hash, b);
      }
      await this.db.save(capture, blobs);
    } catch (err) {
      this.onError(err);
    }
  }
}

// ---- App singleton -------------------------------------------------------------------------

interface HistoryState {
  settings: HistorySettings;
  setKeepHistory(on: boolean): Promise<void>;
  setKeepFor(keepFor: KeepFor): void;
  /** Clears memory and storage. */
  clearAll(): Promise<void>;
}

let persistence: Persistence | null = null;
let clearMemory: () => void = () => {};

export const useHistoryStore = create<HistoryState>((set, get) => {
  const update = (patch: Partial<HistorySettings>) => {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    saveSettings(settings);
  };
  return {
    settings: loadSettings(),
    async setKeepHistory(on) {
      update({ keepHistory: on });
      await persistence?.setKeepHistory(on);
    },
    setKeepFor(keepFor) {
      update({ keepFor });
      void persistence?.expire();
    },
    async clearAll() {
      clearMemory();
      await persistence?.clearStorage();
    },
  };
});

/** Starts persistence for the app. `clear` wipes in-memory captures for "Clear all data". */
export function startPersistence(host: CaptureHost, clear: () => void): Promise<void> {
  clearMemory = clear;
  persistence = new Persistence({
    db: new HistoryDb(),
    host,
    settings: () => useHistoryStore.getState().settings,
  });
  return persistence.start();
}

export async function storageUsed(): Promise<number | null> {
  try {
    const { usage } = await navigator.storage.estimate();
    return usage ?? null;
  } catch {
    return null;
  }
}
