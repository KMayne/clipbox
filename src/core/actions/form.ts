import { z } from 'zod';
import type { ActionInfo, ParamsSchema } from './types';

/** One generated form field, read from the settings schema's JSON Schema. */
export type FormField =
  | {
      type: 'string';
      key: string;
      title: string;
      description?: string;
      default: string;
      hint?: 'multiline' | 'regex';
      pattern?: string;
      /** Sensitive (see `GlobalMeta.secret`): never shown in labels. */
      secret?: boolean;
    }
  | {
      type: 'number';
      key: string;
      title: string;
      description?: string;
      default: number;
      integer: boolean;
      min?: number;
      max?: number;
    }
  | { type: 'boolean'; key: string; title: string; description?: string; default: boolean }
  | {
      type: 'enum';
      key: string;
      title: string;
      description?: string;
      default: string;
      options: { value: string; label: string }[];
    };

const common = { title: z.string().optional(), description: z.string().optional() };

// JSON Schema is untyped JSON, so it's validated like any other boundary
const propertySchema = z.union([
  z.object({
    ...common,
    type: z.literal('string'),
    enum: z.array(z.string()).min(1),
    default: z.string(),
    optionLabels: z.record(z.string(), z.string()).optional(),
  }),
  z.object({
    ...common,
    type: z.literal('string'),
    enum: z.undefined().optional(),
    default: z.string(),
    hint: z.enum(['multiline', 'regex']).optional(),
    pattern: z.string().optional(),
    secret: z.boolean().optional(),
  }),
  z.object({
    ...common,
    type: z.enum(['number', 'integer']),
    default: z.number(),
    minimum: z.number().optional(),
    maximum: z.number().optional(),
  }),
  z.object({ ...common, type: z.literal('boolean'), default: z.boolean() }),
]);

const objectSchema = z.object({ properties: z.record(z.string(), z.unknown()) });

/** "rootName" → "Root name". */
const titleFromKey = (key: string) => {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** Largest integer Zod emits for `.int()` without a bound; not worth showing. */
const SAFE = Number.MAX_SAFE_INTEGER;

/**
 * Form fields for an action's settings, generated from `z.toJSONSchema`. Throws for any field
 * the forms can't show (a unit test runs this over the whole catalog).
 */
export function formFields(params: ParamsSchema): FormField[] {
  const { properties } = objectSchema.parse(z.toJSONSchema(params));
  return Object.entries(properties).map(([key, raw]): FormField => {
    const parsed = propertySchema.safeParse(raw);
    if (!parsed.success) throw new Error(`Unsupported setting '${key}'`);
    const p = parsed.data;
    const base = {
      key,
      title: p.title ?? titleFromKey(key),
      ...(p.description !== undefined && { description: p.description }),
    };
    switch (p.type) {
      case 'boolean':
        return { ...base, type: 'boolean', default: p.default };
      case 'number':
      case 'integer':
        return {
          ...base,
          type: 'number',
          default: p.default,
          integer: p.type === 'integer',
          ...(p.minimum !== undefined && Math.abs(p.minimum) < SAFE && { min: p.minimum }),
          ...(p.maximum !== undefined && Math.abs(p.maximum) < SAFE && { max: p.maximum }),
        };
      case 'string':
        if ('enum' in p && p.enum) {
          const labels = 'optionLabels' in p ? p.optionLabels : undefined;
          return {
            ...base,
            type: 'enum',
            default: p.default,
            options: p.enum.map(value => ({ value, label: labels?.[value] ?? value })),
          };
        }
        return {
          ...base,
          type: 'string',
          default: p.default,
          ...('hint' in p && p.hint && { hint: p.hint }),
          ...('pattern' in p && p.pattern !== undefined && { pattern: p.pattern }),
          ...('secret' in p && p.secret === true && { secret: true }),
        };
    }
  });
}

/** Default values for every setting. */
export const defaultParams = (info: ActionInfo): Record<string, unknown> => info.params.parse({});

const MAX_LABEL = 48;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Short text for a derived capture's parent label: the action's own `label`, or its title plus
 * the settings, e.g. "Sort lines (Z → A, unique)". Invalid settings fall back to the title.
 * Secret settings (`.meta({ secret: true })`) are always left out.
 */
export function actionLabel(info: ActionInfo, params: unknown): string {
  const parsed = info.params.safeParse(params ?? {});
  if (!parsed.success) return info.title;
  const values: Record<string, unknown> = parsed.data;
  const fields = formFields(info.params);
  if (info.label) {
    const label = info.label(parsed.data);
    // A custom label that echoes a secret falls back to the bare title
    const leaks = fields.some(f => {
      const v = values[f.key];
      return (
        f.type === 'string' &&
        f.secret &&
        typeof v === 'string' &&
        v.trim() !== '' &&
        label.includes(v.trim().slice(0, 16))
      );
    });
    return leaks ? info.title : clip(label, MAX_LABEL);
  }
  const parts: string[] = [];
  for (const field of fields) {
    const v = values[field.key];
    if (field.type === 'boolean') {
      if (v === true) parts.push(field.title.toLowerCase());
    } else if (field.type === 'enum') {
      parts.push(field.options.find(o => o.value === v)?.label ?? String(v));
    } else if (field.type === 'number') {
      parts.push(`${field.title.toLowerCase()} ${String(v)}`);
    } else if (field.secret) {
      continue;
    } else if (typeof v === 'string' && v !== '') {
      parts.push(JSON.stringify(clip(v, 16)));
    }
  }
  return clip(parts.length ? `${info.title} (${parts.join(', ')})` : info.title, MAX_LABEL);
}
