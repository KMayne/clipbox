import { formatBytes, formatCount, formatPercent } from './format';
import { jsonTypeOf } from './jsonSlice';
import { describeSchema, inferSchema } from './schema';
import type { Schema, StatRow } from './types';

/** Stats for a JSON-like tree (JSON, YAML, XML): type, size, length, keys, depth. */
export function jsonStats(json: unknown, bytes: number): { stats: StatRow[]; schema: Schema } {
  const schema = inferSchema(json);
  const stats: StatRow[] = [
    { label: 'Top-level type', value: jsonTypeOf(json) },
    { label: 'Size', value: formatBytes(bytes) },
  ];
  if (Array.isArray(json)) stats.push(...arrayStats(json, schema));
  else stats.push(...keyStats(schema, 'Keys'));
  stats.push({ label: 'Max depth', value: String(maxDepth(json)) });
  return { stats, schema };
}

/** Length, element types and element keys of an array (also used by the ndjson kind). */
export function arrayStats(arr: unknown[], schema: Schema): StatRow[] {
  return [
    { label: 'Length', value: formatCount(arr.length) },
    { label: 'Element types', value: elementTypes(arr) },
    ...keyStats(schema.t === 'array' ? schema.of : schema, 'Element keys'),
  ];
}

/** Key count with per-key type and presence, if `schema` describes objects. */
function keyStats(schema: Schema, label: string): StatRow[] {
  const fields = schema.t === 'object' ? Object.entries(schema.fields) : [];
  if (fields.length === 0) return [];
  return [
    {
      label,
      value: formatCount(fields.length),
      children: fields.map(([k, f]) => ({
        label: k,
        value: `${describeSchema(f.schema)} · ${formatPercent(f.presence)}`,
      })),
    },
  ];
}

function elementTypes(arr: unknown[]): string {
  const counts = new Map<string, number>();
  for (const v of arr) {
    const t = jsonTypeOf(v);
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `${t} ${formatCount(n)}`)
    .join(', ');
}

export function maxDepth(root: unknown): number {
  let max = 0;
  const stack: [unknown, number][] = [[root, 0]];
  let visited = 0;
  for (let item = stack.pop(); item && visited++ < 1_000_000; item = stack.pop()) {
    const [v, d] = item;
    if (v === null || typeof v !== 'object') continue;
    max = Math.max(max, d + 1);
    for (const child of Object.values(v)) stack.push([child, d + 1]);
  }
  return max;
}
