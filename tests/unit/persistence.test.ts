import 'fake-indexeddb/auto';
import { createStore, set as idbSet } from 'idb-keyval';
import { describe, expect, it } from 'vitest';
import { sha256 } from '../../src/core/hash';
import type { Capture, CaptureId } from '../../src/core/types';
import type { CaptureEvent, CaptureView } from '../../src/state/captureStore';
import {
  HistoryDb,
  Persistence,
  type CaptureHost,
  type HistorySettings,
  type StoredCapture,
} from '../../src/state/persistence';

const DAY = 24 * 60 * 60 * 1000;
let dbCounter = 0;

/** Fresh databases per test. */
const freshNames = () => {
  dbCounter++;
  return { capturesDb: `test-captures-${dbCounter}`, blobsDb: `test-blobs-${dbCounter}` };
};

const hashOf = async (text: string) => sha256(new TextEncoder().encode(text));

async function stored(id: CaptureId, at: number, texts: string[]) {
  const blobs = new Map<string, Blob>();
  const entries = [];
  for (const [i, text] of texts.entries()) {
    const hash = await hashOf(text);
    blobs.set(hash, new Blob([text], { type: 'text/plain' }));
    entries.push({
      id: `en-${id}-${i}` as const,
      mime: 'text/plain',
      size: text.length,
      hash,
    });
  }
  const capture: StoredCapture = { id, at, source: 'paste', entries };
  return { capture, blobs };
}

function view(id: CaptureId, at: number, texts: string[]): CaptureView {
  return {
    id,
    at,
    source: 'paste',
    collapsed: false,
    entries: texts.map((text, i) => ({
      id: `en-${id}-${i}`,
      mime: 'text/plain',
      size: text.length,
      blob: new Blob([text], { type: 'text/plain' }),
      status: 'pending',
      preview: null,
      interpretations: [],
    })),
  };
}

