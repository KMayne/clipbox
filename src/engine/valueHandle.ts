import type { EntryId, Kind, SliceRequest, SliceResult, ValueHandle } from '../core/types';
import { engine } from './engineClient';

/** Values live in the worker; every slice is an RPC. */
const handles = new Map<string, Promise<ValueHandle>>();

export function getHandle(entryId: EntryId, kind: Kind): Promise<ValueHandle> {
  const key = `${entryId}:${kind}`;
  let handle = handles.get(key);
  if (!handle) {
    handle = engine.summary(entryId, kind).then(summary => ({
      summary,
      getSlice: <R extends SliceRequest>(req: R) =>
        engine.slice(entryId, kind, req) as Promise<SliceResult<R>>,
    }));
    handle.catch(() => handles.delete(key));
    handles.set(key, handle);
  }
  return handle;
}

export function dropHandles(entryId: EntryId): void {
  for (const key of handles.keys()) if (key.startsWith(`${entryId}:`)) handles.delete(key);
}
