import 'reflect-metadata';
import {
  BasicConstraintsExtension,
  PemConverter,
  Pkcs10CertificateRequestGenerator,
  SubjectAlternativeNameExtension,
  X509CertificateGenerator,
} from '@peculiar/x509';

/** Test certificates generated on the fly, so expiry-relative assertions never go stale. */

const DAY = 86_400_000;
const RSA = {
  name: 'RSASSA-PKCS1-v1_5',
  hash: 'SHA-256',
  publicExponent: new Uint8Array([1, 0, 1]),
  modulusLength: 2048,
};
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' };

export async function selfSigned(cn: string, days: number, sans: string[] = []): Promise<string> {
  const keys = await crypto.subtle.generateKey(RSA, true, ['sign', 'verify']);
  const cert = await X509CertificateGenerator.createSelfSigned({
    serialNumber: '0a1b2c',
    name: `CN=${cn}, O=Clipbox Test`,
    notBefore: new Date(Date.now() - DAY),
    notAfter: new Date(Date.now() + days * DAY),
    signingAlgorithm: RSA,
    keys,
    extensions: [
      new BasicConstraintsExtension(false),
      new SubjectAlternativeNameExtension(sans.map(value => ({ type: 'dns' as const, value }))),
    ],
  });
  return cert.toString('pem');
}

/** CA + leaf, returned CA first (the reverse of chain order). */
export async function chain(): Promise<string> {
  const caKeys = await crypto.subtle.generateKey(ECDSA, true, ['sign', 'verify']);
  const leafKeys = await crypto.subtle.generateKey(ECDSA, true, ['sign', 'verify']);
  const ca = await X509CertificateGenerator.createSelfSigned({
    serialNumber: '01',
    name: 'CN=Test Root CA',
    notBefore: new Date(Date.now() - DAY),
    notAfter: new Date(Date.now() + 3650 * DAY),
    signingAlgorithm: ECDSA,
    keys: caKeys,
    extensions: [new BasicConstraintsExtension(true, undefined, true)],
  });
  const leaf = await X509CertificateGenerator.create({
    serialNumber: '02',
    subject: 'CN=leaf.example',
    issuer: ca.subject,
    notBefore: new Date(Date.now() - 400 * DAY),
    notAfter: new Date(Date.now() - 5 * DAY),
    signingAlgorithm: ECDSA,
    publicKey: leafKeys.publicKey,
    signingKey: caKeys.privateKey,
  });
  return `${ca.toString('pem')}\n${leaf.toString('pem')}`;
}

export async function rsaPrivateKeyPkcs8(): Promise<string> {
  const keys = await crypto.subtle.generateKey(RSA, true, ['sign', 'verify']);
  return PemConverter.encode(
    await crypto.subtle.exportKey('pkcs8', keys.privateKey),
    'PRIVATE KEY',
  );
}

export async function ecKeys(): Promise<{ privatePem: string; publicPem: string; csrPem: string }> {
  const keys = await crypto.subtle.generateKey(ECDSA, true, ['sign', 'verify']);
  const csr = await Pkcs10CertificateRequestGenerator.create({
    name: 'CN=csr.example',
    keys,
    signingAlgorithm: ECDSA,
    extensions: [new SubjectAlternativeNameExtension([{ type: 'dns', value: 'csr.example' }])],
  });
  return {
    privatePem: PemConverter.encode(
      await crypto.subtle.exportKey('pkcs8', keys.privateKey),
      'PRIVATE KEY',
    ),
    publicPem: PemConverter.encode(
      await crypto.subtle.exportKey('spki', keys.publicKey),
      'PUBLIC KEY',
    ),
    csrPem: csr.toString('pem'),
  };
}
