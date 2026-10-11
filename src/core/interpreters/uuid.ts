import { hasKind } from '../guards';
import { unsupportedSlice, type Interpreter } from '../interpreter';
import { formatUtc, shortText, type CardData, type CardRow } from '../smallValue';
import type { StatRow } from '../types';

export interface UuidValue {
  kind: 'uuid';
  /** 32 lowercase hex digits. */
  hex: string;
  /** Canonical (uppercase) ULID when the input was one. */
  ulid: string | null;
}

const HYPHENATED = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLAIN = /^[0-9a-f]{32}$/i;
const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/i;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const MIN_MS = Date.UTC(2000, 0, 1);
const MAX_MS = Date.UTC(2100, 0, 1);

const isNil = (hex: string) => /^0{32}$/.test(hex);
const isMax = (hex: string) => /^f{32}$/.test(hex);
const versionOf = (hex: string) => parseInt(hex.charAt(12), 16);
const variantNibble = (hex: string) => parseInt(hex.charAt(16), 16);
const isRfcVariant = (hex: string) => (variantNibble(hex) & 0b1100) === 0b1000;

function decodeUlid(s: string): string {
  let n = 0n;
  for (const ch of s.toUpperCase()) n = (n << 5n) | BigInt(CROCKFORD.indexOf(ch));
  return n.toString(16).padStart(32, '0');
}

export function encodeUlid(hex: string): string {
  let n = BigInt(`0x${hex}`);
  let out = '';
  for (let i = 0; i < 26; i++) {
    out = CROCKFORD[Number(n & 31n)] + out;
    n >>= 5n;
  }
  return out;
}

/** Parses a UUID (v1–v8, nil, max; hyphenated or not, braces or `urn:uuid:` allowed) or a ULID. */
export function parseUuid(input: string): Omit<UuidValue, 'kind'> | null {
  const s = input.replace(/^urn:uuid:/i, '').replace(/^\{(.*)\}$/, '$1');
  if (HYPHENATED.test(s) || PLAIN.test(s)) {
    const hex = s.replace(/-/g, '').toLowerCase();
    if (isNil(hex) || isMax(hex)) return { hex, ulid: null };
    const v = versionOf(hex);
    if (v < 1 || v > 8) return null;
    // Bare 32-hex strings are often hashes: insist on the RFC variant bits too
    if (!HYPHENATED.test(s) && !isRfcVariant(hex)) return null;
    return { hex, ulid: null };
  }
  if (ULID.test(input)) {
    const hex = decodeUlid(input);
    const ms = parseInt(hex.slice(0, 12), 16);
    if (ms < MIN_MS || ms >= MAX_MS) return null;
    return { hex, ulid: input.toUpperCase() };
  }
  return null;
}

const GREGORIAN_OFFSET = 0x01b21dd213814000n; // 100ns intervals from 1582-10-15 to 1970-01-01

/** Embedded Unix ms for v1, v6, v7 and ULID; null otherwise. */
export function uuidTimestamp(v: Omit<UuidValue, 'kind'>): number | null {
  const { hex } = v;
  if (v.ulid !== null) return parseInt(hex.slice(0, 12), 16);
  if (isNil(hex) || isMax(hex)) return null;
  const big = (from: number, to: number) => BigInt(`0x${hex.slice(from, to)}`);
  switch (versionOf(hex)) {
    case 1:
      return Number(
        (((big(13, 16) << 48n) | (big(8, 12) << 32n) | big(0, 8)) - GREGORIAN_OFFSET) / 10_000n,
      );
    case 6:
      return Number(
        (((big(0, 8) << 28n) | (big(8, 12) << 12n) | big(13, 16)) - GREGORIAN_OFFSET) / 10_000n,
      );
    case 7:
      return parseInt(hex.slice(0, 12), 16);
    default:
      return null;
  }
}

const VERSIONS: Record<number, string> = {
  1: 'Gregorian time + node',
  2: 'DCE security',
  3: 'MD5 name-based',
  4: 'random',
  5: 'SHA-1 name-based',
  6: 'reordered Gregorian time',
  7: 'Unix time-ordered',
  8: 'custom',
};

function variantName(hex: string): string {
  const n = variantNibble(hex);
  if (n < 8) return 'NCS (reserved)';
  if (n < 12) return 'RFC 9562';
  if (n < 14) return 'Microsoft (reserved)';
  return 'Future (reserved)';
}

const hyphenate = (hex: string) =>
  `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;

function versionLabel(v: UuidValue): string {
  if (v.ulid !== null) return 'ULID';
  if (isNil(v.hex)) return 'nil';
  if (isMax(v.hex)) return 'max';
  return `v${versionOf(v.hex)}`;
}

function representations(v: UuidValue): CardRow[] {
  const canonical = hyphenate(v.hex);
  const rows: CardRow[] =
    v.ulid !== null
      ? [
          { label: 'ULID', value: v.ulid },
          { label: 'Lowercase', value: v.ulid.toLowerCase() },
          { label: 'As UUID', value: canonical },
        ]
      : [
          { label: 'Canonical', value: canonical },
          { label: 'Uppercase', value: canonical.toUpperCase() },
          { label: 'Unhyphenated', value: v.hex },
        ];
  const ms = uuidTimestamp(v);
  if (ms !== null) rows.push({ label: 'Timestamp', value: new Date(ms).toISOString() });
  return rows;
}

export const uuidInterpreter: Interpreter<UuidValue> = {
  kind: 'uuid',
  isValue: (v): v is UuidValue => hasKind(v, 'uuid'),
  detect(c) {
    const t = shortText(c);
    return t !== null && parseUuid(t) ? 0.95 : 0;
  },
  parse(c) {
    const t = shortText(c);
    const parsed = t === null ? null : parseUuid(t);
    if (!parsed) throw new Error('Not a UUID');
    return { kind: 'uuid', ...parsed };
  },
  label(v) {
    const ms = uuidTimestamp(v);
    const name = v.ulid !== null ? 'ULID' : `UUID ${versionLabel(v)}`;
    return ms === null ? name : `${name} · ${formatUtc(ms)}`;
  },
  summarise(v) {
    const special = v.ulid === null && (isNil(v.hex) || isMax(v.hex));
    const stats: StatRow[] = [{ label: 'Format', value: v.ulid !== null ? 'ULID' : 'UUID' }];
    if (v.ulid === null) {
      const n = versionOf(v.hex);
      stats.push({
        label: 'Version',
        value: special ? versionLabel(v) : `${n} (${VERSIONS[n] ?? 'unknown'})`,
      });
      if (!special) stats.push({ label: 'Variant', value: variantName(v.hex) });
    }
    const ms = uuidTimestamp(v);
    if (ms !== null) stats.push({ label: 'Embedded time', value: formatUtc(ms) });
    stats.push(...representations(v).filter(r => r.label !== 'Timestamp'));
    return { stats, extent: 1 };
  },
  slice(v, req) {
    if (req.type === 'json') return { rows: representations(v) } satisfies CardData;
    return unsupportedSlice('uuid', req);
  },
  export: v => ({ text: v.ulid ?? hyphenate(v.hex) }),
};
