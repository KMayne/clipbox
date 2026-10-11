/**
 * Describes a private key (algorithm and size only) with a minimal DER reader, so no key
 * material is ever decoded into the value.
 */

interface Tlv {
  tag: number;
  /** Contents. */
  body: Uint8Array;
}

function readTlv(b: Uint8Array, at: number): { tlv: Tlv; next: number } {
  const tag = b[at];
  let len = b[at + 1];
  let pos = at + 2;
  if (tag === undefined || len === undefined) throw new Error('Truncated DER');
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4) throw new Error('Unsupported DER length');
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + (b[pos + i] ?? 0);
    pos += n;
  }
  if (pos + len > b.length) throw new Error('Truncated DER');
  return { tlv: { tag, body: b.subarray(pos, pos + len) }, next: pos + len };
}

function children(t: Tlv): Tlv[] {
  const out: Tlv[] = [];
  for (let at = 0; at < t.body.length;) {
    const { tlv, next } = readTlv(t.body, at);
    out.push(tlv);
    at = next;
  }
  return out;
}

const SEQUENCE = 0x30;
const INTEGER = 0x02;
const OID = 0x06;
const OCTET_STRING = 0x04;

function expect(t: Tlv | undefined, tag: number): Tlv {
  if (!t || t.tag !== tag) throw new Error('Unexpected DER structure');
  return t;
}

function oidString(body: Uint8Array): string {
  const parts: number[] = [];
  let v = 0;
  for (const byte of body) {
    v = v * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) {
      if (parts.length === 0) parts.push(v < 80 ? Math.floor(v / 40) : 2, v < 80 ? v % 40 : v - 80);
      else parts.push(v);
      v = 0;
    }
  }
  return parts.join('.');
}

/** Bit length of a positive DER INTEGER. */
function intBits(body: Uint8Array): number {
  let i = 0;
  while (i < body.length - 1 && body[i] === 0) i++;
  const first = body[i] ?? 0;
  return (body.length - i - 1) * 8 + (first === 0 ? 0 : Math.floor(Math.log2(first)) + 1);
}

const CURVES: Record<string, string> = {
  '1.2.840.10045.3.1.7': 'P-256',
  '1.3.132.0.34': 'P-384',
  '1.3.132.0.35': 'P-521',
  '1.3.132.0.10': 'secp256k1',
  '1.3.36.3.3.2.8.1.1.7': 'brainpoolP256r1',
};

const ALGORITHMS: Record<string, string> = {
  '1.3.101.110': 'X25519',
  '1.3.101.111': 'X448',
  '1.3.101.112': 'Ed25519',
  '1.3.101.113': 'Ed448',
  '1.2.840.10040.4.1': 'DSA',
};

const RSA = '1.2.840.113549.1.1.1';
const RSA_PSS = '1.2.840.113549.1.1.10';
const EC = '1.2.840.10045.2.1';

const curveName = (oid: string) => CURVES[oid] ?? `curve ${oid}`;

/** RSAPrivateKey (PKCS#1): SEQUENCE { version, modulus, … } */
function rsaKey(der: Uint8Array, name = 'RSA'): string {
  const [, modulus] = children(expect(readTlv(der, 0).tlv, SEQUENCE));
  return `${name} ${intBits(expect(modulus, INTEGER).body)}-bit`;
}

/** ECPrivateKey (SEC1): SEQUENCE { version, privateKey, [0] parameters, [1] publicKey } */
function ecKey(der: Uint8Array, fallbackCurve?: string): string {
  const params = children(expect(readTlv(der, 0).tlv, SEQUENCE)).find(t => t.tag === 0xa0);
  const oid = params ? children(params)[0] : undefined;
  const curve = oid?.tag === OID ? curveName(oidString(oid.body)) : fallbackCurve;
  return curve ? `EC ${curve}` : 'EC';
}

/** PrivateKeyInfo (PKCS#8): SEQUENCE { version, AlgorithmIdentifier, OCTET STRING key, … } */
function pkcs8Key(der: Uint8Array): string {
  const [, algId, key] = children(expect(readTlv(der, 0).tlv, SEQUENCE));
  const [oidTlv, params] = children(expect(algId, SEQUENCE));
  const oid = oidString(expect(oidTlv, OID).body);
  const inner = expect(key, OCTET_STRING).body;
  if (oid === RSA) return rsaKey(inner);
  if (oid === RSA_PSS) return rsaKey(inner, 'RSA-PSS');
  if (oid === EC) {
    const curve = params?.tag === OID ? curveName(oidString(params.body)) : undefined;
    return ecKey(inner, curve);
  }
  return ALGORITHMS[oid] ?? `algorithm ${oid}`;
}

export type PrivateKeyLabel = 'PRIVATE KEY' | 'RSA PRIVATE KEY' | 'EC PRIVATE KEY';

export function describePrivateKey(
  label: PrivateKeyLabel,
  der: Uint8Array,
): { format: string; key: string } {
  switch (label) {
    case 'PRIVATE KEY':
      return { format: 'PKCS#8', key: pkcs8Key(der) };
    case 'RSA PRIVATE KEY':
      return { format: 'PKCS#1', key: rsaKey(der) };
    case 'EC PRIVATE KEY':
      return { format: 'SEC1', key: ecKey(der) };
  }
}
