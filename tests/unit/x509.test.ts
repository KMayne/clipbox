import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { defined } from '../../src/core/guards';
import { register } from '../../src/core/interpreter';
import { Engine } from '../../src/engine/engine';
import { pemDetector } from '../../src/modules/x509/detect';
import { chainOrder, parsePem, pemLabel, pemInterpreter } from '../../src/modules/x509/pem';
import { chain, ecKeys, rsaPrivateKeyPkcs8, selfSigned } from '../fixtures/certs';
import { textContent } from './helpers';

const pem = register(pemInterpreter);
const stat = (stats: { label: string; value: string }[], label: string) =>
  stats.find(s => s.label === label)?.value;

describe('pem detector', () => {
  it('matches PEM armour only at line start', async () => {
    expect(pemDetector.detect(textContent(await selfSigned('a', 1)))).toBe(0.95);
    expect(pemDetector.detect(textContent('-----BEGIN EC PRIVATE KEY-----\nAAAA\n'))).toBe(0.95);
    expect(pemDetector.detect(textContent('say -----BEGIN CERTIFICATE----- here'))).toBe(0);
    expect(pemDetector.detect(textContent('-----BEGIN PGP MESSAGE-----'))).toBe(0);
  });
});

describe('pem interpreter', () => {
  it('decodes a self-signed certificate', async () => {
    const v = await parsePem(
      await selfSigned('example.com', 42, ['example.com', 'www.example.com']),
    );
    const [cert] = v.blocks;
    expect(cert).toMatchObject({
      type: 'certificate',
      subject: 'CN=example.com, O=Clipbox Test',
      issuer: 'CN=example.com, O=Clipbox Test',
      serial: '0a1b2c',
      sans: ['DNS:example.com', 'DNS:www.example.com'],
      publicKey: 'RSA 2048-bit',
      signature: 'SHA-256 with RSA',
      isCA: false,
      selfSigned: true,
    });
    expect(cert?.type === 'certificate' && cert.sha256).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    expect(pemLabel(v)).toBe('PEM · certificate · CN=example.com · expires in 42d');

    const s = await pem.summarise(v);
    expect(stat(s.stats, 'Contains private key')).toBe('no');
    const row = defined(s.stats.find(r => r.label === 'Certificate 1'));
    expect(stat(defined(row.children), 'Days remaining')).toBe('42');
  });

  it('orders a chain leaf first and reports expiry', async () => {
    const v = await parsePem(await chain());
    expect(v.blocks.map(b => b.type === 'certificate' && b.subject)).toEqual([
      'CN=leaf.example',
      'CN=Test Root CA',
    ]);
    expect(v.blocks[1]).toMatchObject({
      isCA: true,
      publicKey: 'EC P-256',
      signature: 'ECDSA with SHA-256',
    });
    expect(pemLabel(v)).toBe('PEM · 2 certificates · CN=leaf.example · expired 5d ago');
  });

  it('chainOrder follows issuer links and keeps strays', () => {
    const c = (subject: string, issuer: string) => ({ subject, issuer });
    const root = c('R', 'R');
    const mid = c('M', 'R');
    const leaf = c('L', 'M');
    const stray = c('X', 'Y');
    expect(chainOrder([root, stray, leaf, mid])).toEqual([stray, leaf, mid, root]);
  });

  it('describes CSRs, public keys and private keys without exposing key material', async () => {
    const ec = await ecKeys();
    const rsa1 = generateKeyPairSync('rsa', {
      modulusLength: 3072,
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    }).privateKey;
    const sec1 = generateKeyPairSync('ec', {
      namedCurve: 'P-384',
      privateKeyEncoding: { type: 'sec1', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    }).privateKey;
    const text = [
      ec.csrPem,
      ec.publicPem,
      ec.privatePem,
      await rsaPrivateKeyPkcs8(),
      rsa1,
      sec1,
    ].join('\n');
    const v = await parsePem(text);
    expect(v.blocks).toEqual([
      {
        type: 'csr',
        subject: 'CN=csr.example',
        sans: ['DNS:csr.example'],
        publicKey: 'EC P-256',
        signature: 'ECDSA with SHA-256',
      },
      { type: 'public-key', publicKey: 'EC P-256' },
      { type: 'private-key', format: 'PKCS#8', key: 'EC P-256' },
      { type: 'private-key', format: 'PKCS#8', key: 'RSA 2048-bit' },
      { type: 'private-key', format: 'PKCS#1', key: 'RSA 3072-bit' },
      { type: 'private-key', format: 'SEC1', key: 'EC P-384' },
    ]);
    const s = await pem.summarise(v);
    expect(stat(s.stats, 'Contains private key')).toBe('yes');

    // Private key bodies appear nowhere outside Raw: not in stats, slices or Copy
    const body = defined(/-----BEGIN PRIVATE KEY-----\n(.{20})/.exec(ec.privatePem)?.[1]);
    const exported = defined((await pem.export(v)).text);
    for (const out of [
      JSON.stringify(s),
      JSON.stringify(await pem.slice(v, { type: 'json' })),
      exported,
    ]) {
      expect(out).not.toContain(body);
      expect(out).not.toContain('PRIVATE KEY-----');
    }
    expect(exported).toContain('-----BEGIN PUBLIC KEY-----');
  });

  it('runs as a lazily-loaded module and respects Off', async () => {
    const text = await selfSigned('lazy.example', 10);
    const entry = {
      id: 'en-1' as const,
      mime: 'text/plain',
      size: text.length,
      blob: new Blob([text]),
    };
    const loaders = { x509: () => import('../../src/modules/x509/worker') };

    const engine = new Engine({ loaders });
    engine.setPolicies({ langdetect: 'off' });
    const res = await engine.ingest(entry);
    expect(res.interpretations[0]).toMatchObject({
      kind: 'pem',
      status: 'loading',
      module: 'x509',
    });
    expect(await engine.resolve('en-1', 'pem')).toMatchObject({
      status: 'ready',
      label: 'PEM · certificate · CN=lazy.example · expires in 10d',
    });

    const off = new Engine({ loaders });
    off.setPolicies({ langdetect: 'off', x509: 'off' });
    expect((await off.ingest(entry)).interpretations[0]).toMatchObject({
      kind: 'pem',
      status: 'off',
    });
  });
});
