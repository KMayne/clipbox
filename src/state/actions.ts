import { z } from 'zod';
import { actionById } from '../core/actions/catalog';
import type { ActionInfo } from '../core/actions/types';
import { isAbortError } from '../core/progress';
import type { Derivation } from '../core/types';
import { engine } from '../engine/engineClient';
import { getHandle } from '../engine/valueHandle';
import { useCaptureStore, type Selection } from './captureStore';
import { endRun, startRun } from './runs';
import { useUiStore } from './uiStore';

export interface SelectionActions {
  actions: ActionInfo[];
  /** The interpreter's "Open as…" derivations, shown as the sidebar's Open group. */
  derivations: Derivation[];
}

/** Actions and derivations that apply to the selected interpretation. */
export async function selectionActions(selection: Selection): Promise<SelectionActions> {
  const [ids, handle] = await Promise.all([
    engine.actions(selection.entryId, selection.kind),
    getHandle(selection.entryId, selection.kind),
  ]);
  const actions = z
    .array(z.string())
    .parse(ids)
    .flatMap(id => actionById(id) ?? []);
  return { actions, derivations: handle.summary.derivations ?? [] };
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Runs an action with a progress bar (`state/runs.ts`), reporting failures as a notice; a
 * cancelled run is not a failure, so it's quiet. Resolves true on success.
 */
export async function runAction(
  selection: Selection,
  info: ActionInfo,
  params?: Record<string, unknown>,
): Promise<boolean> {
  const run = startRun(info.title, info.id, selection);
  try {
    await useCaptureStore.getState().runAction(selection, info.id, params, run);
    return true;
  } catch (err) {
    if (!isAbortError(err)) {
      useUiStore.getState().notify(`${info.title} failed: ${message(err)}`, 'error');
    }
    return false;
  } finally {
    endRun(run.id);
  }
}

/** A derivation's run key in `state/runs.ts` (actions use their id). */
export const derivationKey = (id: string) => `open.${id}`;

/** Runs a derivation ("Open as…"), reporting failures as a notice. */
export async function runDerivation(
  selection: Selection,
  derivation: Derivation,
): Promise<boolean> {
  const run = startRun(derivation.label, derivationKey(derivation.id), selection);
  try {
    await useCaptureStore.getState().derive(selection, derivation, run);
    return true;
  } catch (err) {
    if (!isAbortError(err)) {
      useUiStore.getState().notify(`${derivation.label} failed: ${message(err)}`, 'error');
    }
    return false;
  } finally {
    endRun(run.id);
  }
}
