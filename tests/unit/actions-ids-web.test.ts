import 'reflect-metadata';
import { PemConverter, X509CertificateGenerator } from '@peculiar/x509';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { actionById } from '../../src/core/actions/catalog';
import { actionLabel, formFields } from '../../src/core/actions/form';
import { contrastLine } from '../../src/core/actions/run/colour';
import { convertTimestamp } from '../../src/core/actions/run/timestamp';
import { stripTracking } from '../../src/core/actions/run/url';
import { defineAction } from '../../src/core/actions/types';
import { ecdsaDerToRaw, spkiFromCertificate } from '../../src/core/der';
import { toBase64 } from '../../src/core/format';
import { hexDump } from '../../src/core/hexdump';
import { parseColour, rgbToOklch, toOklchString } from '../../src/core/interpreters/colour';
import type { EntryId } from '../../src/core/types';
import { Engine } from '../../src/engine/engine';
import { parseEffect } from '../../src/state/effects';
import { chain, ecKeys, selfSigned } from '../fixtures/certs';
import { pngHeader } from './helpers';

const entry = (
  content: string | Uint8Array<ArrayBuffer>,
  mime = 'text/plain',
  id: EntryId = 'en-1',
) => {
  const blob = new Blob([content], { type: mime });
  return { id, mime, size: blob.size, blob };
};

const loaders = { x509: () => import('../../src/modules/x509/worker') };

async function engineWith(content: string | Uint8Array<ArrayBuffer>, mime?: string) {
  const engine = new Engine({ loaders });
  await engine.ingest(entry(content, mime));
  return engine;
}

/** Ingests `content` and runs one action on its `kind` interpretation; returns the output text. */
async function run(
  content: string | Uint8Array<ArrayBuffer>,
  kind: string,
  actionId: string,
  params?: unknown,
  mime?: string,
) {
  const engine = await engineWith(content, mime);
  if (kind === 'pem') await engine.resolve('en-1', 'pem');
  const [out, ...rest] = await engine.runAction('en-1', kind, actionId, params);
  if (!out || rest.length) throw new Error('expected exactly one result');
  return { ...out, text: new TextDecoder().decode(out.bytes) };
}

const info = (id: string) => {
  const a = actionById(id);
  if (!a) throw new Error(id);
  return a;
};

afterEach(() => {
  vi.useRealTimers();
});

describe('secret settings', () => {
  const action = defineAction({
    id: 'test.secret',
    title: 'Sign',
    group: 'Inspect',
    kinds: ['text'],
    params: z.object({
      key: z.string().default('').meta({ title: 'Key', secret: true }),
      note: z.string().default('').meta({ title: 'Note' }),
    }),
  });

  it('are marked in the form and never appear in default labels', () => {
    expect(formFields(action.params)[0]).toMatchObject({ key: 'key', secret: true });
    expect(formFields(action.params)[1]).not.toHaveProperty('secret');
    expect(actionLabel(action, { key: 'hunter2', note: 'hi' })).toBe('Sign ("hi")');
    expect(actionLabel(action, { key: 'hunter2' })).toBe('Sign');
  });

  it('make a custom label that echoes them fall back to the title', () => {
    const leaky = defineAction({ ...action, label: p => `Sign with ${p.key}` });
    expect(actionLabel(leaky, { key: 'hunter2' })).toBe('Sign');
  });

  it('keep the JWT key out of its label', () => {
    expect(actionLabel(info('jwt.verify'), { key: 'my-very-secret-key', clockSkew: 5 })).toBe(
      'Verify signature',
    );
  });
});

