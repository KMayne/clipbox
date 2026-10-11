import { decodeBase64 } from '../base64';
import { createMemo } from '../content';
import { hasKind, isRecord } from '../guards';
import { unsupportedSlice, type Interpreter } from '../interpreter';
import { formatDuration, formatRelative, isoUtc } from '../time';
import type { StatRow } from '../types';

/** Token contents never leave the worker except as slices for the preview; nothing is sent anywhere. */
export interface JwtValue {
  kind: 'jwt';
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  /** Base64url signature segment; empty for unsecured tokens. */
  signature: string;
  raw: string;
}

export type JwtStatus = 'valid' | 'expired' | 'not yet valid';

const JWT = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]*)$/;
export const TIME_CLAIMS = ['iat', 'nbf', 'exp'] as const;

function decodeJsonObject(segment: string): Record<string, unknown> | null {
  const bytes = decodeBase64(segment);
  if (!bytes) return null;
  try {
    const v: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return isRecord(v) ? v : null;
  } catch {
    return null;
  }
}

const parseJwt = createMemo((c): JwtValue | null => {
  const raw = c.text?.trim();
  const m = raw ? JWT.exec(raw) : null;
  if (!raw || !m) return null;
  const header = decodeJsonObject(m[1] ?? '');
  if (!header || typeof header.alg !== 'string') return null;
  const payload = decodeJsonObject(m[2] ?? '');
  if (!payload) return null;
  return { kind: 'jwt', header, payload, signature: m[3] ?? '', raw };
});

/** A NumericDate claim in milliseconds, if present and numeric. */
export function claimTime(payload: Record<string, unknown>, claim: string): number | null {
  const v = payload[claim];
  return typeof v === 'number' && Number.isFinite(v) ? v * 1000 : null;
}

export function jwtStatus(payload: Record<string, unknown>, now: number): JwtStatus {
  const exp = claimTime(payload, 'exp');
  const nbf = claimTime(payload, 'nbf');
  if (exp !== null && now >= exp) return 'expired';
  if (nbf !== null && now < nbf) return 'not yet valid';
  return 'valid';
}

function timeLabel(payload: Record<string, unknown>, now: number): string | null {
  const exp = claimTime(payload, 'exp');
  const nbf = claimTime(payload, 'nbf');
  switch (jwtStatus(payload, now)) {
    case 'expired':
      return exp === null ? null : `expired ${formatDuration(now - exp, 'short')} ago`;
    case 'not yet valid':
      return nbf === null ? null : `valid in ${formatDuration(nbf - now, 'short')}`;
    case 'valid':
      return exp === null ? 'no expiry' : `expires in ${formatDuration(exp - now, 'short')}`;
  }
}

const claimText = (v: unknown) =>
  typeof v === 'string' ? v : Array.isArray(v) ? v.map(String).join(', ') : JSON.stringify(v);

const signatureLength = (sig: string) => decodeBase64(sig)?.byteLength ?? 0;

const jsonBytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v, null, 2));

/** `now` is injectable so tests can pin the clock. */
export function makeJwtInterpreter(now: () => number = Date.now): Interpreter<JwtValue> {
  return {
    kind: 'jwt',
    isValue: (v): v is JwtValue => hasKind(v, 'jwt'),
    detect: c => (parseJwt(c) ? 0.98 : 0),
    parse(c) {
      const v = parseJwt(c);
      if (!v) throw new Error('Not a JWT');
      return v;
    },
    label({ header, payload }) {
      const time = timeLabel(payload, now());
      return ['JWT', String(header.alg), time].filter(Boolean).join(' · ');
    },
    summarise({ header, payload, signature, raw }) {
      const t = now();
      const stats: StatRow[] = [];
      for (const k of ['alg', 'typ', 'kid'] as const) {
        if (header[k] !== undefined) stats.push({ label: k, value: claimText(header[k]) });
      }
      for (const k of ['iss', 'sub', 'aud'] as const) {
        if (payload[k] !== undefined) stats.push({ label: k, value: claimText(payload[k]) });
      }
      for (const k of TIME_CLAIMS) {
        const at = claimTime(payload, k);
        if (at !== null)
          stats.push({ label: k, value: `${isoUtc(at)} (${formatRelative(at, t)})` });
      }
      const sigBytes = signatureLength(signature);
      stats.push(
        { label: 'Status', value: jwtStatus(payload, t) },
        { label: 'Signature', value: sigBytes > 0 ? `${sigBytes} bytes` : 'none (unsecured)' },
        { label: 'Verification', value: 'Signature not verified' },
      );
      return { stats, extent: raw.length };
    },
    slice({ header, payload }, req) {
      if (req.type === 'json') return { header, payload };
      return unsupportedSlice('jwt', req);
    },
    export: ({ payload }) => ({ text: JSON.stringify(payload, null, 2) }),
    derivations: () => [
      { id: 'header', label: 'Open header' },
      { id: 'payload', label: 'Open payload' },
    ],
    derive: ({ header, payload }, id) => ({
      mime: 'application/json',
      bytes: jsonBytes(id === 'header' ? header : payload),
    }),
  };
}

export const jwtInterpreter = makeJwtInterpreter();
