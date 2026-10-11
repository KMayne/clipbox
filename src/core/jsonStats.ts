import { formatBytes, formatCount, formatPercent } from './format';
import { jsonTypeOf } from './jsonSlice';
import { describeSchema, inferSchema } from './schema';
import type { Schema, StatRow } from './types';

/** Stats for a JSON-like tree (JSON, YAML, XML): type, size, length, keys, depth. */
export function jsonStats(json: unknown, bytes: number): { stats: StatRow[]; schema: Schema } {
  const schema = inferSchema(json);
  const type = jsonTypeOf(json);
  const stats: StatRow[] = [
    { label: 'Top-level type', value: type },
    { label: 'Size', value: formatBytes(bytes) },
  ];
  if (Array.isArray(json)) {
    stats.push({ label: 'Length', value: formatCount(json.length) });
    stats.push({ label: 'Element types', value: elementTypes(json) });
  }
  const objectSchema = schema.t === 'array' ? schema.of : schema;
  const fields = objectSchema.t === 'object' ? Object.entries(objectSchema.fields) : [];
  if (fields.length > 0) {
    stats.push({
      label: Array.isArray(json) ? 'Element keys' : 'Keys',
      value: formatCount(fields.length),
      children: fields.map(([k, f]) => ({
        label: k,
        value: `${describeSchema(f.schema)} · ${formatPercent(f.presence)}`,
      })),
    });
  }
  stats.push({ label: 'Max depth', value: String(maxDepth(json)) });
  return { stats, schema };
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
