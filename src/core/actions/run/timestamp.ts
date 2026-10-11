import { formatLocal, timestampInterpreter } from '../../interpreters/timestamp';
import { timestampConvert } from '../catalog/timestamp';
import { implement } from '../types';
import { textResult } from './util';

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** Checks an IANA zone name; empty means the runtime's own zone. */
export function resolveZone(zone: string): string {
  const z = zone.trim();
  try {
    return new Intl.DateTimeFormat('en-GB', z ? { timeZone: z } : {}).resolvedOptions().timeZone;
  } catch {
    throw new Error(`Unknown time zone "${z}" (use an IANA name like Europe/London)`);
  }
}

interface Zoned {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: string;
  /** Minutes east of UTC. */
  offset: number;
}

/** Wall-clock fields and the UTC offset of `ms` in `timeZone`, via Intl. */
export function zoned(ms: number, timeZone: string): Zoned {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    weekday: 'short',
    hourCycle: 'h23',
    timeZoneName: 'longOffset',
  }).formatToParts(new Date(ms));
  const p = (t: Intl.DateTimeFormatPartTypes) => parts.find(x => x.type === t)?.value ?? '';
  const m = /^GMT(?:([+-])(\d{1,2})(?::?(\d{2}))?)?$/.exec(p('timeZoneName'));
  const offset = m?.[1] ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
  return {
    year: Number(p('year')),
    month: Number(p('month')),
    day: Number(p('day')),
    hour: Number(p('hour')),
    minute: Number(p('minute')),
    second: Number(p('second')),
    weekday: p('weekday'),
    offset,
  };
}

const offsetText = (mins: number, colon: boolean) => {
  const a = Math.abs(mins);
  return `${mins < 0 ? '-' : '+'}${pad(Math.floor(a / 60))}${colon ? ':' : ''}${pad(a % 60)}`;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Milliseconds as `.123`, or nothing when they're zero. */
const fraction = (ms: number) => {
  const f = ((ms % 1000) + 1000) % 1000;
  return f ? `.${pad(f, 3)}` : '';
};

export type TimestampTarget = 'iso-utc' | 'iso-offset' | 'rfc2822' | 'unix-s' | 'unix-ms' | 'local';

export function convertTimestamp(ms: number, to: TimestampTarget, timeZone: string): string {
  switch (to) {
    case 'iso-utc':
      return new Date(ms).toISOString().replace(/\.000Z$/, 'Z');
    case 'unix-s':
      return String(Math.floor(ms / 1000));
    case 'unix-ms':
      return String(ms);
    case 'local':
      return formatLocal(ms, resolveZone(timeZone));
  }
  const z = zoned(ms, resolveZone(timeZone));
  const time = `${pad(z.hour)}:${pad(z.minute)}:${pad(z.second)}`;
  if (to === 'iso-offset') {
    return `${z.year}-${pad(z.month)}-${pad(z.day)}T${time}${fraction(ms)}${offsetText(z.offset, true)}`;
  }
  return `${z.weekday}, ${pad(z.day)} ${MONTHS[z.month - 1] ?? ''} ${z.year} ${time} ${offsetText(z.offset, false)}`;
}

export const timestampImpls = [
  implement(timestampConvert, {
    value: timestampInterpreter.isValue,
    run: ({ value }, { to, timeZone }) => textResult(convertTimestamp(value.ms, to, timeZone)),
  }),
];
