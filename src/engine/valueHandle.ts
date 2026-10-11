import { z } from 'zod';
import type { EntryId, ImageData, JsonChild, Kind, SliceRequest, ValueHandle } from '../core/types';
import { engine } from './engineClient';

/*
 * Values live in the worker; every read is an RPC. Results cross a thread boundary as `unknown`,
 * so each one is validated here before the UI sees it.
 */

const bytesSchema = z.custom<Uint8Array<ArrayBuffer>>(
  v => v instanceof Uint8Array && v.buffer instanceof ArrayBuffer,
  'Expected ArrayBuffer-backed bytes',
);

const jsonChildSchema: z.ZodType<JsonChild> = z.object({
  key: z.union([z.string(), z.number()]),
  type: z.enum(['object', 'array', 'string', 'number', 'boolean', 'null']),
  preview: z.string(),
  childCount: z.number().optional(),
});

const schemas = {
  lines: z.array(z.string()),
  rows: z.array(z.record(z.string(), z.unknown())),
  children: z.array(jsonChildSchema),
  bytes: bytesSchema,
  text: z.string(),
  image: z.object({ bytes: bytesSchema, mime: z.string() }) satisfies z.ZodType<ImageData>,
};

function remoteHandle(entryId: EntryId, kind: Kind, summary: ValueHandle['summary']): ValueHandle {
  // Not .bind(): on a Comlink proxy that would itself become a remote call
  const slice = (req: SliceRequest) => engine.slice(entryId, kind, req);
  return {
    summary,
    lines: async (from, to) => schemas.lines.parse(await slice({ type: 'lines', from, to })),
    rows: async (from, to) => schemas.rows.parse(await slice({ type: 'rows', from, to })),
    children: async (path, from, to) =>
      schemas.children.parse(await slice({ type: 'children', path, from, to })),
    bytes: async (from, to) => schemas.bytes.parse(await slice({ type: 'bytes', from, to })),
    text: async () => schemas.text.parse(await slice({ type: 'text' })),
    image: async () => schemas.image.parse(await slice({ type: 'image' })),
    json: () => slice({ type: 'json' }),
  };
}

const handles = new Map<string, Promise<ValueHandle>>();

export function getHandle(entryId: EntryId, kind: Kind): Promise<ValueHandle> {
  const key = `${entryId}:${kind}`;
  let handle = handles.get(key);
  if (!handle) {
    handle = engine.summary(entryId, kind).then(summary => remoteHandle(entryId, kind, summary));
    handle.catch(() => handles.delete(key));
    handles.set(key, handle);
  }
  return handle;
}

export function dropHandles(entryId: EntryId): void {
  for (const key of handles.keys()) if (key.startsWith(`${entryId}:`)) handles.delete(key);
}
