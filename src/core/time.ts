const UNITS: [ms: number, short: string, long: string][] = [
  [365 * 86_400_000, 'y', 'year'],
  [86_400_000, 'd', 'day'],
  [3_600_000, 'h', 'hour'],
  [60_000, 'm', 'minute'],
  [1000, 's', 'second'],
];

/** A duration in its largest whole unit: "2h" (short) or "2 hours" (long). */
export function formatDuration(ms: number, style: 'short' | 'long' = 'long'): string {
  const abs = Math.abs(ms);
  for (const [size, short, long] of UNITS) {
    if (abs >= size || size === 1000) {
      const n = Math.floor(abs / size);
      return style === 'short' ? `${n}${short}` : `${n} ${long}${n === 1 ? '' : 's'}`;
    }
  }
  return '';
}

/** "in 2 hours" / "3 days ago", relative to `now`. */
export function formatRelative(at: number, now: number, style: 'short' | 'long' = 'long'): string {
  const d = formatDuration(at - now, style);
  return at >= now ? `in ${d}` : `${d} ago`;
}

/** ISO 8601 UTC without milliseconds, e.g. 2026-10-11T12:00:00Z. */
export const isoUtc = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
