import { describe, expect, it } from 'vitest';
import { register } from '../../src/core/interpreter';
import { detectKinds } from '../../src/core/interpreters';
import { makeJwtInterpreter } from '../../src/core/interpreters/jwt';
import type { InterpretContext } from '../../src/core/interpreter';
import { formatRelative } from '../../src/core/time';
import { textContent } from './helpers';

const noServices: InterpretContext = { service: async () => null };
const NOW = Date.UTC(2026, 9, 11, 12, 0, 0);
const sec = (ms: number) => Math.floor(ms / 1000);

const b64url = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function makeJwt(
  payload: object,
  header: object = { alg: 'HS256', typ: 'JWT' },
  sig = 'c2lnbmF0dXJlLWJ5dGVzLTMyLWxvbmctLS0tLS0tLS0',
) {
  return `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}.${sig}`;
}

const jwt = register(makeJwtInterpreter(() => NOW));
const stat = (stats: { label: string; value: string }[], label: string) =>
  stats.find(s => s.label === label)?.value;

async function parse(token: string) {
  const v = await jwt.parse(textContent(token), noServices);
  return { label: jwt.label(v), summary: await jwt.summarise(v), value: v };
}

describe('jwt', () => {
  it('detects tokens ahead of text and base64', () => {
    const token = makeJwt({ sub: '42' });
    expect(detectKinds(textContent(token))[0]).toEqual({ kind: 'jwt', confidence: 0.98 });
    expect(jwt.detect(textContent(`  ${token}\n`))).toBe(0.98);
  });

  it('rejects look-alikes', () => {
    expect(jwt.detect(textContent('a.b.c'))).toBe(0);
    expect(jwt.detect(textContent(makeJwt({ sub: '1' }, { typ: 'JWT' })))).toBe(0); // no alg
    expect(jwt.detect(textContent('www.example.com'))).toBe(0);
    expect(jwt.detect(textContent(`${makeJwt({ a: 1 })}.extra`))).toBe(0);
  });

  it('accepts an empty signature (unsecured token)', async () => {
    const { value, summary } = await parse(makeJwt({ sub: '1' }, { alg: 'none' }, ''));
    expect(value).toMatchObject({ kind: 'jwt', signature: '', payload: { sub: '1' } });
    expect(stat(summary.stats, 'Signature')).toBe('none (unsecured)');
  });

  it('reports a valid token', async () => {
    const token = makeJwt({
      iss: 'https://auth.example.com',
      sub: 'user-1',
      aud: ['api', 'web'],
      iat: sec(NOW - 60_000),
      exp: sec(NOW + 2 * 3_600_000),
    });
    const { label, summary } = await parse(token);
    expect(label).toBe('JWT · HS256 · expires in 2h');
    expect(stat(summary.stats, 'alg')).toBe('HS256');
    expect(stat(summary.stats, 'typ')).toBe('JWT');
    expect(stat(summary.stats, 'iss')).toBe('https://auth.example.com');
    expect(stat(summary.stats, 'aud')).toBe('api, web');
    expect(stat(summary.stats, 'exp')).toBe('2026-10-11T14:00:00Z (in 2 hours)');
    expect(stat(summary.stats, 'iat')).toBe('2026-10-11T11:59:00Z (1 minute ago)');
    expect(stat(summary.stats, 'Status')).toBe('valid');
    expect(stat(summary.stats, 'Signature')).toBe('32 bytes');
    expect(stat(summary.stats, 'Verification')).toBe('Signature not verified');
  });

  it('reports expired and not-yet-valid tokens', async () => {
    const expired = await parse(makeJwt({ exp: sec(NOW - 3 * 86_400_000) }));
    expect(expired.label).toBe('JWT · HS256 · expired 3d ago');
    expect(stat(expired.summary.stats, 'Status')).toBe('expired');

    const early = await parse(makeJwt({ nbf: sec(NOW + 5 * 60_000), exp: sec(NOW + 86_400_000) }));
    expect(early.label).toBe('JWT · HS256 · valid in 5m');
    expect(stat(early.summary.stats, 'Status')).toBe('not yet valid');

    expect((await parse(makeJwt({ sub: 'x' }))).label).toBe('JWT · HS256 · no expiry');
  });

  it('derives header and payload JSON and exports the payload', async () => {
    const { value } = await parse(makeJwt({ sub: 'x' }));
    expect(jwt.derivations(value).map(d => d.label)).toEqual(['Open header', 'Open payload']);
    const header = await jwt.derive(value, 'header');
    expect(header.mime).toBe('application/json');
    expect(JSON.parse(new TextDecoder().decode(header.bytes))).toEqual({
      alg: 'HS256',
      typ: 'JWT',
    });
    expect((await jwt.export(value)).text).toBe('{\n  "sub": "x"\n}');
    await expect(jwt.derive(value, 'nope')).rejects.toThrow(/no 'nope' derivation/);
  });

  it('formats relative times', () => {
    expect(formatRelative(NOW - 3 * 86_400_000, NOW)).toBe('3 days ago');
    expect(formatRelative(NOW + 1000, NOW, 'short')).toBe('in 1s');
  });
});
