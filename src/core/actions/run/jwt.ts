import { z } from 'zod';
import { decodeBase64 } from '../../base64';
import { ecdsaDerToRaw, spkiFromCertificate } from '../../der';
import { isRecord } from '../../guards';
import { claimTime, jwtInterpreter, type JwtValue } from '../../interpreters/jwt';
import { formatDuration, isoUtc } from '../../time';
import { jwtVerify } from '../catalog/jwt';
import { implement } from '../types';
import { textResult } from './util';

// Keys stay inside this file: never logged, never in errors, labels or results.

type Family = 'HMAC' | 'RSASSA-PKCS1-v1_5' | 'RSA-PSS' | 'ECDSA' | 'Ed25519';

interface Scheme {
  family: Family;
  hash?: 'SHA-256' | 'SHA-384' | 'SHA-512';
  /** ECDSA curve and the byte size of r and s. */
  curve?: { name: 'P-256' | 'P-384' | 'P-521'; size: number };
}

const HASHES = { '256': 'SHA-256', '384': 'SHA-384', '512': 'SHA-512' } as const;
const CURVES = {
  '256': { name: 'P-256', size: 32 },
  '384': { name: 'P-384', size: 48 },
  '512': { name: 'P-521', size: 66 },
} as const;

export function jwtScheme(alg: string): Scheme {
  if (alg === 'none') throw new Error('Unsecured token (alg "none"): there is no signature');
  if (alg === 'EdDSA' || alg === 'Ed25519') return { family: 'Ed25519' };
  const m = /^(HS|RS|PS|ES)(256|384|512)$/.exec(alg);
  const bits = m?.[2];
  if (!m || (bits !== '256' && bits !== '384' && bits !== '512')) {
    throw new Error(`Unsupported algorithm "${alg}"`);
  }
  const hash = HASHES[bits];
  switch (m[1]) {
    case 'HS':
      return { family: 'HMAC', hash };
    case 'RS':
      return { family: 'RSASSA-PKCS1-v1_5', hash };
    case 'PS':
      return { family: 'RSA-PSS', hash };
    default:
      return { family: 'ECDSA', hash, curve: CURVES[bits] };
  }
}

const importParams = (
  s: Scheme,
): RsaHashedImportParams | EcKeyImportParams | HmacImportParams | Algorithm => {
  switch (s.family) {
    case 'HMAC':
    case 'RSASSA-PKCS1-v1_5':
    case 'RSA-PSS':
      return { name: s.family, hash: s.hash ?? 'SHA-256' };
    case 'ECDSA':
      return { name: 'ECDSA', namedCurve: s.curve?.name ?? 'P-256' };
    case 'Ed25519':
      return { name: 'Ed25519' };
  }
};

const verifyParams = (s: Scheme): AlgorithmIdentifier | RsaPssParams | EcdsaParams => {
  switch (s.family) {
    case 'RSA-PSS':
      // RFC 7518: the salt is as long as the hash
      return { name: 'RSA-PSS', saltLength: Number(s.hash?.slice(4) ?? 256) / 8 };
    case 'ECDSA':
      return { name: 'ECDSA', hash: s.hash ?? 'SHA-256' };
    default:
      return { name: s.family };
  }
};

const jwkSchema = z.looseObject({
  kty: z.string(),
  kid: z.string().optional(),
  alg: z.string().optional(),
  use: z.string().optional(),
});
const jwksSchema = z.object({ keys: z.array(z.unknown()) });

type Jwk = z.infer<typeof jwkSchema>;

/** Only a JWK's public members (and `k` for HMAC), so a private JWK still imports for verify. */
const PUBLIC_MEMBERS = ['kty', 'n', 'e', 'crv', 'x', 'y', 'k'];

