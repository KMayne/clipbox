/** Python wheels: *.dist-info/METADATA and WHEEL (email-style headers). */

import type { EntryReader } from './reader';
import type { WheelInfo } from './types';

/** Headers up to the first blank line; repeated names collect every value. */
export function parseEmailHeaders(text: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let last: string[] | null = null;
  for (const line of text.split(/\r\n|\r|\n/)) {
    if (line === '') break;
    if (/^[ \t]/.test(line)) {
      if (last && last.length > 0) last.push(`${last.pop() ?? ''}\n${line.trim()}`);
      continue;
    }
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    last = out.get(key) ?? [];
    last.push(line.slice(colon + 1).trim());
    out.set(key, last);
  }
  return out;
}

const first = (h: Map<string, string[]>, key: string) => h.get(key)?.[0] ?? null;

export function recogniseWheel(r: EntryReader): WheelInfo | null {
  const wheelPath = r.files.find(p => /^[^/]+\.dist-info\/WHEEL$/.test(p));
  if (!wheelPath) return null;
  const dir = wheelPath.slice(0, -'WHEEL'.length);
  const wheel = parseEmailHeaders(r.text(wheelPath) ?? '');
  const meta = parseEmailHeaders(r.text(`${dir}METADATA`) ?? '');
  // "requests-2.31.0.dist-info/" when METADATA is missing
  const [dirName = '', dirVersion = ''] = dir.replace(/\.dist-info\/$/, '').split('-');
  const pure = first(wheel, 'root-is-purelib');
  return {
    type: 'wheel',
    name: first(meta, 'name') ?? dirName,
    version: first(meta, 'version') ?? dirVersion,
    summary: first(meta, 'summary'),
    requiresPython: first(meta, 'requires-python'),
    requires: meta.get('requires-dist') ?? [],
    tags: wheel.get('tag') ?? [],
    generator: first(wheel, 'generator'),
    pureLib: pure === null ? null : pure.toLowerCase() === 'true',
  };
}
