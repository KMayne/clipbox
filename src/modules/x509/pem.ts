// tsyringe (used by @peculiar/x509) needs a Reflect polyfill before the library is evaluated
import 'reflect-metadata';
import {
  BasicConstraintsExtension,
  Pkcs10CertificateRequest,
  PublicKey,
  SubjectAlternativeNameExtension,
  X509Certificate,
} from '@peculiar/x509';
import { formatCount } from '../../core/format';
import { hasKind, isRecord } from '../../core/guards';
import { unsupportedSlice, type Interpreter } from '../../core/interpreter';
import type { StatRow } from '../../core/types';
import { describePrivateKey } from './privateKey';
import {
  commonName,
  daysUntil,
  expiryText,
  type CertificateInfo,
  type PemBlockInfo,
} from './types';

export interface PemValue {
  kind: 'pem';
  /** Certificates first, in chain order (leaf → root), then everything else in paste order. */
  blocks: PemBlockInfo[];
  /** Re-encoded PEM of every non-private block, for Copy. */
  publicPem: string;
}

const SAN_OID = '2.5.29.17';
const BLOCK = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/g;

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64.replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** e.g. "RSA 2048-bit", "EC P-256", "Ed25519". */
export function describeKeyAlgorithm(alg: unknown): string {
  if (!isRecord(alg) || typeof alg.name !== 'string') return 'unknown';
  if (typeof alg.modulusLength === 'number') {
    const family = alg.name === 'RSA-PSS' ? 'RSA-PSS' : 'RSA';
    return `${family} ${alg.modulusLength}-bit`;
  }
  if (typeof alg.namedCurve === 'string') return `EC ${alg.namedCurve}`;
  return alg.name;
}

/** e.g. "SHA-256 with RSA", "ECDSA with SHA-384", "Ed25519". */
export function describeSignature(alg: unknown): string {
  if (!isRecord(alg) || typeof alg.name !== 'string') return 'unknown';
  const hash = isRecord(alg.hash) && typeof alg.hash.name === 'string' ? alg.hash.name : null;
  if (!hash) return alg.name;
  if (alg.name.startsWith('RSASSA-PKCS1')) return `${hash} with RSA`;
  if (alg.name === 'RSA-PSS') return `${hash} with RSA-PSS`;
  return `${alg.name} with ${hash}`;
}

const hexColons = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(':');

const sansOf = (ext: SubjectAlternativeNameExtension | null) =>
  ext ? ext.names.items.map(n => `${n.type.toUpperCase()}:${n.value}`) : [];

async function certificateInfo(cert: X509Certificate): Promise<CertificateInfo> {
  return {
    type: 'certificate',
    subject: cert.subject,
    issuer: cert.issuer,
    serial: cert.serialNumber,
    notBefore: cert.notBefore.toISOString(),
    notAfter: cert.notAfter.toISOString(),
    sans: sansOf(cert.getExtension(SubjectAlternativeNameExtension)),
    publicKey: describeKeyAlgorithm(cert.publicKey.algorithm),
    signature: describeSignature(cert.signatureAlgorithm),
    sha256: hexColons(await cert.getThumbprint('SHA-256')),
    isCA: cert.getExtension(BasicConstraintsExtension)?.ca ?? false,
    selfSigned: cert.subject === cert.issuer,
  };
}

/** Orders certificates leaf first, following issuer → subject links; leftovers keep paste order. */
export function chainOrder<T extends { subject: string; issuer: string }>(certs: T[]): T[] {
  const issues = (a: T, b: T) => a !== b && a.subject === b.issuer;
  const leaves = certs.filter(c => !certs.some(other => issues(c, other)));
  const out: T[] = [];
  for (const leaf of leaves.length > 0 ? leaves : certs.slice(0, 1)) {
    for (let cur: T | undefined = leaf; cur && !out.includes(cur);) {
      out.push(cur);
      const current: T = cur;
      cur = certs.find(c => issues(c, current) && !out.includes(c));
    }
  }
  return [...out, ...certs.filter(c => !out.includes(c))];
}

async function parseBlock(
  label: string,
  body: string,
): Promise<{ info: PemBlockInfo; pem: string | null }> {
  const der = base64ToBytes(body);
  const pem = `-----BEGIN ${label}-----\n${(body.replace(/\s+/g, '').match(/.{1,64}/g) ?? []).join('\n')}\n-----END ${label}-----`;
  switch (label) {
    case 'CERTIFICATE':
      return { info: await certificateInfo(new X509Certificate(der)), pem };
    case 'CERTIFICATE REQUEST':
    case 'NEW CERTIFICATE REQUEST': {
      const csr = new Pkcs10CertificateRequest(der);
      const san = csr.getExtension(SAN_OID);
      return {
        info: {
          type: 'csr',
          subject: csr.subject,
          sans: sansOf(san instanceof SubjectAlternativeNameExtension ? san : null),
          publicKey: describeKeyAlgorithm(csr.publicKey.algorithm),
          signature: describeSignature(csr.signatureAlgorithm),
        },
        pem,
      };
    }
    case 'PUBLIC KEY':
      return {
        info: { type: 'public-key', publicKey: describeKeyAlgorithm(new PublicKey(der).algorithm) },
        pem,
      };
    case 'PRIVATE KEY':
    case 'RSA PRIVATE KEY':
    case 'EC PRIVATE KEY':
      return { info: { type: 'private-key', ...describePrivateKey(label, der) }, pem: null };
    default:
      return {
        info: { type: 'unknown', label, error: 'Unsupported block type' },
        pem: /PRIVATE/.test(label) ? null : pem,
      };
  }
}

