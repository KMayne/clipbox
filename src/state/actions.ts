import { z } from 'zod';
import { actionById } from '../core/actions/catalog';
import type { ActionInfo } from '../core/actions/types';
import type { Derivation } from '../core/types';
import { engine } from '../engine/engineClient';
import { getHandle } from '../engine/valueHandle';
import { useCaptureStore, type Selection } from './captureStore';
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

/** Runs an action, reporting failures as a notice. Resolves true on success. */
export async function runAction(
  selection: Selection,
  info: ActionInfo,
  params?: Record<string, unknown>,
): Promise<boolean> {
  try {
    await useCaptureStore.getState().runAction(selection, info.id, params);
    return true;
  } catch (err) {
    useUiStore.getState().notify(`${info.title} failed: ${message(err)}`, 'error');
    return false;
  }
}

/** Runs a derivation ("Open as…"), reporting failures as a notice. */
export async function runDerivation(
  selection: Selection,
  derivation: Derivation,
): Promise<boolean> {
  try {
    await useCaptureStore.getState().derive(selection, derivation);
    return true;
  } catch (err) {
    useUiStore.getState().notify(`${derivation.label} failed: ${message(err)}`, 'error');
    return false;
  }
}
