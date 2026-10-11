import { z } from 'zod';
import { defineAction } from '../types';

export const TIMESTAMP_FORMATS = {
  'iso-utc': 'ISO 8601 (UTC)',
  'iso-offset': 'ISO 8601 (with offset)',
  rfc2822: 'RFC 2822',
  'unix-s': 'Unix seconds',
  'unix-ms': 'Unix milliseconds',
  local: 'Local time',
};

/** This browser's IANA zone; the catalog loads in both threads, which share it. */
const browserZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
};

export const timestampConvert = defineAction({
  id: 'timestamp.convert',
  title: 'Convert to',
  group: 'Convert',
  kinds: ['timestamp'],
  params: z.object({
    to: z
      .enum(['iso-utc', 'iso-offset', 'rfc2822', 'unix-s', 'unix-ms', 'local'])
      .default('iso-utc')
      .meta({ title: 'Format', optionLabels: TIMESTAMP_FORMATS }),
    timeZone: z.string().default(browserZone()).meta({
      title: 'Time zone',
      description: 'IANA name, e.g. Europe/London; used by offset ISO, RFC 2822 and local time',
    }),
  }),
  label: p =>
    p.to === 'iso-offset' || p.to === 'rfc2822' || p.to === 'local'
      ? `${TIMESTAMP_FORMATS[p.to]} (${p.timeZone})`
      : TIMESTAMP_FORMATS[p.to],
});

export const timestampActions = [timestampConvert];