describe('action effects', () => {
  it('open-url accepts only http(s) URLs', () => {
    expect(parseEffect({ effect: 'open-url', url: 'https://example.com/a?b=1' })).toEqual({
      effect: 'open-url',
      url: 'https://example.com/a?b=1',
    });
    for (const url of ['javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', 'nope']) {
      expect(() => parseEffect({ effect: 'open-url', url }), url).toThrow();
    }
    expect(() => parseEffect({ effect: 'download', url: 'https://x.y' })).toThrow();
  });

  it('URL Open in new tab returns an effect instead of a capture', async () => {
    const engine = await engineWith('https://example.com/path?q=1');
    expect(await engine.actionEffect('en-1', 'url', 'url.open', {})).toEqual({
      effect: 'open-url',
      url: 'https://example.com/path?q=1',
    });
    await expect(engine.runAction('en-1', 'url', 'url.open', {})).rejects.toThrow(
      "doesn't make a capture",
    );
    await expect(engine.actionEffect('en-1', 'url', 'url.decode', {})).rejects.toThrow(
      'makes a capture',
    );
  });

  it('is only offered for a single web URL', async () => {
    expect(await (await engineWith('ftp://example.com/x')).actions('en-1', 'url')).not.toContain(
      'url.open',
    );
    const two = await engineWith('https://a.example/\nhttps://b.example/');
    expect(await two.actions('en-1', 'url')).not.toContain('url.open');
  });
});

// --- JWT ---------------------------------------------------------------------------------------

