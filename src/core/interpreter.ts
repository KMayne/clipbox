import type { EntryContent } from './content';
import type { Kind, SliceRequest, Summary } from './types';

/** What "Copy" puts on the clipboard for a value. */
export interface ExportPayload {
  text?: string;
  html?: string;
  image?: { bytes: Uint8Array<ArrayBuffer>; mime: string };
}

export interface InterpretContext {
  /**
   * Loads a module's service, checked with `guard`; null if the module is off, unavailable,
   * or doesn't provide what the guard expects.
   */
  service<T>(module: string, guard: (s: unknown) => s is T): Promise<T | null>;
}

type MaybePromise<T> = T | Promise<T>;
type SummaryParts = Omit<Summary, 'kind' | 'label' | 'bytes'>;

/** One per kind. Adding a kind = one interpreter file + one preview component. */
export interface Interpreter<V> {
  kind: Kind;
  /** Optional services this interpreter uses; parsing waits for them to load unless they're off. */
  requires?: string[];
  /** Runtime check that `v` is a value this interpreter produced (values carry a `kind` tag). */
  isValue(v: unknown): v is V;
  /** Confidence 0..1 that this content is this kind; 0 = not applicable. Must be cheap or memoised. */
  detect(c: EntryContent): number;
  parse(c: EntryContent, ctx: InterpretContext): MaybePromise<V>;
  /** Chip text, e.g. "JSON array · 42". */
  label(v: V): string;
  summarise(v: V): MaybePromise<SummaryParts>;
  slice(v: V, req: SliceRequest): MaybePromise<unknown>;
  export(v: V): MaybePromise<ExportPayload>;
}

/**
 * Interpreter with its value type erased, so interpreters of different kinds can share a registry.
 * Every call checks the value with the interpreter's `isValue` guard.
 */
export interface AnyInterpreter {
  kind: Kind;
  requires: string[];
  detect(c: EntryContent): number;
  parse(c: EntryContent, ctx: InterpretContext): Promise<unknown>;
  label(v: unknown): string;
  summarise(v: unknown): Promise<SummaryParts>;
  slice(v: unknown, req: SliceRequest): Promise<unknown>;
  export(v: unknown): Promise<ExportPayload>;
}

export function register<V>(i: Interpreter<V>): AnyInterpreter {
  const check = (v: unknown): V => {
    if (!i.isValue(v)) throw new Error(`Not a ${i.kind} value`);
    return v;
  };
  return {
    kind: i.kind,
    requires: i.requires ?? [],
    detect: c => i.detect(c),
    parse: async (c, ctx) => i.parse(c, ctx),
    label: v => i.label(check(v)),
    summarise: async v => i.summarise(check(v)),
    slice: async (v, req) => i.slice(check(v), req),
    export: async v => i.export(check(v)),
  };
}

export function unsupportedSlice(kind: Kind, req: SliceRequest): never {
  throw new Error(`${kind} does not support '${req.type}' slices`);
}
