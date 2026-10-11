import { hasKind } from '../guards';
import { unsupportedSlice, type Interpreter } from '../interpreter';
import { formatUtc, relativeTime, shortText, type CardData } from '../smallValue';
import type { StatRow } from '../types';

export type TimestampFormat =
  'unix-s' | 'unix-ms' | 'unix-us' | 'unix-ns' | 'iso-date' | 'iso-datetime' | 'rfc2822';

export interface ParsedTimestamp {
  ms: number;
  format: TimestampFormat;
  /** Offset from UTC in minutes if the input gave one; null for epochs and zone-less input. */
  offset: number | null;
}

interface TimestampValue extends ParsedTimestamp {
  kind: 'timestamp';
  input: string;
}

const FORMAT_NAMES: Record<TimestampFormat, string> = {
  'unix-s': 'Unix seconds',
  'unix-ms': 'Unix milliseconds',
  'unix-us': 'Unix microseconds',
  'unix-ns': 'Unix nanoseconds',
  'iso-date': 'ISO 8601 date',
  'iso-datetime': 'ISO 8601 date-time',
  rfc2822: 'RFC 2822',
};

const MIN_MS = Date.UTC(2000, 0, 1);
const MAX_MS = Date.UTC(2100, 0, 1);

/** Divisor turning the integer into milliseconds (a multiplier for seconds). */
const EPOCH_UNITS: [TimestampFormat, (n: bigint) => bigint][] = [
  ['unix-s', n => n * 1000n],
  ['unix-ms', n => n],
  ['unix-us', n => n / 1000n],
  ['unix-ns', n => n / 1_000_000n],
];

function parseEpoch(s: string): ParsedTimestamp | null {
  if (!/^\d{9,19}$/.test(s)) return null;
  const n = BigInt(s);
  for (const [format, toMs] of EPOCH_UNITS) {
    const ms = Number(toMs(n));
    if (ms >= MIN_MS && ms < MAX_MS) return { ms, format, offset: null };
  }
  return null;
}

const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

function validDate(y: number, mo: number, d: number) {
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysIn(y, mo);
}

function parseOffset(z: string): number | null {
  if (/^(z|ut|gmt)$/i.test(z)) return 0;
  const named: Record<string, number> = {
    EST: -5,
    EDT: -4,
    CST: -6,
    CDT: -5,
    MST: -7,
    MDT: -6,
    PST: -8,
    PDT: -7,
  };
  const hours = named[z.toUpperCase()];
  if (hours !== undefined) return hours * 60;
  const m = /^([+-])(\d{2}):?(\d{2})?$/.exec(z);
  if (!m) return null;
  const mins = Number(m[2]) * 60 + Number(m[3] ?? 0);
  if (Number(m[2]) > 23 || Number(m[3] ?? 0) > 59) return null;
  return m[1] === '-' ? -mins : mins;
}

const ISO =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?(Z|[+-]\d{2}(?::?\d{2})?)?)?$/i;

function parseIso(s: string): ParsedTimestamp | null {
  const m = ISO.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (!validDate(y, mo, d)) return null;
  if (m[4] === undefined) return { ms: Date.UTC(y, mo - 1, d), format: 'iso-date', offset: null };
  const [h, mi, sec] = [Number(m[4]), Number(m[5]), Number(m[6] ?? 0)];
  if (h > 23 || mi > 59 || sec > 60) return null;
  const frac = Number((m[7] ?? '').padEnd(3, '0').slice(0, 3));
  const fields = [y, mo - 1, d, h, mi, Math.min(sec, 59), frac] as const;
  if (m[8] === undefined) {
    // No zone: local time (as ECMAScript does for date-times)
    return { ms: new Date(...fields).getTime(), format: 'iso-datetime', offset: null };
  }
  const offset = parseOffset(m[8]);
  if (offset === null) return null;
  return { ms: Date.UTC(...fields) - offset * 60_000, format: 'iso-datetime', offset };
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const RFC2822 =
  /^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s*)?(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?\s+([+-]\d{4}|UT|GMT|Z|[ECMP][SD]T)$/i;

function parseRfc2822(s: string): ParsedTimestamp | null {
  const m = RFC2822.exec(s);
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), MONTHS.indexOf((m[2] ?? '').toLowerCase()) + 1, Number(m[3])];
  const [h, mi, sec] = [Number(m[4]), Number(m[5]), Number(m[6] ?? 0)];
  if (!validDate(y, mo, d) || h > 23 || mi > 59 || sec > 60) return null;
  const offset = parseOffset(m[7] ?? '');
  if (offset === null) return null;
  const ms = Date.UTC(y, mo - 1, d, h, mi, Math.min(sec, 59)) - offset * 60_000;
  return { ms, format: 'rfc2822', offset };
}

