import type { EntryContent } from './content';
import type { Kind, SliceRequest, Summary } from './types';

/** What "Copy" puts on the clipboard for a value. */
export interface ExportPayload {
  text?: string;
  html?: string;
  image?: { bytes: Uint8Array; mime: string };
}

/** One per kind. Adding a kind = one interpreter file + one preview component. */
export interface Interpreter<V = unknown> {
  kind: Kind;
  /** Confidence 0..1 that this content is this kind; 0 = not applicable. Must be cheap or memoised. */
  detect(c: EntryContent): number;
  parse(c: EntryContent): V;
  /** Chip text, e.g. "JSON array · 42". */
  label(v: V): string;
  summarise(v: V): Omit<Summary, 'kind' | 'label'>;
  slice(v: V, req: SliceRequest): unknown;
  export(v: V): ExportPayload;
}

export function unsupportedSlice(kind: Kind, req: SliceRequest): never {
  throw new Error(`${kind} does not support '${req.type}' slices`);
}
