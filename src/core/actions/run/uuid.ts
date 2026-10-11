import { uuidInterpreter, uuidTimestamp, type UuidValue } from '../../interpreters/uuid';
import { uuidFormat, uuidTime } from '../catalog/uuid';
import { implement } from '../types';
import { textResult } from './util';

const hyphenate = (hex: string) =>
  `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;

export function formatUuid(
  hex: string,
  to: 'lower' | 'upper' | 'plain' | 'braces' | 'urn',
): string {
  const canonical = hyphenate(hex.toLowerCase());
  switch (to) {
    case 'lower':
      return canonical;
    case 'upper':
      return canonical.toUpperCase();
    case 'plain':
      return hex.toLowerCase();
    case 'braces':
      return `{${canonical}}`;
    case 'urn':
      return `urn:uuid:${canonical}`;
  }
}

function versionName(v: UuidValue): string {
  if (/^0{32}$/.test(v.hex)) return 'The nil UUID';
  if (/^f{32}$/.test(v.hex)) return 'The max UUID';
  return `UUID v${v.hex.charAt(12)}`;
}

export const uuidImpls = [
  implement(uuidFormat, {
    value: uuidInterpreter.isValue,
    run: ({ value }, { to }) => textResult(formatUuid(value.hex, to)),
  }),
  implement(uuidTime, {
    value: uuidInterpreter.isValue,
    run({ value }) {
      const ms = uuidTimestamp(value);
      if (ms === null) {
        throw new Error(
          `${versionName(value)} has no embedded time (only v1, v6, v7 and ULIDs carry one)`,
        );
      }
      // ISO 8601 text, so the result opens as a timestamp
      return textResult(new Date(ms).toISOString());
    },
  }),
];
