import { create } from 'zustand';
import type {
  Capture,
  CaptureId,
  CaptureSourceId,
  Derivation,
  EntryId,
  Interpretation,
  Kind,
  RawEntry,
} from '../core/types';
import { engine } from '../engine/engineClient';
import { dropHandles } from '../engine/valueHandle';
import type { ModuleId } from '../modules/types';
import { onPolicyChange } from './moduleStore';

export const MAX_CAPTURES = 50;
export const CONFIRM_BYTES = 50 * 1024 * 1024;

export type EntryStatus = 'pending' | 'ready' | 'error' | 'confirm';

export interface EntryView extends RawEntry {
  status: EntryStatus;
  preview: string | null;
  thumbUrl?: string;
  interpretations: Interpretation[];
  error?: string;
}

export interface CaptureView extends Omit<Capture, 'entries'> {
  entries: EntryView[];
  collapsed: boolean;
}

export interface Selection {
  entryId: EntryId;
  kind: Kind;
}

export type NewEntry = Omit<RawEntry, 'id'>;

/**
 * Lifecycle events for persistence (state/persistence.ts). `settled` fires once per entry
 * ingested from add(), with the engine's content hash if ingest succeeded. `removed` covers
 * remove() and eviction past MAX_CAPTURES; clear() fires `cleared` instead.
 */
export type CaptureEvent =
  | { type: 'added'; capture: CaptureView }
  | { type: 'settled'; captureId: CaptureId; entryId: EntryId; hash?: string }
  | { type: 'removed'; captureIds: CaptureId[] }
  | { type: 'cleared' };

const eventListeners = new Set<(e: CaptureEvent) => void>();

export const onCaptureEvent = (fn: (e: CaptureEvent) => void) => {
  eventListeners.add(fn);
  return () => eventListeners.delete(fn);
};

const emit = (e: CaptureEvent) => eventListeners.forEach(fn => fn(e));

interface CaptureState {
  captures: CaptureView[];
  selection: Selection | null;
  add(source: CaptureSourceId, entries: NewEntry[], parent?: Capture['parent']): void;
  /** Append saved captures (newest first) behind any live ones and ingest them one by one. */
  restore(captures: Capture[]): void;
  /** Runs a derivation on `from` and adds the result as a new, auto-selected capture. */
  derive(from: Selection, derivation: Derivation): Promise<void>;
  /** Resolves with the content hash, or undefined if the entry is gone or ingest failed. */
  ingest(entryId: EntryId): Promise<string | undefined>;
  remove(captureId: CaptureId): void;
  clear(): void;
  toggle(captureId: CaptureId): void;
  select(selection: Selection | null): void;
}

function release(capture: CaptureView) {
  for (const e of capture.entries) {
    if (e.thumbUrl) URL.revokeObjectURL(e.thumbUrl);
    dropHandles(e.id);
    void engine.forget(e.id);
  }
}

const entryView = (e: RawEntry): EntryView => ({
  ...e,
  status: e.size > CONFIRM_BYTES ? 'confirm' : 'pending',
  preview: null,
  interpretations: [],
  thumbUrl: e.mime.startsWith('image/') ? URL.createObjectURL(e.blob) : undefined,
});