const b64url = (bytes: Uint8Array | ArrayBuffer) =>
  toBase64(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const enc = (s: string) => new TextEncoder().encode(s);
const segment = (o: unknown) => b64url(enc(JSON.stringify(o)));

async function sign(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  key: CryptoKey,
  params: AlgorithmIdentifier | RsaPssParams | EcdsaParams,
) {
  const input = `${segment(header)}.${segment(payload)}`;
  const sig = await crypto.subtle.sign(params, key, enc(input));
  return `${input}.${b64url(sig)}`;
}

const NOW = Date.UTC(2024, 0, 1, 12);
const sec = (ms: number) => Math.floor(ms / 1000);
const claims = { sub: 'u1', iat: sec(NOW) - 60, exp: sec(NOW) + 7200 };

async function verify(token: string, params: Record<string, unknown>) {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  return (await run(token, 'jwt', 'jwt.verify', params)).text;
}

const spkiPem = async (key: CryptoKey) =>
  PemConverter.encode(await crypto.subtle.exportKey('spki', key), 'PUBLIC KEY');

describe('JWT Verify signature', () => {
  it('verifies HS256 with a text or base64 secret', async () => {
    const secret = 'correct horse battery staple';
    const key = await crypto.subtle.importKey(
      'raw',
      enc(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const token = await sign({ alg: 'HS256', typ: 'JWT' }, claims, key, 'HMAC');
    const ok = await verify(token, { key: secret });
    expect(ok.split('\n')[0]).toBe('Signature valid (HS256) · expires in 2h');
    expect(ok).not.toContain(secret);
    expect(await verify(token, { key: toBase64(enc(secret)), secretIsBase64: true })).toMatch(
      /^Signature valid/,
    );
    expect(await verify(token, { key: 'wrong' })).toMatch(/^INVALID signature \(HS256\)/);
    // A PEM key for an HMAC token is refused (algorithm confusion)
    const { publicPem } = await ecKeys();
    await expect(verify(token, { key: publicPem })).rejects.toThrow('needs the shared secret');
    await expect(verify(token, { key: '  ' })).rejects.toThrow('Enter the key');
  });

  it('verifies HS384 and HS512', async () => {
    for (const bits of [384, 512]) {
      const key = await crypto.subtle.importKey(
        'raw',
        enc('s3cret'),
        { name: 'HMAC', hash: `SHA-${bits}` },
        false,
        ['sign'],
      );
      const token = await sign({ alg: `HS${bits}` }, claims, key, 'HMAC');
      expect(await verify(token, { key: 's3cret' })).toMatch(`Signature valid (HS${bits})`);
    }
  });

  it('verifies RS256 and PS384 with a PEM public key, a certificate or a JWK', async () => {
    const rsa = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        hash: 'SHA-256',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
      },
      true,
      ['sign', 'verify'],
    );
    const rs = await sign({ alg: 'RS256', kid: 'k1' }, claims, rsa.privateKey, 'RSASSA-PKCS1-v1_5');
    expect(await verify(rs, { key: await spkiPem(rsa.publicKey) })).toMatch(
      /^Signature valid \(RS256\)/,
    );

    const cert = await X509CertificateGenerator.createSelfSigned({
      serialNumber: '01',
      name: 'CN=jwt.example',
      notBefore: new Date(NOW - 86_400_000),
      notAfter: new Date(NOW + 86_400_000),
      signingAlgorithm: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      keys: rsa,
    });
    const certReport = await verify(rs, { key: cert.toString('pem') });
    expect(certReport).toMatch(/^Signature valid/);
    expect(certReport).toContain("Key:        certificate's public key");

    const jwk = await crypto.subtle.exportKey('jwk', rsa.publicKey);
    const other = await crypto.subtle.exportKey(
      'jwk',
      (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']))
        .publicKey,
    );
    const jwks = JSON.stringify({
      keys: [
        { ...other, kid: 'k0' },
        { ...jwk, kid: 'k1' },
      ],
    });
    const jwkReport = await verify(rs, { key: jwks });
    expect(jwkReport).toMatch(/^Signature valid/);
    expect(jwkReport).toContain('JWK (kid k1)');

    const pss = await crypto.subtle.generateKey(
      {
        name: 'RSA-PSS',
        hash: 'SHA-384',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
      },
      true,
      ['sign', 'verify'],
    );
    const ps = await sign({ alg: 'PS384' }, claims, pss.privateKey, {
      name: 'RSA-PSS',
      saltLength: 48,
    });
    expect(await verify(ps, { key: await spkiPem(pss.publicKey) })).toMatch(
      /^Signature valid \(PS384\)/,
    );
    // Right type, wrong key
    expect(await verify(ps, { key: await spkiPem(rsa.publicKey) })).toMatch(/^INVALID signature/);
  });

  it('verifies ES256/384/512 (raw r‖s, and DER from non-conforming signers)', async () => {
    const curves = [
      ['ES256', 'P-256', 'SHA-256'],
      ['ES384', 'P-384', 'SHA-384'],
      ['ES512', 'P-521', 'SHA-512'],
    ] as const;
    for (const [alg, namedCurve, hash] of curves) {
      const ec = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve }, true, [
        'sign',
        'verify',
      ]);
      const token = await sign({ alg }, claims, ec.privateKey, { name: 'ECDSA', hash });
      const key = await spkiPem(ec.publicKey);
      expect(await verify(token, { key }), alg).toMatch(`Signature valid (${alg})`);
      // Tampered payload
      const [h, , s] = token.split('.');
      const forged = `${h}.${segment({ ...claims, sub: 'admin' })}.${s}`;
      expect(await verify(forged, { key }), alg).toMatch(/^INVALID signature/);
    }
  });

  it('converts DER ECDSA signatures to raw', () => {
    // SEQUENCE { INTEGER 0x00ff (sign padding), INTEGER 0x01 }
    const der = new Uint8Array([0x30, 0x07, 0x02, 0x02, 0x00, 0xff, 0x02, 0x01, 0x01]);
    const raw = ecdsaDerToRaw(der, 4);
    expect([...raw]).toEqual([0, 0, 0, 0xff, 0, 0, 0, 1]);
  });

  it('verifies EdDSA', async () => {
    const ed = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    if (!('privateKey' in ed)) throw new Error('expected a key pair');
    const token = await sign({ alg: 'EdDSA' }, claims, ed.privateKey, 'Ed25519');
    expect(await verify(token, { key: await spkiPem(ed.publicKey) })).toMatch(
      'Signature valid (EdDSA)',
    );
  });

  it('checks exp, nbf and iat with clock skew', async () => {
    const key = await crypto.subtle.importKey(
      'raw',
      enc('k'),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const expired = await sign({ alg: 'HS256' }, { exp: sec(NOW) - 30 }, key, 'HMAC');
    expect((await verify(expired, { key: 'k', clockSkew: 0 })).split('\n')[0]).toBe(
      'Signature valid (HS256) · EXPIRED 30S AGO',
    );
    expect(await verify(expired, { key: 'k', clockSkew: 60 })).toMatch(
      /^Signature valid \(HS256\) · expires in/,
    );
    const early = await sign(
      { alg: 'HS256' },
      { nbf: sec(NOW) + 3600, iat: sec(NOW) + 3600 },
      key,
      'HMAC',
    );
    const report = await verify(early, { key: 'k' });
    expect(report).toMatch(/NOT VALID UNTIL IN 1H/);
    expect(report).toMatch(/ISSUED IN THE FUTURE/);
    expect(report).toContain('The signature is genuine, but the token is not currently valid.');
    const forever = await sign({ alg: 'HS256' }, { sub: 'x' }, key, 'HMAC');
    expect((await verify(forever, { key: 'k' })).split('\n')[0]).toBe(
      'Signature valid (HS256) · no expiry',
    );
  });

  it('is not offered for unsecured tokens', async () => {
    const token = `${segment({ alg: 'none' })}.${segment(claims)}.`;
    const engine = await engineWith(token);
    expect(await engine.actions('en-1', 'jwt')).not.toContain('jwt.verify');
  });
});

describe('certificate public keys without the x509 module', () => {
  it('finds the SPKI inside a certificate', async () => {
    const pem = await selfSigned('spki.example', 5);
    const der = PemConverter.decodeFirst(pem);
    const spki = spkiFromCertificate(new Uint8Array(der));
    const key = await crypto.subtle.importKey(
      'spki',
      spki,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      true,
      ['verify'],
    );
    expect(key.type).toBe('public');
  });
});

// --- Timestamp ---------------------------------------------------------------------------------

describe('Timestamp Convert to', () => {
  const ms = Date.UTC(2023, 10, 14, 22, 13, 20); // 1700000000

  it('converts to each format', () => {
    expect(convertTimestamp(ms, 'iso-utc', 'UTC')).toBe('2023-11-14T22:13:20Z');
    expect(convertTimestamp(ms + 5, 'iso-utc', 'UTC')).toBe('2023-11-14T22:13:20.005Z');
    expect(convertTimestamp(ms, 'unix-s', 'UTC')).toBe('1700000000');
    expect(convertTimestamp(ms + 999, 'unix-s', 'UTC')).toBe('1700000000');
    expect(convertTimestamp(ms, 'unix-ms', 'UTC')).toBe('1700000000000');
    expect(convertTimestamp(ms, 'iso-offset', 'Asia/Kolkata')).toBe('2023-11-15T03:43:20+05:30');
    expect(convertTimestamp(ms, 'iso-offset', 'America/New_York')).toBe(
      '2023-11-14T17:13:20-05:00',
    );
    expect(convertTimestamp(ms, 'iso-offset', 'UTC')).toBe('2023-11-14T22:13:20+00:00');
    expect(convertTimestamp(ms, 'rfc2822', 'UTC')).toBe('Tue, 14 Nov 2023 22:13:20 +0000');
    expect(convertTimestamp(ms, 'rfc2822', 'Asia/Kolkata')).toBe('Wed, 15 Nov 2023 03:43:20 +0530');
    expect(convertTimestamp(ms, 'local', 'Europe/Paris')).toBe(
      '2023-11-14 23:13:20 GMT+01:00 (Europe/Paris)',
    );
  });

  it('rejects unknown zones', () => {
    expect(() => convertTimestamp(ms, 'local', 'Mars/Olympus')).toThrow('Unknown time zone');
  });

  it('runs through the engine', async () => {
    expect(
      (await run('1700000000', 'timestamp', 'timestamp.convert', { to: 'iso-utc' })).text,
    ).toBe('2023-11-14T22:13:20Z');
    expect(actionLabel(info('timestamp.convert'), { to: 'local', timeZone: 'Asia/Tokyo' })).toBe(
      'Local time (Asia/Tokyo)',
    );
  });
});

// --- UUID --------------------------------------------------------------------------------------

describe('UUID actions', () => {
  const v4 = '9b2c7e5a-3f41-4d7e-9a0b-1c2d3e4f5a6b';

  it('reformats', async () => {
    const fmt = async (to: string) =>
      (await run(v4.toUpperCase(), 'uuid', 'uuid.format', { to })).text;
    expect(await fmt('lower')).toBe(v4);
    expect(await fmt('upper')).toBe(v4.toUpperCase());
    expect(await fmt('plain')).toBe(v4.replace(/-/g, ''));
    expect(await fmt('braces')).toBe(`{${v4}}`);
    expect(await fmt('urn')).toBe(`urn:uuid:${v4}`);
  });

  it('extracts the embedded time of v1, v6, v7 and ULIDs (RFC 9562 examples)', async () => {
    const time = async (id: string) => (await run(id, 'uuid', 'uuid.time')).text;
    expect(await time('C232AB00-9414-11EC-B3C8-9F6BDECED846')).toBe('2022-02-22T19:22:22.000Z');
    expect(await time('1EC9414C-232A-6B00-B3C8-9F6BDECED846')).toBe('2022-02-22T19:22:22.000Z');
    expect(await time('017F22E2-79B0-7CC3-98C4-DC0C0C07398F')).toBe('2022-02-22T19:22:22.000Z');
    expect(await time('01ARZ3NDEKTSV4RRFFQ69G5FAV')).toBe('2016-07-30T23:54:10.259Z');
  });

  it('explains when there is no time', async () => {
    await expect(run(v4, 'uuid', 'uuid.time')).rejects.toThrow(
      'UUID v4 has no embedded time (only v1, v6, v7 and ULIDs carry one)',
    );
  });

  it('extracted times open as timestamps', async () => {
    const out = await run('017F22E2-79B0-7CC3-98C4-DC0C0C07398F', 'uuid', 'uuid.time');
    const engine = new Engine({ loaders: {} });
    const result = await engine.ingest(entry(out.text, out.mime));
    expect(result.interpretations[0]?.kind).toBe('timestamp');
  });
});

// --- URL ---------------------------------------------------------------------------------------

describe('URL actions', () => {
  it('percent-decodes and encodes', async () => {
    const url = 'https://example.com/caf%C3%A9?q=a%20b';
    expect((await run(url, 'url', 'url.decode')).text).toBe('https://example.com/café?q=a b\n');
    expect((await run(url, 'url', 'url.encode')).text).toBe(
      'https%3A%2F%2Fexample.com%2Fcaf%25C3%25A9%3Fq%3Da%2520b\n',
    );
  });

  it('turns the query into JSON, with repeated keys as arrays', async () => {
    const out = await run(
      'https://x.example/?a=1&b=two&a=3&__proto__=p&e=',
      'url',
      'url.queryJson',
    );
    expect(out.mime).toBe('application/json');
    expect(JSON.parse(out.text)).toEqual({ a: ['1', '3'], b: 'two', ['__proto__']: 'p', e: '' });
    expect(Object.keys(JSON.parse(out.text))).toContain('__proto__');
    const many = await run(
      'https://x.example/?a=1\nhttps://y.example/?b=2',
      'url',
      'url.queryJson',
    );
    expect(JSON.parse(many.text)).toEqual([
      { url: 'https://x.example/?a=1', query: { a: '1' } },
      { url: 'https://y.example/?b=2', query: { b: '2' } },
    ]);
  });

  it('strips tracking params and keeps the rest as they were', () => {
    expect(
      stripTracking(
        'https://shop.example/p?id=42&utm_source=news&UTM_Medium=email&fbclid=x&q=a+b%21&gclid=y#top',
      ),
    ).toBe('https://shop.example/p?id=42&q=a+b%21#top');
    expect(stripTracking('https://e.example/?utm_campaign=x&mc_eid=1&_hsenc=2&msclkid=3')).toBe(
      'https://e.example/',
    );
    // si only tracks on YouTube and Spotify
    expect(stripTracking('https://youtu.be/abc?si=xyz&t=10')).toBe('https://youtu.be/abc?t=10');
    expect(stripTracking('https://open.spotify.com/track/1?si=abc')).toBe(
      'https://open.spotify.com/track/1',
    );
    expect(stripTracking('https://other.example/?si=metric')).toBe(
      'https://other.example/?si=metric',
    );
    expect(stripTracking('https://a.example/?ref=x&aff_id=1&keep=1', ['ref', 'aff_*'])).toBe(
      'https://a.example/?keep=1',
    );
  });

  it('runs Strip tracking params over every line', async () => {
    const out = await run(
      'https://a.example/?utm_source=x&id=1\nhttps://b.example/?ref=y',
      'url',
      'url.stripTracking',
      { extra: 'ref' },
    );
    expect(out.text).toBe('https://a.example/?id=1\nhttps://b.example/\n');
  });
});

// --- Colour ------------------------------------------------------------------------------------

describe('Colour actions', () => {
  const convert = async (input: string, to: string) =>
    (await run(input, 'colour', 'colour.convert', { to })).text;

  it('converts between formats, keeping alpha', async () => {
    expect(await convert('rgb(51, 102, 153)', 'hex')).toBe('#336699');
    expect(await convert('#336699', 'rgb')).toBe('rgb(51, 102, 153)');
    expect(await convert('#336699', 'hsl')).toBe('hsl(210, 50%, 40%)');
    expect(await convert('#33669980', 'rgb')).toBe('rgba(51, 102, 153, 0.502)');
    expect(await convert('hsla(0, 100%, 50%, 0.5)', 'hex')).toBe('#ff000080');
    expect(await convert('#ff0000', 'oklch')).toBe('oklch(62.8% 0.2577 29.23)');
    expect(await convert('#ff000080', 'oklch')).toBe('oklch(62.8% 0.2577 29.23 / 0.502)');
    expect(await convert('#ffffff', 'oklch')).toBe('oklch(100% 0 0)');
    expect(await convert('#000000', 'oklch')).toBe('oklch(0% 0 0)');
  });

  it('matches reference OKLCH values (Ottosson / CSS Color 4)', () => {
    const ok = (hex: string) => {
      const c = parseColour(hex);
      if (!c) throw new Error(hex);
      return rgbToOklch(c.r, c.g, c.b);
    };
    const [gL, gC, gH] = ok('#00ff00');
    expect(gL).toBeCloseTo(0.86644, 4);
    expect(gC).toBeCloseTo(0.294827, 4);
    expect(gH).toBeCloseTo(142.4953, 2);
    const [bL, bC, bH] = ok('#0000ff');
    expect(bL).toBeCloseTo(0.452014, 4);
    expect(bC).toBeCloseTo(0.313214, 4);
    expect(bH).toBeCloseTo(264.052, 2);
  });

  it('parses oklch() so converted colours round-trip', () => {
    for (const hex of ['#336699', '#ff8800', '#123456', '#ffffff', '#000000']) {
      const c = parseColour(hex);
      if (!c) throw new Error(hex);
      const back = parseColour(toOklchString(c));
      expect(back, hex).not.toBeNull();
      for (const ch of ['r', 'g', 'b'] as const) {
        expect(Math.abs((back?.[ch] ?? -9) - c[ch]), `${hex} ${ch}`).toBeLessThan(0.6);
      }
    }
    expect(parseColour('oklch(0.628 0.2577 29.23 / 50%)')?.a).toBe(0.5);
  });

  it('reports WCAG contrast against white, black and an optional colour', async () => {
    const white = { r: 255, g: 255, b: 255, a: 1 };
    const grey = (n: number) => ({ r: n, g: n, b: n, a: 1 });
    // #767676 is the darkest grey passing AA on white; #777777 just fails (4.48)
    expect(contrastLine('x', grey(0x76), white)).toBe(
      'x: 4.54:1 · normal text AA pass, AAA fail · large text AA pass, AAA pass',
    );
    expect(contrastLine('x', grey(0x77), white)).toBe(
      'x: 4.47:1 · normal text AA fail, AAA fail · large text AA pass, AAA fail',
    );
    const out = (await run('#000000', 'colour', 'colour.contrast', { against: '#ffff00' })).text;
    expect(out).toContain('vs white #ffffff: 21.00:1 · normal text AA pass, AAA pass');
    expect(out).toContain('vs black #000000: 1.00:1 · normal text AA fail');
    expect(out).toContain('vs #ffff00: 19.55:1');
    await expect(run('#000', 'colour', 'colour.contrast', { against: 'blue-ish' })).rejects.toThrow(
      "isn't a colour",
    );
  });
});

// --- Base64 / binary / any ---------------------------------------------------------------------

describe('Base64 actions', () => {
  it('makes a data URL with the decoded type', async () => {
    const png = pngHeader(2, 2);
    expect((await run(toBase64(png), 'base64', 'base64.dataUrl')).text).toBe(
      `data:image/png;base64,${toBase64(png)}`,
    );
    expect((await run(toBase64(enc('{"hello": "world"}')), 'base64', 'base64.dataUrl')).text).toBe(
      `data:application/json;charset=utf-8;base64,${toBase64(enc('{"hello": "world"}'))}`,
    );
  });

  it('switches alphabet with padding kept, stripped or added', async () => {
    const bytes = new Uint8Array([0xfb, 0xff, 0xbf, 0xfe, 0x01]); // "+/+//gE=" in standard
    const std = toBase64(bytes);
    expect(std).toBe('+/+//gE=');
    const sw = async (input: string, params: unknown) =>
      (await run(input, 'base64', 'base64.alphabet', params)).text;
    // These short strings need a real-looking token to detect as base64; pad them out
    const long = new Uint8Array([...bytes, ...bytes, ...bytes, ...bytes, ...bytes]);
    const longStd = toBase64(long);
    expect(await sw(longStd, { to: 'url' })).toBe(longStd.replace(/\+/g, '-').replace(/\//g, '_'));
    expect(await sw(longStd, { to: 'url', padding: 'strip' })).toBe(
      longStd.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
    );
    const urlNoPad = longStd.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(await sw(urlNoPad, { to: 'standard' })).toBe(longStd.replace(/=+$/, ''));
    expect(await sw(urlNoPad, { to: 'standard', padding: 'add' })).toBe(longStd);
  });
});

describe('Binary and any-kind actions', () => {
  const bytes = new Uint8Array([0x00, 0x01, 0xff, 0x48, 0x69, 0x0a, 0x7f, 0x80, 0x20]);

  it('hex dumps like hexdump -C', () => {
    const text = new Uint8Array([...enc('Hello, world! 0123456789'), 0, 0xff]);
    expect(hexDump(text)).toBe(
      '00000000  48 65 6c 6c 6f 2c 20 77  6f 72 6c 64 21 20 30 31  |Hello, world! 01|\n' +
        '00000010  32 33 34 35 36 37 38 39  00 ff                    |23456789..|\n' +
        '0000001a\n',
    );
    expect(hexDump(text, 8).split('\n')[0]).toBe('00000000  48 65 6c 6c 6f 2c 20 77  |Hello, w|');
    expect(hexDump(text, 32).split('\n')[0]).toBe(
      '00000000  48 65 6c 6c 6f 2c 20 77  6f 72 6c 64 21 20 30 31  32 33 34 35 36 37 38 39  00 ff' +
        '                    |Hello, world! 0123456789..|',
    );
    expect(hexDump(new Uint8Array(40), 16, 20)).toContain('… showing the first 20 B of 40 B');
  });

  it('runs Hex dump on any kind', async () => {
    const out = await run(
      bytes,
      'binary',
      'any.hexDump',
      { bytesPerRow: '8' },
      'application/octet-stream',
    );
    expect(out.text).toBe(
      '00000000  00 01 ff 48 69 0a 7f 80  |...Hi...|\n00000008  20                       | |\n00000009\n',
    );
  });

  it('encodes binary as base64', async () => {
    const b64 = async (params: unknown, input: Uint8Array<ArrayBuffer> = bytes) =>
      (await run(input, 'binary', 'binary.toBase64', params, 'application/octet-stream')).text;
    expect(await b64({})).toBe(toBase64(bytes));
    expect(await b64({ alphabet: 'url' })).toBe(
      toBase64(bytes).replace(/\//g, '_').replace(/\+/g, '-'),
    );
    const big = new Uint8Array(100).map((_, i) => (i * 7) & 0xff);
    big[0] = 0;
    const wrapped = await b64({ wrap: true }, big);
    expect(wrapped.split('\n')[0]).toHaveLength(76);
    expect(wrapped.replace(/\n/g, '')).toBe(toBase64(big));
  });

  it('opens bytes as text in a chosen encoding', async () => {
    const latin1 = new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x00, 0x80]); // "café\0€" in 1252
    const open = async (input: Uint8Array<ArrayBuffer>, encoding: string) =>
      (await run(input, 'binary', 'any.openAsText', { encoding }, 'application/octet-stream')).text;
    expect(await open(latin1, 'latin1')).toBe('café\u0000€');
    expect(await open(latin1, 'utf-8')).toBe('caf�\u0000�');
    const utf16 = new Uint8Array([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00, 0x00, 0x00]);
    expect(await open(utf16, 'utf-16le')).toBe('hi\u0000');
    expect(await open(new Uint8Array([0x00, 0x68, 0x00, 0x69]), 'utf-16be')).toBe('hi');
  });

  it('offers Open as text only for entries that are not already text', async () => {
    expect(await (await engineWith('plain text')).actions('en-1', 'text')).not.toContain(
      'any.openAsText',
    );
    const bin = await engineWith(bytes, 'application/octet-stream');
    expect(await bin.actions('en-1', 'binary')).toContain('any.openAsText');
  });
});

// --- PEM ---------------------------------------------------------------------------------------

describe('PEM actions', () => {
  it('fingerprints certificates as colon-separated uppercase hex', async () => {
    const pem = await selfSigned('fp.example', 30);
    const der = new Uint8Array(PemConverter.decodeFirst(pem));
    const hex = (buf: ArrayBuffer) =>
      [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(':');
    const sha256 = hex(await crypto.subtle.digest('SHA-256', der));
    const sha1 = hex(await crypto.subtle.digest('SHA-1', der));
    expect((await run(pem, 'pem', 'pem.fingerprint')).text).toBe(`${sha256}\n`);
    expect((await run(pem, 'pem', 'pem.fingerprint', { algorithm: 'SHA-1' })).text).toBe(
      `${sha1}\n`,
    );
    expect((await run(pem, 'pem', 'pem.fingerprint', { algorithm: 'both' })).text).toBe(
      `CN=fp.example, O=Clipbox Test\nSHA-256  ${sha256}\nSHA-1    ${sha1}\n`,
    );
  });

  it('fingerprints each certificate of a chain under its subject', async () => {
    const out = (await run(await chain(), 'pem', 'pem.fingerprint')).text;
    expect(out).toMatch(
      /^CN=Test Root CA\nSHA-256 {2}([0-9A-F]{2}:){31}[0-9A-F]{2}\n\nCN=leaf\.example\n/,
    );
  });

  it('gives certificate details as JSON', async () => {
    const out = await run(
      await selfSigned('details.example', 10, ['details.example']),
      'pem',
      'pem.details',
    );
    expect(out.mime).toBe('application/json');
    const d: unknown = JSON.parse(out.text);
    expect(d).toMatchObject({
      subject: 'CN=details.example, O=Clipbox Test',
      serialNumber: '0a1b2c',
      daysRemaining: 10,
      expired: false,
      selfSigned: true,
      signatureAlgorithm: 'SHA-256 with RSA',
      publicKey: { algorithm: 'RSA 2048-bit' },
      subjectAltNames: ['DNS:details.example'],
      basicConstraints: { ca: false },
    });
    expect(JSON.stringify(d)).toMatch(/"sha1":"([0-9A-F]{2}:){19}[0-9A-F]{2}"/);

    const both = JSON.parse((await run(await chain(), 'pem', 'pem.details')).text);
    expect(Array.isArray(both) && both.map((c: { subject: string }) => c.subject)).toEqual([
      'CN=leaf.example',
      'CN=Test Root CA',
    ]);
  });

  it('extracts the public key as SPKI PEM', async () => {
    const out = (await run(await chain(), 'pem', 'pem.publicKey')).text;
    expect(out.match(/-----BEGIN PUBLIC KEY-----/g)).toHaveLength(1);
    const der = PemConverter.decodeFirst(out);
    const key = await crypto.subtle.importKey(
      'spki',
      der,
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['verify'],
    );
    expect(key.type).toBe('public');
    const all = (await run(await chain(), 'pem', 'pem.publicKey', { all: true })).text;
    expect(all.match(/-----BEGIN PUBLIC KEY-----/g)).toHaveLength(2);

    const { csrPem, publicPem } = await ecKeys();
    const fromCsr = (await run(csrPem, 'pem', 'pem.publicKey')).text;
    expect(fromCsr.replace(/\s+/g, '')).toBe(publicPem.replace(/\s+/g, ''));
  });

  it('offers certificate actions only when there is a certificate', async () => {
    const { publicPem } = await ecKeys();
    const engine = await engineWith(publicPem);
    await engine.resolve('en-1', 'pem');
    const ids = await engine.actions('en-1', 'pem');
    expect(ids).toContain('pem.publicKey');
    expect(ids).not.toContain('pem.fingerprint');
    expect(ids).not.toContain('pem.details');
  });
});