/** In-memory stand-in for captureStore. */
function fakeHost() {
  const listeners = new Set<(e: CaptureEvent) => void>();
  let live: { id: CaptureId; at: number }[] = [];
  const restored: Capture[][] = [];
  const host: CaptureHost = {
    captures: () => live,
    restore: captures => {
      restored.push(captures);
      live = [...live, ...captures];
    },
    remove: id => {
      live = live.filter(c => c.id !== id);
      emit({ type: 'removed', captureIds: [id] });
    },
    subscribe: fn => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  const emit = (e: CaptureEvent) => listeners.forEach(fn => fn(e));
  /** Simulates captureStore.add() followed by ingest settling every entry. */
  const add = async (v: CaptureView) => {
    live = [{ id: v.id, at: v.at }, ...live];
    emit({ type: 'added', capture: v });
    for (const e of v.entries) {
      emit({
        type: 'settled',
        captureId: v.id,
        entryId: e.id,
        hash: await sha256(new Uint8Array(await e.blob.arrayBuffer())),
      });
    }
  };
  return { host, emit, add, restored };
}

/** Waits until queued async work has flushed. */
const settle = async (db: HistoryDb) => {
  for (let i = 0; i < 5; i++) {
    await new Promise(r => setTimeout(r, 0));
    await db.gc();
  }
};

describe('HistoryDb', () => {
  it('round-trips captures and blobs, newest first', async () => {
    const db = new HistoryDb(freshNames());
    const a = await stored('c-a', 1000, ['hello']);
    const b = await stored('c-b', 2000, ['[1,2]', 'world']);
    await db.save(a.capture, a.blobs);
    await db.save(b.capture, b.blobs);

    const list = await db.list();
    expect(list.map(c => c.id)).toEqual(['c-b', 'c-a']);
    expect(list[0]).toEqual(b.capture);
    const blob = await db.blob(b.capture.entries[1]?.hash ?? '');
    expect(await blob?.text()).toBe('world');
  });

  it('round-trips derived captures with their parent link', async () => {
    const db = new HistoryDb(freshNames());
    const { capture, blobs } = await stored('c-d', 1000, ['{"a":1}']);
    const derived: StoredCapture = {
      ...capture,
      source: 'derived',
      parent: { entryId: 'en-c-p-0', kind: 'base64', label: 'Decode' },
    };
    await db.save(derived, blobs);
    expect(await db.list()).toEqual([derived]);
  });

  it('stores identical content once and garbage-collects unreferenced blobs', async () => {
    const db = new HistoryDb(freshNames());
    const a = await stored('c-a', 1000, ['same', 'only-a']);
    const b = await stored('c-b', 2000, ['same']);
    await db.save(a.capture, a.blobs);
    await db.save(b.capture, b.blobs);
    expect(await db.blobKeys()).toHaveLength(2);

    await db.remove(['c-a']);
    expect(await db.blobKeys()).toEqual([await hashOf('same')]);

    await db.remove(['c-b']);
    expect(await db.blobKeys()).toEqual([]);
  });

  it('prunes expired captures and those beyond the cap', async () => {
    const db = new HistoryDb(freshNames());
    const now = 100 * DAY;
    const old = await stored('c-old', now - 8 * DAY, ['old']);
    const fresh = await stored('c-new', now - 1 * DAY, ['new']);
    await db.save(old.capture, old.blobs);
    await db.save(fresh.capture, fresh.blobs);

    expect(await db.prune(7 * DAY, now)).toEqual(['c-old']);
    expect((await db.list()).map(c => c.id)).toEqual(['c-new']);
    expect(await db.blobKeys()).toEqual([await hashOf('new')]);

    // Forever: nothing expires, but the cap still applies
    const older = await stored('c-older', 0, ['x']);
    await db.save(older.capture, older.blobs);
    expect(await db.prune(null, now)).toEqual([]);
    expect(await db.prune(null, now, 1)).toEqual(['c-older']);
  });

  it('drops malformed records instead of failing', async () => {
    const names = freshNames();
    const db = new HistoryDb(names);
    const good = await stored('c-good', 1000, ['ok']);
    await db.save(good.capture, good.blobs);

    const raw = createStore(names.capturesDb, 'captures');
    await idbSet('c-bad', { id: 'c-bad', at: 'yesterday', source: 'paste', entries: [] }, raw);
    await idbSet(
      'c-wrongsource',
      { ...good.capture, id: 'c-wrongsource', source: 'telepathy' },
      raw,
    );
    await idbSet('c-mismatch', { ...good.capture }, raw);
    await idbSet('junk', 42, raw);

    expect((await db.list()).map(c => c.id)).toEqual(['c-good']);
    // Malformed records were deleted
    expect((await db.list()).length).toBe(1);

    // A non-Blob stored under a hash isn't returned as one
    await idbSet('deadbeef', 'not a blob', createStore(names.blobsDb, 'blobs'));
    expect(await db.blob('deadbeef')).toBeUndefined();
  });
});

describe('Persistence', () => {
  const settingsOf = (s: Partial<HistorySettings> = {}) => {
    const settings: HistorySettings = { keepHistory: true, keepFor: '7d', ...s };
    return { settings, get: () => settings };
  };

  it('saves added captures and restores them after a "reload"', async () => {
    const names = freshNames();
    const now = 50 * DAY;
    const db = new HistoryDb(names);
    const { host, add } = fakeHost();
    const s = settingsOf();
    const p = new Persistence({ db, host, settings: s.get, now: () => now });
    await p.start();

    await add(view('c-1', now - 2000, ['first']));
    await add(view('c-2', now - 1000, ['second', 'first']));
    await settle(db);
    expect((await db.list()).map(c => c.id)).toEqual(['c-2', 'c-1']);
    expect(await db.blobKeys()).toHaveLength(2);
    p.stop();

    // New session
    const next = fakeHost();
    const p2 = new Persistence({
      db: new HistoryDb(names),
      host: next.host,
      settings: s.get,
      now: () => now,
    });
    await p2.start();
    p2.stop();
    expect(next.restored).toHaveLength(1);
    const [newest, oldest] = next.restored[0] ?? [];
    expect(newest?.id).toBe('c-2');
    expect(oldest?.id).toBe('c-1');
    expect(newest?.entries.map(e => e.id)).toEqual(['en-c-2-0', 'en-c-2-1']);
    expect(await newest?.entries[0]?.blob.text()).toBe('second');
  });

  it('deletes removed captures and evictions from storage', async () => {
    const db = new HistoryDb(freshNames());
    const { host, add, emit } = fakeHost();
    const p = new Persistence({ db, host, settings: settingsOf().get });
    await p.start();
    await add(view('c-1', Date.now(), ['a']));
    await add(view('c-2', Date.now(), ['b']));
    await settle(db);

    host.remove('c-1');
    await settle(db);
    expect((await db.list()).map(c => c.id)).toEqual(['c-2']);
    expect(await db.blobKeys()).toEqual([await hashOf('b')]);

    emit({ type: 'cleared' });
    await settle(db);
    expect(await db.list()).toEqual([]);
    expect(await db.blobKeys()).toEqual([]);
    p.stop();
  });

  it('prunes expired history on startup and hourly', async () => {
    const names = freshNames();
    let now = 100 * DAY;
    const db = new HistoryDb(names);
    const old = await stored('c-old', now - 2 * DAY, ['old']);
    const recent = await stored('c-recent', now - 1000, ['recent']);
    await db.save(old.capture, old.blobs);
    await db.save(recent.capture, recent.blobs);

    const { host, restored } = fakeHost();
    const p = new Persistence({
      db,
      host,
      settings: settingsOf({ keepFor: '1d' }).get,
      now: () => now,
    });
    await p.start();
    expect(restored[0]?.map(c => c.id)).toEqual(['c-recent']);

    // An hour-or-so later, the remaining capture has expired too
    now += DAY;
    await p.expire();
    await settle(db);
    expect(host.captures()).toEqual([]);
    expect(await db.list()).toEqual([]);
    expect(await db.blobKeys()).toEqual([]);
    p.stop();
  });

  it('drops a saved capture whose blob is missing', async () => {
    const db = new HistoryDb(freshNames());
    const a = await stored('c-a', Date.now(), ['a']);
    await db.save(a.capture, new Map());
    const { host, restored } = fakeHost();
    const p = new Persistence({ db, host, settings: settingsOf().get });
    await p.start();
    p.stop();
    expect(restored[0]).toEqual([]);
    expect(await db.list()).toEqual([]);
  });

  it('with keep history off, clears storage and stops saving', async () => {
    const names = freshNames();
    const db = new HistoryDb(names);
    const { host, add } = fakeHost();
    const s = settingsOf();
    const p = new Persistence({ db, host, settings: s.get });
    await p.start();
    await add(view('c-1', Date.now(), ['kept']));
    await settle(db);
    expect(await db.list()).toHaveLength(1);

    s.settings.keepHistory = false;
    await p.setKeepHistory(false);
    expect(await db.list()).toEqual([]);
    expect(await db.blobKeys()).toEqual([]);

    await add(view('c-2', Date.now(), ['not kept']));
    await settle(db);
    expect(await db.list()).toEqual([]);
    p.stop();

    // A later session with history off restores nothing
    const next = fakeHost();
    const p2 = new Persistence({ db: new HistoryDb(names), host: next.host, settings: s.get });
    await p2.start();
    p2.stop();
    expect(next.restored).toEqual([]);
  });
});
