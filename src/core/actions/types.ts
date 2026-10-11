import type { z } from 'zod';
import type { ModuleId } from '../../modules/types';
import type { EntryContent } from '../content';
import type { DerivedContent, Kind } from '../types';

/** Hints that settings fields can carry in `.meta()`, read by the generated forms. */
declare module 'zod' {
  interface GlobalMeta {
    /** String fields: a textarea ('multiline') or a monospace pattern input ('regex'). */
    hint?: 'multiline' | 'regex';
    /** Enum fields: display text for each option, e.g. `{ upper: 'UPPERCASE' }`. */
    optionLabels?: Record<string, string>;
    /**
     * Sensitive input (a key or password): kept out of the capture's parent label, and the form
     * turns off autocomplete and spellcheck for it. Never log it or echo it in results.
     */
    secret?: boolean;
  }
}

export const ACTION_GROUPS = [
  'Format',
  'Convert',
  'Extract',
  'Encode',
  'Lines',
  'Inspect',
] as const;
export type ActionGroup = (typeof ACTION_GROUPS)[number];

/**
 * One setting. Forms only know these four types, and every field needs a default so Run works
 * without editing. Put `.meta({ title, … })` last so it stays on the outer schema.
 */
export type ParamField = z.ZodDefault<z.ZodString | z.ZodNumber | z.ZodBoolean | z.ZodEnum>;
export type ParamsSchema = z.ZodObject<Record<string, ParamField>>;

/** Catalog metadata for an action. No heavy imports: the UI and the worker both load it. */
export interface ActionInfo<P extends ParamsSchema = ParamsSchema> {
  /** '<area>.<name>', e.g. 'json.format'. */
  id: string;
  title: string;
  group: ActionGroup;
  /** Interpretations it applies to; '*' for every kind (e.g. hashing the raw bytes). */
  kinds: Kind[] | '*';
  /** Settings; `z.object({})` when there are none. */
  params: P;
  /** A lazy module whose service the implementation uses (via `ctx.service`). */
  module?: ModuleId;
  /**
   * Short text for the derived capture's "from … ›" label. Defaults to the title plus a summary
   * of the settings (see `actionLabel`). Method syntax keeps typed entries assignable to
   * `ActionInfo`.
   */
  label?(params: z.output<P>): string;
  /**
   * Set for actions that don't make a capture: the worker returns an `ActionEffect` (see
   * `implementEffect`) and the UI carries it out, e.g. opening a URL in a new tab.
   */
  effect?: ActionEffect['effect'];
}

/**
 * A side effect for the UI to perform instead of adding a capture. The UI validates it again
 * (`state/effects.ts`) before acting on it.
 */
export interface ActionEffect {
  effect: 'open-url';
  /** http(s) only. */
  url: string;
}

/** Identity function that infers `P`, so `label` gets typed settings. */
export const defineAction = <P extends ParamsSchema>(info: ActionInfo<P>): ActionInfo<P> => info;

export const hasSettings = (info: ActionInfo) => Object.keys(info.params.shape).length > 0;

export const appliesToKind = (info: ActionInfo, kind: Kind) =>
  info.kinds === '*' || info.kinds.includes(kind);

export interface ActionInput<V> {
  /** The interpreter's parsed value, narrowed by the implementation's `value` guard. */
  value: V;
  /** The raw entry (bytes, and text if textual), for generic actions like hashing. */
  content: EntryContent;
}

export interface ActionContext {
  signal: AbortSignal;
  /** Loads a module's service, checked with `guard`; null if it's unavailable. */
  service<T>(module: ModuleId, guard: (s: unknown) => s is T): Promise<T | null>;
}

type MaybePromise<T> = T | Promise<T>;

/** Worker-side implementation of one catalog entry. */
export interface ActionImpl<P extends ParamsSchema, V> {
  /** Narrows the interpreter's value; use `anyValue` for actions that only read `content`. */
  value(v: unknown): v is V;
  /** Finer filtering than `kinds`, e.g. JSON → CSV only for arrays of objects. */
  applies?(input: ActionInput<V>): boolean;
  /**
   * One result becomes a capture with one entry; an array becomes one capture holding them all
   * (a collection, e.g. every image in a deck). An empty array is an error ("nothing found").
   */
  run(
    input: ActionInput<V>,
    params: z.output<P>,
    ctx: ActionContext,
  ): MaybePromise<DerivedContent | DerivedContent[]>;
}

/** Implementation with its value and settings types erased; every call checks both. */
export interface AnyActionImpl {
  info: ActionInfo;
  applies(value: unknown, content: EntryContent): boolean;
  /** Validates `params` with the catalog's schema (a trust boundary), then runs. */
  run(
    value: unknown,
    content: EntryContent,
    params: unknown,
    ctx: ActionContext,
  ): Promise<DerivedContent[]>;
  /** Present only for effect actions (`info.effect`); `run` then rejects. */
  effect?(
    value: unknown,
    content: EntryContent,
    params: unknown,
    ctx: ActionContext,
  ): Promise<ActionEffect>;
}

export const anyValue = (_v: unknown): _v is unknown => true;

/** Checks the value and settings (a trust boundary) and the action's own `applies`. */
function prepare<P extends ParamsSchema, V>(
  info: ActionInfo<P>,
  impl: { value(v: unknown): v is V; applies?(input: ActionInput<V>): boolean },
  value: unknown,
  content: EntryContent,
  params: unknown,
): { input: ActionInput<V>; params: z.output<P> } {
  if (!impl.value(value)) throw new Error(`${info.title} can't run on this value`);
  const parsed = info.params.safeParse(params ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join('.')}: ` : '';
    throw new Error(`Invalid settings for ${info.title}: ${where}${issue?.message ?? ''}`);
  }
  const input = { value, content };
  if (impl.applies && !impl.applies(input)) {
    throw new Error(`${info.title} doesn't apply to this value`);
  }
  return { input, params: parsed.data };
}

export function implement<P extends ParamsSchema, V>(
  info: ActionInfo<P>,
  impl: ActionImpl<P, V>,
): AnyActionImpl {
  return {
    info,
    applies: (value, content) => impl.value(value) && (impl.applies?.({ value, content }) ?? true),
    async run(value, content, params, ctx) {
      const prepared = prepare(info, impl, value, content, params);
      const result = await impl.run(prepared.input, prepared.params, ctx);
      const results = Array.isArray(result) ? result : [result];
      if (!results.length) throw new Error(`${info.title} found nothing`);
      return results;
    },
  };
}

/** Worker side of an effect action (`info.effect` set): returns what the UI should do. */
export interface EffectImpl<P extends ParamsSchema, V> {
  value(v: unknown): v is V;
  applies?(input: ActionInput<V>): boolean;
  run(input: ActionInput<V>, params: z.output<P>, ctx: ActionContext): MaybePromise<ActionEffect>;
}

export function implementEffect<P extends ParamsSchema, V>(
  info: ActionInfo<P>,
  impl: EffectImpl<P, V>,
): AnyActionImpl {
  if (!info.effect) throw new Error(`${info.id} isn't an effect action`);
  return {
    info,
    applies: (value, content) => impl.value(value) && (impl.applies?.({ value, content }) ?? true),
    run: () => Promise.reject(new Error(`${info.title} doesn't make a capture`)),
    async effect(value, content, params, ctx) {
      const prepared = prepare(info, impl, value, content, params);
      const effect = await impl.run(prepared.input, prepared.params, ctx);
      if (effect.effect !== info.effect) throw new Error(`${info.title} returned the wrong effect`);
      return effect;
    },
  };
}
