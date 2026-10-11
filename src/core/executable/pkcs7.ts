/**
 * Just enough DER to name who signed an executable: walks a PKCS#7 / CMS SignedData blob for its
 * certificates and the signer's issuer and serial. Nothing is verified, and anything unexpected
 * fails with a FormatError rather than guessing.
 */

import { FormatError, latin1 } from './reader';
import type { CertSummary, SignatureInfo } from './types';

interface Tlv {
  tag: number;
  /** Offset of the tag byte. */
  start: number;
  /** Offset of the contents. */
  body: number;
  end: number;
}

const MAX_CHILDREN = 1000;

function readTlv(b: Uint8Array, at: number, limit: number): Tlv {
  if (at + 2 > limit) throw new FormatError('DER element runs past its parent');
  const tag = b[at] ?? 0;
  if ((tag & 0x1f) === 0x1f) throw new FormatError('multi-byte DER tags are not supported');
  let len = b[at + 1] ?? 0;
  let body = at + 2;
  if (len === 0x80) throw new FormatError('indefinite-length encoding is not DER');
  if (len > 0x80) {
    const n = len & 0x7f;
    if (n > 4 || body + n > limit) throw new FormatError('bad DER length');
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + (b[body + i] ?? 0);
    body += n;
  }
  const end = body + len;
  if (end > limit) throw new FormatError('DER element runs past its parent');
  return { tag, start: at, body, end };
}

function children(b: Uint8Array, parent: Tlv): Tlv[] {
  const out: Tlv[] = [];
  let at = parent.body;
  while (at < parent.end) {
    if (out.length >= MAX_CHILDREN) throw new FormatError('too many DER elements');
    const t = readTlv(b, at, parent.end);
    out.push(t);
    at = t.end;
  }
  return out;
}

function expect(t: Tlv | undefined, tag: number, what: string): Tlv {
  if (!t || t.tag !== tag) throw new FormatError(`expected ${what}`);
  return t;
}

function oid(b: Uint8Array, t: Tlv): string {
  const parts: number[] = [];
  let v = 0;
  for (let i = t.body; i < t.end; i++) {
    const byte = b[i] ?? 0;
    v = v * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) {
      if (parts.length === 0) parts.push(v < 80 ? Math.floor(v / 40) : 2, v < 80 ? v % 40 : v - 80);
      else parts.push(v);
      v = 0;
    }
  }
  return parts.join('.');
}

const ATTRIBUTES: Record<string, string> = {
  '2.5.4.3': 'CN',
  '2.5.4.4': 'SN',
  '2.5.4.5': 'serialNumber',
  '2.5.4.6': 'C',
  '2.5.4.7': 'L',
  '2.5.4.8': 'ST',
  '2.5.4.9': 'street',
  '2.5.4.10': 'O',
  '2.5.4.11': 'OU',
  '2.5.4.12': 'title',
  '2.5.4.15': 'businessCategory',
  '2.5.4.17': 'postalCode',
  '2.5.4.42': 'GN',
  '1.2.840.113549.1.9.1': 'E',
  '0.9.2342.19200300.100.1.25': 'DC',
  '1.3.6.1.4.1.311.60.2.1.3': 'jurisdictionC',
};

const DIGESTS: Record<string, string> = {
  '1.2.840.113549.2.5': 'MD5',
  '1.3.14.3.2.26': 'SHA-1',
  '2.16.840.1.101.3.4.2.1': 'SHA-256',
  '2.16.840.1.101.3.4.2.2': 'SHA-384',
  '2.16.840.1.101.3.4.2.3': 'SHA-512',
};

function stringValue(b: Uint8Array, t: Tlv): string {
  const raw = b.subarray(t.body, t.end);
  switch (t.tag) {
    case 0x0c: // UTF8String
      return new TextDecoder().decode(raw);
    case 0x1e: // BMPString
      return new TextDecoder('utf-16be').decode(raw);
    case 0x1c: {
      // UniversalString (UTF-32BE)
      let s = '';
      for (let i = 0; i + 3 < raw.length; i += 4) {
        const cp =
          (((raw[i] ?? 0) << 24) |
            ((raw[i + 1] ?? 0) << 16) |
            ((raw[i + 2] ?? 0) << 8) |
            (raw[i + 3] ?? 0)) >>>
          0;
        s += cp <= 0x10ffff ? String.fromCodePoint(cp) : '\ufffd';
      }
      return s;
    }
    default: // Printable, IA5, Teletex, Visible…
      return latin1(raw);
  }
}