/** Recognises a Unix epoch (2000–2100), ISO 8601 date/date-time or RFC 2822 date. */
export function parseTimestamp(s: string): ParsedTimestamp | null {
  return parseEpoch(s) ?? parseIso(s) ?? parseRfc2822(s);
}

const pad = (n: number) => String(n).padStart(2, '0');

function formatOffset(mins: number): string {
  const sign = mins < 0 ? '-' : '+';
  const a = Math.abs(mins);
  return `${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

/** Wall time in `zone` (default: the runtime's), e.g. `2023-11-14 22:13:20 GMT+00:00 (Europe/London)`. */
export function formatLocal(ms: number, timeZone?: string): string {
  const zone = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const parts = new Intl.DateTimeFormat('en-GB', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'longOffset',
    timeZone: zone,
  }).formatToParts(new Date(ms));
  const p = (t: Intl.DateTimeFormatPartTypes) => parts.find(x => x.type === t)?.value ?? '';
  return `${p('year')}-${p('month')}-${p('day')} ${p('hour')}:${p('minute')}:${p('second')} ${p('timeZoneName')} (${zone})`;
}

/** ISO 8601 week of the UTC date, e.g. `2023-W46`. */
export function isoWeek(ms: number): string {
  const d = new Date(ms);
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - dow); // Thursday of this week decides the year
  const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((day.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${day.getUTCFullYear()}-W${pad(week)}`;
}

function representations(v: TimestampValue): CardData['rows'] {
  return [
    { label: 'ISO 8601 (UTC)', value: new Date(v.ms).toISOString() },
    { label: 'Local', value: formatLocal(v.ms) },
    { label: 'Relative', value: relativeTime(v.ms) },
    { label: 'Unix seconds', value: String(Math.floor(v.ms / 1000)) },
    { label: 'Unix milliseconds', value: String(v.ms) },
    { label: 'RFC 2822', value: new Date(v.ms).toUTCString() },
  ];
}

export const timestampInterpreter: Interpreter<TimestampValue> = {
  kind: 'timestamp',
  isValue: (v): v is TimestampValue => hasKind(v, 'timestamp'),
  detect(c) {
    const t = shortText(c);
    return t !== null && parseTimestamp(t) ? 0.95 : 0;
  },
  parse(c) {
    const input = shortText(c);
    const parsed = input === null ? null : parseTimestamp(input);
    if (input === null || !parsed) throw new Error('Not a timestamp');
    return { kind: 'timestamp', input, ...parsed };
  },
  label: v => `Timestamp · ${formatUtc(v.ms)}`,
  summarise(v) {
    const stats: StatRow[] = [
      ...representations(v),
      {
        label: 'Day of week (UTC)',
        value: new Date(v.ms).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' }),
      },
      { label: 'ISO week', value: isoWeek(v.ms) },
      { label: 'Detected as', value: FORMAT_NAMES[v.format] },
    ];
    if (v.offset !== null) stats.push({ label: 'Input offset', value: formatOffset(v.offset) });
    else if (v.format === 'iso-datetime')
      stats.push({ label: 'Input offset', value: 'none (read as local time)' });
    return { stats, extent: 1 };
  },
  slice(v, req) {
    if (req.type === 'json') return { rows: representations(v) } satisfies CardData;
    return unsupportedSlice('timestamp', req);
  },
  export: v => ({ text: new Date(v.ms).toISOString() }),
};