function pickJwk(text: string, kid: unknown): Jwk {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("The key looks like JSON but isn't valid JSON");
  }
  const set = jwksSchema.safeParse(json);
  const candidates = (set.success ? set.data.keys : [json]).flatMap(k => {
    const parsed = jwkSchema.safeParse(k);
    return parsed.success ? [parsed.data] : [];
  });
  if (candidates.length === 0) throw new Error('The key JSON is not a JWK or JWK set');
  const byKid = typeof kid === 'string' ? candidates.find(k => k.kid === kid) : undefined;
  if (byKid) return byKid;
  const [only] = candidates;
  if (candidates.length === 1 && only) return only;
  throw new Error(
    typeof kid === 'string'
      ? `No key in the JWK set has kid "${kid}"`
      : 'The JWK set has several keys and the token has no kid',
  );
}

const PEM = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/;

interface Imported {
  key: CryptoKey;
  /** What was used, for the report; never the key material itself. */
  describe: string;
}

async function importKey(
  keyText: string,
  base64Secret: boolean,
  alg: string,
  scheme: Scheme,
  kid: unknown,
): Promise<Imported> {
  const text = keyText.trim();
  if (text === '') throw new Error('Enter the key to verify with');
  const params = importParams(scheme);
  const fail =
    (what: string) =>
    (err: unknown): never => {
      const reason = err instanceof Error && err.name ? err.name : 'error';
      throw new Error(`The ${what} can't be used for ${alg} (${reason})`, { cause: err });
    };

  if (text.startsWith('{')) {
    const jwk = pickJwk(text, kid);
    if (jwk.alg !== undefined && jwk.alg !== alg) {
      throw new Error(`The JWK is for ${jwk.alg}, but the token uses ${alg}`);
    }
    const publicJwk: JsonWebKey = Object.fromEntries(
      Object.entries(jwk).filter(([k]) => PUBLIC_MEMBERS.includes(k)),
    );
    const key = await crypto.subtle
      .importKey('jwk', publicJwk, params, false, ['verify'])
      .catch(fail('JWK'));
    return { key, describe: jwk.kid ? `JWK (kid ${jwk.kid})` : 'JWK' };
  }

  const pem = PEM.exec(text);
  if (scheme.family === 'HMAC') {
    // Refusing PEM here also blocks the RS → HS algorithm-confusion trick
    if (pem) throw new Error(`${alg} needs the shared secret, not a PEM key`);
    const bytes = base64Secret
      ? decodeBase64(text.replace(/\s+/g, ''))
      : new TextEncoder().encode(text);
    if (!bytes) throw new Error("The secret isn't valid base64");
    if (bytes.length === 0) throw new Error('Enter the key to verify with');
    const key = await crypto.subtle
      .importKey('raw', bytes, params, false, ['verify'])
      .catch(fail('secret'));
    return { key, describe: base64Secret ? 'HMAC secret (base64)' : 'HMAC secret' };
  }

  if (!pem) throw new Error(`${alg} needs a public key: PEM, certificate or JWK`);
  const [, label = '', body = ''] = pem;
  const der = decodeBase64(body.replace(/\s+/g, ''));
  if (!der) throw new Error("The PEM key isn't valid base64");
  if (/PRIVATE/.test(label))
    throw new Error('Paste the public key or certificate, not a private key');
  let spki: Uint8Array<ArrayBuffer>;
  let describe: string;
  if (label === 'PUBLIC KEY') {
    spki = der;
    describe = 'PEM public key';
  } else if (label === 'CERTIFICATE') {
    spki = spkiFromCertificate(der);
    describe = "certificate's public key";
  } else if (label === 'RSA PUBLIC KEY') {
    throw new Error('PKCS#1 "RSA PUBLIC KEY" isn\'t supported: use a "PUBLIC KEY" (SPKI) PEM');
  } else {
    throw new Error(`Unsupported PEM block "${label}"`);
  }
  const key = await crypto.subtle
    .importKey('spki', spki, params, false, ['verify'])
    .catch(fail('public key'));
  return { key, describe };
}

function signatureBytes(signature: string, scheme: Scheme): Uint8Array<ArrayBuffer> {
  const sig = decodeBase64(signature);
  if (!sig || sig.length === 0) throw new Error('The token has no signature');
  const size = scheme.curve?.size;
  // JOSE uses raw r‖s, as WebCrypto does; accept DER from non-conforming signers too
  if (size !== undefined && sig.length !== size * 2 && sig[0] === 0x30) {
    try {
      return ecdsaDerToRaw(sig, size);
    } catch {
      return sig;
    }
  }
  return sig;
}

