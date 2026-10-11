import type { Schema } from './types';

const SAMPLE_LIMIT = 2000;

export function inferSchema(value: unknown, depth = 0): Schema {
  if (value === null) return { t: 'null' };
  if (depth > 32) return { t: 'unknown' };
  switch (typeof value) {
    case 'string':
      return { t: 'string' };
    case 'number':
      return { t: 'number' };
    case 'boolean':
      return { t: 'boolean' };
  }
  if (Array.isArray(value)) {
    const step = Math.max(1, Math.floor(value.length / SAMPLE_LIMIT));
    let of: Schema | null = null;
    for (let i = 0; i < value.length; i += step) {
      const s = inferSchema(value[i], depth + 1);
      of = of ? mergeSchemas(of, s) : s;
    }
    return { t: 'array', of: of ?? { t: 'unknown' }, length: value.length };
  }
  if (typeof value === 'object') {
    const fields: Record<string, { schema: Schema; presence: number }> = {};
    for (const [k, v] of Object.entries(value)) {
      fields[k] = { schema: inferSchema(v, depth + 1), presence: 1 };
    }
    return { t: 'object', fields };
  }
  return { t: 'unknown' };
}

/** Running merge; object field presence is tracked as a count via __n and normalised at the end. */
export function mergeSchemas(a: Schema, b: Schema): Schema {
  if (a.t === 'object' && b.t === 'object') return mergeObjects(a, b);
  if (a.t === 'array' && b.t === 'array') return { t: 'array', of: mergeSchemas(a.of, b.of) };
  if (a.t === b.t && a.t !== 'union') return a;
  const members = [...(a.t === 'union' ? a.of : [a]), ...(b.t === 'union' ? b.of : [b])];
  const out: Schema[] = [];
  for (const m of members) {
    const i = out.findIndex(o => o.t === m.t);
    if (i === -1) out.push(m);
    else out[i] = mergeSchemas(out[i]!, m);
  }
  return out.length === 1 ? out[0]! : { t: 'union', of: out };
}

type ObjectSchema = Extract<Schema, { t: 'object' }> & { n?: number };

function mergeObjects(a: ObjectSchema, b: ObjectSchema): ObjectSchema {
  const na = a.n ?? 1;
  const nb = b.n ?? 1;
  const n = na + nb;
  const fields: ObjectSchema['fields'] = {};
  for (const key of new Set([...Object.keys(a.fields), ...Object.keys(b.fields)])) {
    const fa = a.fields[key];
    const fb = b.fields[key];
    const count = (fa ? fa.presence * na : 0) + (fb ? fb.presence * nb : 0);
    const schema = fa && fb ? mergeSchemas(fa.schema, fb.schema) : (fa ?? fb)!.schema;
    fields[key] = { schema, presence: count / n };
  }
  return { t: 'object', fields, n };
}

export function describeSchema(s: Schema): string {
  switch (s.t) {
    case 'array':
      return `${describeSchema(s.of)}[]`;
    case 'object':
      return 'object';
    case 'union':
      return s.of.map(describeSchema).join(' | ');
    default:
      return s.t;
  }
}

const IDENT = /^[A-Za-z_$][\w$]*$/;

export function schemaToTs(s: Schema, indent = ''): string {
  switch (s.t) {
    case 'array': {
      const inner = schemaToTs(s.of, indent);
      return s.of.t === 'union' ? `(${inner})[]` : `${inner}[]`;
    }
    case 'object': {
      const entries = Object.entries(s.fields);
      if (entries.length === 0) return 'Record<string, unknown>';
      const next = indent + '  ';
      const lines = entries.map(([k, f]) => {
        const key = IDENT.test(k) ? k : JSON.stringify(k);
        const opt = f.presence < 1 ? '?' : '';
        return `${next}${key}${opt}: ${schemaToTs(f.schema, next)};`;
      });
      return `{\n${lines.join('\n')}\n${indent}}`;
    }
    case 'union':
      return s.of.map(m => schemaToTs(m, indent)).join(' | ');
    default:
      return s.t;
  }
}