const escapeDn = (s: string) => s.replace(/([,+"\\<>;])/g, '\\$1');

/** RFC 4514-style, in the order stored: "CN=Example, O=Example Corp, C=GB". */
function name(b: Uint8Array, t: Tlv): string {
  const parts: string[] = [];
  for (const rdn of children(b, expect(t, 0x30, 'a Name'))) {
    for (const atv of children(b, rdn)) {
      const [type, value] = children(b, atv);
      if (!type || !value || type.tag !== 0x06) continue;
      const id = oid(b, type);
      parts.push(`${ATTRIBUTES[id] ?? id}=${escapeDn(stringValue(b, value))}`);
    }
  }
  return parts.join(', ');
}

function time(b: Uint8Array, t: Tlv | undefined): string | null {
  if (!t || (t.tag !== 0x17 && t.tag !== 0x18)) return null;
  const s = latin1(b.subarray(t.body, t.end));
  const m = /^(\d{2}|\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?Z$/.exec(s);
  if (!m) return null;
  let year = Number(m[1]);
  if (t.tag === 0x17) year += year < 50 ? 2000 : 1900;
  const iso = `${String(year).padStart(4, '0')}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? '00'}Z`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

const hexOf = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');

interface ParsedCert extends CertSummary {
  issuerDer: string;
  serialHex: string;
  range: { offset: number; size: number };
}

function certificate(b: Uint8Array, t: Tlv, base: number): ParsedCert {
  const [tbs] = children(b, expect(t, 0x30, 'a certificate'));
  const fields = children(b, expect(tbs, 0x30, 'a TBSCertificate'));
  let i = fields[0]?.tag === 0xa0 ? 1 : 0; // optional [0] version
  const serial = expect(fields[i++], 0x02, 'a serial number');
  i++; // signature algorithm
  const issuer = expect(fields[i++], 0x30, 'an issuer');
  const validity = children(b, expect(fields[i++], 0x30, 'a validity period'));
  const subject = expect(fields[i], 0x30, 'a subject');
  return {
    subject: name(b, subject),
    issuer: name(b, issuer),
    notBefore: time(b, validity[0]),
    notAfter: time(b, validity[1]),
    serial: hexOf(b.subarray(serial.body, serial.end))
      .replace(/^(00)+(?=.)/, '')
      .toUpperCase(),
    issuerDer: hexOf(b.subarray(issuer.start, issuer.end)),
    serialHex: hexOf(b.subarray(serial.body, serial.end)),
    range: { offset: base + t.start, size: t.end - t.start },
  };
}

const SIGNED_DATA = '1.2.840.113549.1.7.2';

/**
 * Reads a DER ContentInfo holding SignedData. `base` is the blob's offset in the file, so the
 * returned certificate ranges are file offsets.
 */
export function parseSignedData(
  b: Uint8Array,
  base: number,
): Pick<SignatureInfo, 'signer' | 'certificates' | 'digest' | 'certRanges'> {
  const root = readTlv(b, 0, b.length);
  const [type, content] = children(b, expect(root, 0x30, 'a ContentInfo'));
  if (!type || type.tag !== 0x06 || oid(b, type) !== SIGNED_DATA) {
    throw new FormatError('not PKCS#7 SignedData');
  }
  const [signedData] = children(b, expect(content, 0xa0, 'SignedData content'));
  const parts = children(b, expect(signedData, 0x30, 'SignedData'));

  const certs: ParsedCert[] = [];
  const certSet = parts.find(p => p.tag === 0xa0);
  if (certSet) {
    for (const c of children(b, certSet)) {
      if (c.tag !== 0x30) continue; // other certificate formats
      certs.push(certificate(b, c, base));
    }
  }

  let signer: ParsedCert | null = null;
  let digest: string | null = null;
  const signerInfos = parts.at(-1);
  if (signerInfos?.tag === 0x31) {
    const [first] = children(b, signerInfos);
    if (first) {
      const fields = children(b, expect(first, 0x30, 'a SignerInfo'));
      const sid = fields[1];
      if (sid?.tag === 0x30) {
        const [issuer, serial] = children(b, sid);
        if (issuer && serial) {
          const issuerDer = hexOf(b.subarray(issuer.start, issuer.end));
          const serialHex = hexOf(b.subarray(serial.body, serial.end));
          signer = certs.find(c => c.issuerDer === issuerDer && c.serialHex === serialHex) ?? null;
        }
      }
      const alg = fields[2]?.tag === 0x30 ? children(b, fields[2])[0] : undefined;
      if (alg?.tag === 0x06) {
        const id = oid(b, alg);
        digest = DIGESTS[id] ?? id;
      }
    }
  }
  const summary = (c: ParsedCert): CertSummary => ({
    subject: c.subject,
    issuer: c.issuer,
    notBefore: c.notBefore,
    notAfter: c.notAfter,
    serial: c.serial,
  });
  return {
    signer: signer ? summary(signer) : null,
    certificates: certs.map(summary),
    digest,
    certRanges: certs.map(c => c.range),
  };
}

/** The CN, else O, else the whole name. */
export function displayName(dn: string): string {
  const pick = (key: string) =>
    new RegExp(`(?:^|,\\s*)${key}=((?:\\\\.|[^,])+)`).exec(dn)?.[1]?.replace(/\\(.)/g, '$1');
  return pick('CN') ?? pick('O') ?? dn;
}
