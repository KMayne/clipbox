import { modules } from './registry';
import type { ModuleId } from './types';
import type { CacheState } from '../swClient';

/** Pure decisions for background module downloads (see state/backgroundDownloads.ts). */

export const MIN_DOWNLINK_MBPS = 5;

export interface ConnectionInfo {
  effectiveType?: string;
  downlink?: number;
  saveData?: boolean;
  type?: string;
}

export type Verdict = { ok: true } | { ok: false; reason: string };

export function judgeConnection(c: ConnectionInfo | null): Verdict {
  if (!c) return { ok: false, reason: 'connection speed unknown' };
  if (c.saveData) return { ok: false, reason: 'Data Saver is on' };
  if (c.type === 'cellular') return { ok: false, reason: 'on a cellular connection' };
  if (c.effectiveType !== undefined && c.effectiveType !== '4g') {
    return { ok: false, reason: `slow connection (${c.effectiveType})` };
  }
  if (c.downlink === undefined || c.downlink < MIN_DOWNLINK_MBPS) {
    return { ok: false, reason: `slow connection (${c.downlink ?? '?'} Mbps)` };
  }
  return { ok: true };
}

/** The smallest module that isn't cached, downloading or excluded; null when none are left. */
export function nextToDownload(
  sizes: Record<string, number>,
  cache: Record<string, CacheState>,
  exclude: ReadonlySet<ModuleId>,
): ModuleId | null {
  const candidates = modules
    .map(m => m.id)
    .filter(
      id =>
        id in sizes &&
        cache[id]?.state !== 'cached' &&
        cache[id]?.state !== 'downloading' &&
        !exclude.has(id),
    )
    .sort((a, b) => (sizes[a] ?? 0) - (sizes[b] ?? 0));
  return candidates[0] ?? null;
}
