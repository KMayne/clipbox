/**
 * `ms` (sign ignored) in the nearest whole number of its largest unit, carrying into the next unit
 * up when rounding reaches it (59m40s is 1 hour, not 60 minutes). `units` run largest first.
 */
export function nearestUnit<U extends { size: number }>(
  ms: number,
  units: readonly [U, ...U[]],
): { unit: U; n: number } {
  const smallest = units[units.length - 1] ?? units[0];
  const pick = (v: number) => units.find(u => v >= u.size) ?? smallest;
  const first = pick(Math.abs(ms));
  const rounded = Math.round(Math.abs(ms) / first.size) * first.size;
  const unit = pick(rounded);
  return { unit, n: Math.round(rounded / unit.size) };
}

const UNITS: readonly [Unit, ...Unit[]] = [
  { size: 365 * 86_400_000, short: 'y', long: 'year' },
  { size: 86_400_000, short: 'd', long: 'day' },
  { size: 3_600_000, short: 'h', long: 'hour' },
  { size: 60_000, short: 'm', long: 'minute' },
  { size: 1000, short: 's', long: 'second' },
];
interface Unit {
  size: number;
  short: string;
  long: string;
}

/** A duration rounded to its nearest whole unit: "2h" (short) or "2 hours" (long). */
export function formatDuration(ms: number, style: 'short' | 'long' = 'long'): string {
  const { unit, n } = nearestUnit(ms, UNITS);
  return style === 'short' ? `${n}${unit.short}` : `${n} ${unit.long}${n === 1 ? '' : 's'}`;
}

/** "in 2 hours" / "3 days ago", relative to `now`. */
export function formatRelative(at: number, now: number, style: 'short' | 'long' = 'long'): string {
  const d = formatDuration(at - now, style);
  return at >= now ? `in ${d}` : `${d} ago`;
}

/** ISO 8601 UTC without milliseconds, e.g. 2026-10-11T12:00:00Z. */
export const isoUtc = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