interface ClaimCheck {
  claim: 'exp' | 'nbf' | 'iat';
  at: number;
  ok: boolean;
  note: string;
}

const ago = (ms: number) => `${formatDuration(ms, 'short')} ago`;
const until = (ms: number) => `in ${formatDuration(ms, 'short')}`;
const when = (at: number, now: number) => (at >= now ? until(at - now) : ago(now - at));

export function checkClaims(
  payload: Record<string, unknown>,
  now: number,
  skewMs: number,
): ClaimCheck[] {
  const out: ClaimCheck[] = [];
  const exp = claimTime(payload, 'exp');
  if (exp !== null) {
    const ok = now < exp + skewMs;
    out.push({
      claim: 'exp',
      at: exp,
      ok,
      note: ok ? `expires ${until(exp - now)}` : `expired ${ago(now - exp)}`,
    });
  }
  const nbf = claimTime(payload, 'nbf');
  if (nbf !== null) {
    const ok = now + skewMs >= nbf;
    out.push({
      claim: 'nbf',
      at: nbf,
      ok,
      note: ok ? 'valid' : `not valid until ${until(nbf - now)}`,
    });
  }
  const iat = claimTime(payload, 'iat');
  if (iat !== null) {
    const ok = iat <= now + skewMs;
    out.push({
      claim: 'iat',
      at: iat,
      ok,
      note: ok ? `issued ${when(iat, now)}` : `issued in the future (${until(iat - now)})`,
    });
  }
  return out;
}

/** Signature result and time claims as a short text report. */
export async function verifyJwt(
  v: JwtValue,
  keyText: string,
  base64Secret: boolean,
  skewSeconds: number,
  now = Date.now(),
): Promise<string> {
  const alg = typeof v.header.alg === 'string' ? v.header.alg : '';
  const scheme = jwtScheme(alg);
  const { key, describe } = await importKey(keyText, base64Secret, alg, scheme, v.header.kid);
  const [header = '', payload = ''] = v.raw.split('.');
  const data = new TextEncoder().encode(`${header}.${payload}`);
  const valid = await crypto.subtle.verify(
    verifyParams(scheme),
    key,
    signatureBytes(v.signature, scheme),
    data,
  );

  const checks = checkClaims(v.payload, now, skewSeconds * 1000);
  const failed = checks.filter(c => !c.ok);
  const exp = checks.find(c => c.claim === 'exp');
  const timing = failed.length
    ? failed.map(c => c.note.toUpperCase()).join(' · ')
    : exp
      ? exp.note
      : 'no expiry';
  const headline = valid
    ? `Signature valid (${alg}) · ${timing}`
    : `INVALID signature (${alg}) · ${timing}`;
  const verdict = !valid
    ? 'Do not trust this token: the signature does not match the key.'
    : failed.length
      ? 'The signature is genuine, but the token is not currently valid.'
      : 'The token is valid.';
  const lines = [
    headline,
    '',
    verdict,
    '',
    `Algorithm:  ${alg}`,
    `Key:        ${describe}`,
    `Signature:  ${valid ? 'valid' : 'INVALID'}`,
    ...checks.map(
      c => `${`${c.claim}:`.padEnd(12)}${isoUtc(c.at)} · ${c.ok ? 'ok' : 'FAIL'} · ${c.note}`,
    ),
    `Clock skew: ${skewSeconds}s · checked at ${isoUtc(now)}`,
  ];
  return `${lines.join('\n')}\n`;
}

export const jwtImpls = [
  implement(jwtVerify, {
    value: jwtInterpreter.isValue,
    applies: ({ value }) => isRecord(value.header) && value.header.alg !== 'none',
    run: async ({ value }, { key, secretIsBase64, clockSkew }) =>
      textResult(await verifyJwt(value, key, secretIsBase64, clockSkew)),
  }),
];
