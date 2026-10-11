import type { EntryContent } from './content';
import type { Kind, SliceRequest, Summary } from './types';
import type { ModuleId } from '../modules/types';

/** What "Copy" puts on the clipboard for a value. */
export interface ExportPayload {
  text?: string;
  html?: string;
  image?: { bytes: Uint8Array; mime: string };
}

export interface InterpretContext {
  /** Loads a module's service; null if the module is off or unavailable. */
  service<T>(module: ModuleId): Promise<T | null>;
}

type MaybePromise<T> = T | Promise<T>;

/** One per kind. Adding a kind = one interpreter file + one preview component. */
export interface Interpreter<V = unknown> {
  kind: Kind;
  /** Optional services this interpreter uses; parsing waits for them to load unless they're off. */
  requires?: ModuleId[];
  /** Confidence 0..1 that this content is this kind; 0 = not applicable. Must be cheap or memoised. */
  detect(c: EntryContent): number;
  parse(c: EntryContent, ctx: InterpretContext): MaybePromise<V>;
  /** Chip text, e.g. "JSON array · 42". */
  label(v: V): string;
  summarise(v: V): MaybePromise<Omit<Summary, 'kind' | 'label' | 'bytes'>>;
  slice(v: V, req: SliceRequest): MaybePromise<unknown>;
  export(v: V): MaybePromise<ExportPayload>;
}

export function unsupportedSlice(kind: Kind, req: SliceRequest): never {
  throw new Error(`${kind} does not support '${req.type}' slices`);
}
