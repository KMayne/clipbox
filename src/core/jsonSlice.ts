import type { JsonChild, JsonPath } from './types';
import { oneLine } from './format';

export function jsonTypeOf(v: unknown): JsonChild['type'] {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v as JsonChild['type'];
}

export function jsonAt(root: unknown, path: JsonPath): unknown {
  let v = root;
  for (const p of path) v = (v as Record<string | number, unknown>)?.[p];
  return v;
}

export function jsonPreview(v: unknown, max = 80): string {
  if (Array.isArray(v)) return `[${v.length}]`;
  if (v !== null && typeof v === 'object') {
    const keys = Object.keys(v);
    return oneLine(`{ ${keys.join(', ')} }`, max);
  }
  return oneLine(JSON.stringify(v) ?? 'undefined', max);
}

export function jsonChildCount(v: unknown): number {
  if (Array.isArray(v)) return v.length;
  if (v !== null && typeof v === 'object') return Object.keys(v).length;
  return 0;
}

export function jsonChildren(root: unknown, path: JsonPath, from: number, to: number): JsonChild[] {
  const node = jsonAt(root, path);
  const entries: [string | number, unknown][] = Array.isArray(node)
    ? node.slice(from, to).map((v, i) => [from + i, v])
    : node !== null && typeof node === 'object'
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
