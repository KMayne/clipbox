import { getInterpreter } from '../core/interpreters';
import type { EntryId, Kind, SliceRequest, SliceResult, ValueHandle } from '../core/types';
import { engine } from './engineClient';

/** Value was copied back from the worker; slices are served locally. */
function localHandle(kind: Kind, summary: ValueHandle['summary'], value: unknown): ValueHandle {
  const interpreter = getInterpreter(kind);
  return {
    summary,
    getSlice: async <R extends SliceRequest>(req: R) =>
      interpreter.slice(value, req) as SliceResult<R>,
  };
}

const handles = new Map<string, Promise<ValueHandle>>();

export function getHandle(entryId: EntryId, kind: Kind): Promise<ValueHandle> {
  const key = `${entryId}:${kind}`;
  let handle = handles.get(key);
  if (!handle) {
    handle = engine.materialise(entryId, kind).then(m => localHandle(kind, m.summary, m.value));
    handle.catch(() => handles.delete(key));
    handles.set(key, handle);
  }
  return handle;
}

export function dropHandles(entryId: EntryId): void {
  for (const key of handles.keys()) if (key.startsWith(`${entryId}:`)) handles.delete(key);
}
