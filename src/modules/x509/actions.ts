// tsyringe (used by @peculiar/x509) needs a Reflect polyfill before the library is evaluated
import 'reflect-metadata';
import {
  AuthorityKeyIdentifierExtension,
  BasicConstraintsExtension,
  ExtendedKeyUsageExtension,
  KeyUsagesExtension,
  Pkcs10CertificateRequest,
  PublicKey,
  SubjectAlternativeNameExtension,
  SubjectKeyIdentifierExtension,
  X509Certificate,
} from '@peculiar/x509';
import { chainOrder, describeKeyAlgorithm, describeSignature } from './pem';
import { daysUntil, type X509ActionService } from './types';

const BLOCK = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/g;

const hexColons = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(':');

const KEY_USAGES = [
  'digitalSignature',
  'nonRepudiation',
  'keyEncipherment',
  'dataEncipherment',
  'keyAgreement',
  'keyCertSign',
  'cRLSign',
  'encipherOnly',
  'decipherOnly',
];

const EKU_NAMES: Record<string, string> = {
  '1.3.6.1.5.5.7.3.1': 'serverAuth',
  '1.3.6.1.5.5.7.3.2': 'clientAuth',
  '1.3.6.1.5.5.7.3.3': 'codeSigning',
  '1.3.6.1.5.5.7.3.4': 'emailProtection',
  '1.3.6.1.5.5.7.3.8': 'timeStamping',
  '1.3.6.1.5.5.7.3.9': 'OCSPSigning',
  '2.5.29.37.0': 'anyExtendedKeyUsage',
};

const EXTENSION_NAMES: Record<string, string> = {
  '2.5.29.14': 'subjectKeyIdentifier',
  '2.5.29.15': 'keyUsage',
  '2.5.29.17': 'subjectAltName',
  '2.5.29.19': 'basicConstraints',
  '2.5.29.31': 'cRLDistributionPoints',
  '2.5.29.32': 'certificatePolicies',
  '2.5.29.35': 'authorityKeyIdentifier',
  '2.5.29.37': 'extendedKeyUsage',
  '1.3.6.1.5.5.7.1.1': 'authorityInfoAccess',
  '1.3.6.1.4.1.11129.2.4.2': 'signedCertificateTimestampList',
};

function blocks(text: string): { label: string; der: Uint8Array<ArrayBuffer> }[] {
  return [...text.matchAll(BLOCK)].map(([, label = '', body = '']) => {
    const bin = atob(body.replace(/\s+/g, ''));
    return { label, der: Uint8Array.from(bin, c => c.charCodeAt(0)) };
  });
}

/** Certificates in chain order (leaf first), as `pem.ts` orders them. */
function certificates(text: string): X509Certificate[] {
  const certs = blocks(text)
    .filter(b => b.label === 'CERTIFICATE')
    .map(b => new X509Certificate(b.der));
  return chainOrder(certs);
}

async function details(cert: X509Certificate, now: number): Promise<Record<string, unknown>> {
  const exts = cert.extensions;
  const san = exts.find(e => e instanceof SubjectAlternativeNameExtension);
  const basic = exts.find(e => e instanceof BasicConstraintsExtension);
  const ku = exts.find(e => e instanceof KeyUsagesExtension);
  const eku = exts.find(e => e instanceof ExtendedKeyUsageExtension);
  const ski = exts.find(e => e instanceof SubjectKeyIdentifierExtension);
  const aki = exts.find(e => e instanceof AuthorityKeyIdentifierExtension);
  const notAfter = cert.notAfter.toISOString();
  return {
    subject: cert.subject,
    issuer: cert.issuer,
    serialNumber: cert.serialNumber,
    notBefore: cert.notBefore.toISOString(),
    notAfter,
    daysRemaining: daysUntil(notAfter, now),
    expired: cert.notAfter.getTime() <= now,
    selfSigned: cert.subject === cert.issuer,
    signatureAlgorithm: describeSignature(cert.signatureAlgorithm),
    publicKey: {
      algorithm: describeKeyAlgorithm(cert.publicKey.algorithm),
      sha256: hexColons(await cert.publicKey.getThumbprint('SHA-256')),
    },
    subjectAltNames: san ? san.names.items.map(n => `${n.type.toUpperCase()}:${n.value}`) : [],
    basicConstraints: basic
      ? { ca: basic.ca, ...(basic.pathLength !== undefined && { pathLength: basic.pathLength }) }
      : null,
    keyUsage: ku ? KEY_USAGES.filter((_, i) => (ku.usages & (1 << i)) !== 0) : [],
    extendedKeyUsage: eku ? eku.usages.map(u => EKU_NAMES[String(u)] ?? String(u)) : [],
    subjectKeyIdentifier: ski?.keyId.toUpperCase() ?? null,
    authorityKeyIdentifier: aki?.keyId?.toUpperCase() ?? null,
    extensions: cert.extensions.map(e => ({
      oid: e.type,
      ...(EXTENSION_NAMES[e.type] !== undefined && { name: EXTENSION_NAMES[e.type] }),
      critical: e.critical,
    })),
    fingerprints: {
      sha256: hexColons(await cert.getThumbprint('SHA-256')),
      sha1: hexColons(await cert.getThumbprint('SHA-1')),
    },
  };
}

/** Used by the core PEM actions through `ctx.service('x509', isX509ActionService)`. */
export const x509ActionService: X509ActionService = {
  async certificateDetails(text, now = Date.now()) {
    return Promise.all(certificates(text).map(c => details(c, now)));
  },
  publicKeys(text) {
    const certs = certificates(text).map(c => ({
      source: c.subject,
      pem: c.publicKey.toString('pem'),
    }));
    const others = blocks(text).flatMap(b => {
      if (b.label === 'CERTIFICATE REQUEST' || b.label === 'NEW CERTIFICATE REQUEST') {
        const csr = new Pkcs10CertificateRequest(b.der);
        return [{ source: `CSR ${csr.subject}`, pem: csr.publicKey.toString('pem') }];
      }
      if (b.label === 'PUBLIC KEY') {
        return [{ source: 'public key', pem: new PublicKey(b.der).toString('pem') }];
      }
      return [];
    });
    return Promise.resolve([...certs, ...others]);
  },
};