export const useCaptureStore = create<CaptureState>((set, get) => {
  const updateEntry = (entryId: EntryId, patch: Partial<EntryView>) =>
    set(s => ({
      captures: s.captures.map(c => ({
        ...c,
        entries: c.entries.map(e => (e.id === entryId ? { ...e, ...patch } : e)),
      })),
    }));

  /** Select the best interpretation of the newest capture once it's ready, unless the user moved on. */
  const autoSelect = (captureId: CaptureId) => {
    const { captures, selection } = get();
    const capture = captures[0];
    if (!capture || capture.id !== captureId) return;
    if (selection && capture.entries.some(e => e.id === selection.entryId)) return;
    const best = capture.entries
      .flatMap(e => e.interpretations)
      .find(i => i.status === 'ready' || i.status === 'loading');
    if (best) set({ selection: { entryId: best.entryId, kind: best.kind } });
  };

  const setInterpretation = (entryId: EntryId, next: Interpretation) =>
    set(s => ({
      captures: s.captures.map(c => ({
        ...c,
        entries: c.entries.map(e =>
          e.id !== entryId
            ? e
            : {
                ...e,
                interpretations: e.interpretations.map(i => (i.kind === next.kind ? next : i)),
              },
        ),
      })),
    }));

  const resolve = async (entryId: EntryId, kind: Kind) => {
    try {
      setInterpretation(entryId, await engine.resolve(entryId, kind));
    } catch {
      // entry was removed while resolving
    }
  };

  /** When a module is switched back on, re-resolve chips that were blocked by it. */
  onPolicyChange((id: ModuleId, policy) => {
    if (policy === 'off') return;
    for (const c of get().captures) {
      for (const e of c.entries) {
        for (const i of e.interpretations) {
          if (i.module !== id || (i.status !== 'off' && i.status !== 'error')) continue;
          setInterpretation(e.id, { ...i, status: 'loading', error: undefined });
          void resolve(e.id, i.kind);
        }
      }
    }
  });

  return {
    captures: [],
    selection: null,

    add(source, newEntries, parent) {
      if (newEntries.length === 0) return;
      const capture: CaptureView = {
        id: `c-${crypto.randomUUID()}`,
        at: Date.now(),
        source,
        ...(parent && { parent }),
        collapsed: false,
        entries: newEntries.map(e => entryView({ ...e, id: `en-${crypto.randomUUID()}` })),
      };
      const kept = get().captures.map(c => ({ ...c, collapsed: true }));
      const evicted = kept.splice(MAX_CAPTURES - 1);
      evicted.forEach(release);
      set({ captures: [capture, ...kept] });
      emit({ type: 'added', capture });
      if (evicted.length > 0) emit({ type: 'removed', captureIds: evicted.map(c => c.id) });
      for (const e of capture.entries) {
        if (e.status !== 'pending') continue;
        void get()
          .ingest(e.id)
          .then(hash => emit({ type: 'settled', captureId: capture.id, entryId: e.id, hash }));
      }
    },

    restore(all) {
      const live = get().captures;
      const saved = all.filter(c => !live.some(l => l.id === c.id));
      const room = Math.max(0, MAX_CAPTURES - live.length);
      const restored: CaptureView[] = saved.slice(0, room).map((c, i) => ({
        ...c,
        collapsed: live.length > 0 || i > 0,
        entries: c.entries.map(entryView),
      }));
      if (saved.length > room)
        emit({ type: 'removed', captureIds: saved.slice(room).map(c => c.id) });
      if (restored.length === 0) return;
      set({ captures: [...live, ...restored] });
      // Sequentially, newest first, so a long history doesn't flood the engine
      void (async () => {
        for (const c of restored)
          for (const e of c.entries) if (e.status === 'pending') await get().ingest(e.id);
      })();
    },

    async ingest(entryId) {
      const capture = get().captures.find(c => c.entries.some(e => e.id === entryId));
      const entry = capture?.entries.find(e => e.id === entryId);
      if (!capture || !entry) return undefined;
      updateEntry(entryId, { status: 'pending' });
      try {
        const { blob, id, mime, size, name } = entry;
        const res = await engine.ingest({ id, mime, size, name, blob });
        updateEntry(entryId, {
          status: 'ready',
          preview: res.preview,
          interpretations: res.interpretations,
        });
        autoSelect(capture.id);
        for (const i of res.interpretations)
          if (i.status === 'loading') void resolve(entryId, i.kind);
        return res.hash;
      } catch (err) {
        updateEntry(entryId, { status: 'error', error: String(err) });
        return undefined;
      }
    },

    async derive(from, derivation) {
      const { mime, name, bytes } = await engine.derive(from.entryId, from.kind, derivation.id);
      const blob = new Blob([bytes], { type: mime });
      // add() collapses older captures; autoSelect picks the new one's best interpretation
      get().add('derived', [{ mime, name, size: blob.size, blob }], {
        entryId: from.entryId,
        kind: from.kind,
        label: derivation.label,
      });
    },

    remove(captureId) {
      const { captures, selection } = get();
      const capture = captures.find(c => c.id === captureId);
      if (!capture) return;
      release(capture);
      const selected = capture.entries.some(e => e.id === selection?.entryId);
      set({
        captures: captures.filter(c => c.id !== captureId),
        selection: selected ? null : selection,
      });
      emit({ type: 'removed', captureIds: [captureId] });
    },

    clear() {
      get().captures.forEach(release);
      void engine.clear();
      set({ captures: [], selection: null });
      emit({ type: 'cleared' });
    },

    toggle(captureId) {
      set(s => ({
        captures: s.captures.map(c => (c.id === captureId ? { ...c, collapsed: !c.collapsed } : c)),
      }));
    },

    select(selection) {
      set({ selection });
    },
  };
});

/** Flat list of chips in display order, for keyboard navigation. */
export function chipOrder(captures: CaptureView[]): Selection[] {
  return captures.flatMap(c =>
    c.collapsed
      ? []
      : c.entries.flatMap(e =>
          e.interpretations
            .filter(i => i.status !== 'off')
            .map(i => ({ entryId: e.id, kind: i.kind })),
        ),
  );
}

export function findEntry(captures: CaptureView[], entryId: EntryId) {
  for (const c of captures) {
    const entry = c.entries.find(e => e.id === entryId);
    if (entry) return { capture: c, entry };
  }
  return null;
}
