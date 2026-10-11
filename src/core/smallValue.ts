import { createMemo } from './content';
import { nearestUnit } from './time';

/** Shared by the small-value decoders (timestamp, uuid, colour) and their ValueCard preview. */

export const SHORT_MAX = 200;

/** Trimmed text if the entry is a single line of at most 200 characters, else null. */
export const shortText = createMemo(c => {
  if (c.text === null || c.size > SHORT_MAX * 4 + 64) return null;
  const t = c.text.trim();
  if (t.length === 0 || t.length > SHORT_MAX || /[\r\n]/.test(t)) return null;
  return t;
});

export interface CardRow {
  label: string;
  value: string;
}

/** What a ValueCard preview shows; returned by the `json` slice of small-value kinds. */
export interface CardData {
  rows: CardRow[];
  /** CSS colour for a large swatch (colour kind). */
  swatch?: string;
  table?: { title: string; columns: string[]; rows: string[][] };
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** `2023-11-14 22:13:20 UTC` (milliseconds only when non-zero). */
export function formatUtc(ms: number): string {
  const d = new Date(ms);
  const frac = d.getUTCMilliseconds() ? `.${pad(d.getUTCMilliseconds(), 3)}` : '';
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}${frac} UTC`
  );
}

const UNITS: readonly [RelativeUnit, ...RelativeUnit[]] = [
  { unit: 'year', size: 365.25 * 86_400_000 },
  { unit: 'month', size: 30.44 * 86_400_000 },
  { unit: 'day', size: 86_400_000 },
  { unit: 'hour', size: 3_600_000 },
  { unit: 'minute', size: 60_000 },
  { unit: 'second', size: 1000 },
];
interface RelativeUnit {
  unit: Intl.RelativeTimeFormatUnit;
  size: number;
}

/** "in 3 days", "2 years ago", "now". */
export function relativeTime(ms: number, now = Date.now()): string {
  const diff = ms - now;
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const { unit, n } = nearestUnit(diff, UNITS);
  return rtf.format(diff < 0 ? -n : n, unit.unit);
}
