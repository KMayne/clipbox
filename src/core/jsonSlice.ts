import { oneLine } from './format';
import { isRecord } from './guards';
import type { JsonChild, JsonPath } from './types';

export function jsonTypeOf(v: unknown): JsonChild['type'] {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  switch (typeof v) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    default:
      return 'object';
  }
}

export function jsonAt(root: unknown, path: JsonPath): unknown {
  let v = root;
  for (const p of path) {
    if (Array.isArray(v) && typeof p === 'number') v = v[p];
    else if (isRecord(v) && typeof p === 'string') v = v[p];
    else return undefined;
  }
  return v;
}

export function jsonPreview(v: unknown, max = 80): string {
  if (Array.isArray(v)) return `[${v.length}]`;
  if (isRecord(v)) return oneLine(`{ ${Object.keys(v).join(', ')} }`, max);
  return oneLine(JSON.stringify(v) ?? 'undefined', max);
}

export function jsonChildCount(v: unknown): number {
  if (Array.isArray(v)) return v.length;
  if (isRecord(v)) return Object.keys(v).length;
  return 0;
}

export function jsonChildren(root: unknown, path: JsonPath, from: number, to: number): JsonChild[] {
  const node = jsonAt(root, path);
  const entries: [string | number, unknown][] = Array.isArray(node)
    ? node.slice(from, to).map((v, i) => [from + i, v])
    : isRecord(node)
      ? Object.entries(node).slice(from, to)
      : [];
  return entries.map(([key, v]) => {
    const type = jsonTypeOf(v);
    const container = type === 'array' || type === 'object';
    return {
      key,
      type,
      preview: jsonPreview(v),
      ...(container ? { childCount: jsonChildCount(v) } : {}),
    };
  });
}