export async function parsePem(text: string): Promise<PemValue> {
  const parsed: { info: PemBlockInfo; pem: string | null }[] = [];
  for (const m of text.matchAll(BLOCK)) {
    const [, label = '', body = ''] = m;
    try {
      parsed.push(await parseBlock(label, body));
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      parsed.push({ info: { type: 'unknown', label, error }, pem: null });
    }
  }
  if (parsed.length === 0) throw new Error('No PEM blocks found');
  const certs = chainOrder(
    parsed.flatMap(p => (p.info.type === 'certificate' ? [{ ...p, ...p.info }] : [])),
  );
  const rest = parsed.filter(p => p.info.type !== 'certificate');
  const ordered = [...certs, ...rest];
  return {
    kind: 'pem',
    blocks: ordered.map(p => p.info),
    publicPem: ordered.flatMap(p => (p.pem ? [p.pem] : [])).join('\n'),
  };
}

const NOUNS: Record<PemBlockInfo['type'], [string, string]> = {
  certificate: ['certificate', 'certificates'],
  csr: ['CSR', 'CSRs'],
  'public-key': ['public key', 'public keys'],
  'private-key': ['private key', 'private keys'],
  unknown: ['unknown block', 'unknown blocks'],
};

function contents(blocks: PemBlockInfo[]): string {
  const counts = new Map<PemBlockInfo['type'], number>();
  for (const b of blocks) counts.set(b.type, (counts.get(b.type) ?? 0) + 1);
  return [...counts]
    .map(([type, n]) => (n === 1 ? NOUNS[type][0] : `${n} ${NOUNS[type][1]}`))
    .join(' + ');
}

export function pemLabel(v: PemValue, now = Date.now()): string {
  const parts = ['PEM', contents(v.blocks)];
  const first = v.blocks.find(b => b.type === 'certificate' || b.type === 'csr');
  if (first?.type === 'certificate' || first?.type === 'csr') parts.push(commonName(first.subject));
  if (first?.type === 'certificate') parts.push(expiryText(first.notAfter, now));
  const key = v.blocks.find(b => b.type === 'private-key' || b.type === 'public-key');
  if (!first && key && (key.type === 'private-key' || key.type === 'public-key')) {
    parts.push(key.type === 'private-key' ? key.key : key.publicKey);
  }
  return parts.join(' · ');
}

function blockStats(b: PemBlockInfo, now: number): StatRow[] {
  switch (b.type) {
    case 'certificate':
      return [
        { label: 'Subject', value: b.subject },
        { label: 'Issuer', value: b.issuer },
        { label: 'Serial', value: b.serial },
        { label: 'Not before', value: b.notBefore },
        { label: 'Not after', value: b.notAfter },
        { label: 'Days remaining', value: String(daysUntil(b.notAfter, now)) },
        {
          label: 'SANs',
          value: formatCount(b.sans.length),
          children: b.sans.map((s, i) => ({ label: String(i + 1), value: s })),
        },
        { label: 'Public key', value: b.publicKey },
        { label: 'Signature', value: b.signature },
        { label: 'SHA-256', value: b.sha256 },
        { label: 'CA', value: b.isCA ? 'yes' : 'no' },
        { label: 'Self-signed', value: b.selfSigned ? 'yes' : 'no' },
      ];
    case 'csr':
      return [
        { label: 'Subject', value: b.subject },
        { label: 'SANs', value: b.sans.join(', ') || '(none)' },
        { label: 'Public key', value: b.publicKey },
        { label: 'Signature', value: b.signature },
      ];
    case 'public-key':
      return [{ label: 'Algorithm', value: b.publicKey }];
    case 'private-key':
      return [
        { label: 'Format', value: b.format },
        { label: 'Algorithm', value: b.key },
      ];
    case 'unknown':
      return [{ label: 'Error', value: b.error }];
  }
}

function blockTitle(b: PemBlockInfo): string {
  switch (b.type) {
    case 'certificate':
    case 'csr':
      return commonName(b.subject);
    case 'public-key':
      return b.publicKey;
    case 'private-key':
      return b.key;
    case 'unknown':
      return b.label;
  }
}

export const pemInterpreter: Interpreter<PemValue> = {
  kind: 'pem',
  isValue: (v): v is PemValue => hasKind(v, 'pem'),
  // Real detection is the cheap core detector in ./detect.ts; this runs only once loaded
  detect: c => (c.text !== null && /-----BEGIN [A-Z ]+-----/.test(c.text) ? 0.95 : 0),
  parse(c) {
    if (c.text === null) throw new Error('Not text');
    return parsePem(c.text);
  },
  label: v => pemLabel(v),
  summarise(v) {
    const now = Date.now();
    const counts = new Map<string, number>();
    return {
      stats: [
        { label: 'Blocks', value: formatCount(v.blocks.length) },
        {
          label: 'Contains private key',
          value: v.blocks.some(b => b.type === 'private-key') ? 'yes' : 'no',
        },
        ...v.blocks.map((b): StatRow => {
          const n = (counts.get(b.type) ?? 0) + 1;
          counts.set(b.type, n);
          const noun = NOUNS[b.type][0];
          return {
            label: `${noun.charAt(0).toUpperCase()}${noun.slice(1)} ${n}`,
            value: blockTitle(b),
            children: blockStats(b, now),
          };
        }),
      ],
      extent: v.blocks.length,
    };
  },
  slice(v, req) {
    if (req.type === 'json') return { blocks: v.blocks };
    return unsupportedSlice('pem', req);
  },
  export: v => ({ text: v.publicPem || v.blocks.map(blockTitle).join('\n') }),
};
