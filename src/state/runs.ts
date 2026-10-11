/**
 * Long-running actions and derivations in progress, for the progress bars (the sidebar row and
 * the running-actions strip by the notice). The worker reports progress through one proxied
 * listener; each run has a UI-side AbortController so Cancel takes effect at once, even while the
 * worker is busy, and a matching `engine.cancelAction` so the worker stops too.
 */
import * as Comlink from 'comlink';
import { z } from 'zod';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { CaptureId, EntryId, Kind } from '../core/types';
import { engine } from '../engine/engineClient';
import { onCaptureEvent, useCaptureStore, type Selection } from './captureStore';

/** Runs that finish sooner than this never show a bar (no flash on instant actions). */
export const SHOW_AFTER_MS = 300;

export interface RunView {
  id: string;
  /** e.g. "Normalise audio". */
  title: string;
  /** The action's id, or `open.<derivation id>` for a derivation. */
  key: string;
  entryId: EntryId;
  kind: Kind;
  /** The capture holding the source entry; removing it cancels the run. */
  captureId?: CaptureId;
  /** 0..1, or undefined while indeterminate. */
  fraction?: number;
  message?: string;
  /** Past SHOW_AFTER_MS, so bars may show. */
  shown: boolean;
  cancelling: boolean;
}

interface RunState {
  runs: RunView[];
  /** Runs whose sidebar row is on screen showing the bar; the strip leaves them out. */
  docked: Record<string, number>;
}

export const useRunStore = create<RunState>(() => ({ runs: [], docked: {} }));

const captureOf = (entryId: EntryId) =>
  useCaptureStore.getState().captures.find(c => c.entries.some(e => e.id === entryId))?.id;

const without = <T>(record: Record<string, T>, key: string): Record<string, T> =>
  Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));

const controllers = new Map<string, AbortController>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

const patch = (id: string, p: Partial<RunView>) =>
  useRunStore.setState(s => ({ runs: s.runs.map(r => (r.id === id ? { ...r, ...p } : r)) }));

/** Starts tracking a run; pass `id` to the engine and `signal` to the capture store. */
export function startRun(
  title: string,
  key: string,
  selection: Selection,
): { id: string; signal: AbortSignal } {
  const id = `run-${crypto.randomUUID()}`;
  const controller = new AbortController();
  controllers.set(id, controller);
  const run: RunView = {
    id,
    title,
    key,
    entryId: selection.entryId,
    kind: selection.kind,
    captureId: captureOf(selection.entryId),
    shown: false,
    cancelling: false,
  };
  useRunStore.setState(s => ({ runs: [...s.runs, run] }));
  timers.set(
    id,
    setTimeout(() => patch(id, { shown: true }), SHOW_AFTER_MS),
  );
  return { id, signal: controller.signal };
}

export function endRun(id: string) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  controllers.delete(id);
  useRunStore.setState(s => {
    return { runs: s.runs.filter(r => r.id !== id), docked: without(s.docked, id) };
  });
}

/** Cancels a run: its promise rejects with an AbortError now, and the worker is told to stop. */
export function cancelRun(id: string) {
  const controller = controllers.get(id);
  if (!controller || controller.signal.aborted) return;
  patch(id, { cancelling: true });
  controller.abort();
  void engine.cancelAction(id).catch(() => {});
}

/** Marks a run's bar as shown in place (`true`) or not; counted, for StrictMode double mounts. */
export function dockRun(id: string, docked: boolean) {
  useRunStore.setState(s => {
    const n = (s.docked[id] ?? 0) + (docked ? 1 : -1);
    return { docked: n > 0 ? { ...s.docked, [id]: n } : without(s.docked, id) };
  });
}

// --- Progress from the worker (a trust boundary) ---

const progressSchema = z.object({
  runId: z.string(),
  fraction: z.number().min(0).max(1).optional(),
  message: z.string().max(200).optional(),
});

export function applyProgress(data: unknown) {
  const parsed = progressSchema.safeParse(data);
  if (!parsed.success) return;
  const { runId, fraction, message } = parsed.data;
  if (!controllers.has(runId)) return; // finished or cancelled
  patch(runId, { fraction, message });
}

void engine.onProgress(Comlink.proxy(applyProgress)).catch(() => {});

// --- Cancel runs whose source goes away ---

onCaptureEvent(e => {
  if (e.type === 'cleared') {
    for (const r of useRunStore.getState().runs) cancelRun(r.id);
  } else if (e.type === 'removed') {
    for (const r of useRunStore.getState().runs)
      if (r.captureId && e.captureIds.includes(r.captureId)) cancelRun(r.id);
  }
});

/** "Pass 1 of 2 · measuring loudness · 43%". */
export function progressText(run: Pick<RunView, 'fraction' | 'message' | 'cancelling'>): string {
  if (run.cancelling) return 'Cancelling…';
  const pct = run.fraction === undefined ? null : `${Math.floor(run.fraction * 100)}%`;
  return [run.message, pct].filter(Boolean).join(' · ') || 'Working…';
}

/** Shown runs of `key` (an action id or derivation key) on `selection`. */
export function useRunsFor(selection: Selection, key: string): RunView[] {
  return useRunStore(
    useShallow(s =>
      s.runs.filter(
        r =>
          r.shown && r.key === key && r.entryId === selection.entryId && r.kind === selection.kind,
      ),
    ),
  );
}
