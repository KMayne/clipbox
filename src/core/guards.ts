/** Runtime checks used instead of type assertions. */

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Returns `v`, throwing if it is undefined or null. For invariants the type system can't see. */
export function defined<T>(v: T | null | undefined, what = 'value'): T {
  if (v === undefined || v === null) throw new Error(`Expected ${what} to be defined`);
  return v;
}

/** Interpreter values carry their kind so a type guard can check them at runtime. */
export const hasKind = <K extends string>(v: unknown, kind: K): v is { kind: K } =>
  isRecord(v) && v.kind === kind;
