/**
 * Just enough DER to pull a public key out of a certificate and to convert ECDSA signatures,
 * without loading the x509 module.
 */

interface Tlv {
  tag: number;
  /** Offset of the first content byte. */
  start: number;
  /** Offset just past the content. */
  end: number;
  /** Offset of the tag byte. */
  offset: number;
}

function readTlv(b: Uint8Array, offset: number): Tlv {
  const tag = b[offset];
  let len = b[offset + 1];
  if (tag === undefined || len === undefined) throw new Error('Truncated DER');
  let start = offset + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4) throw new Error('Unsupported DER length');
    len = 0;
    for (let i = 0; i < n; i++) {
      const byte = b[start + i];
      if (byte === undefined) throw new Error('Truncated DER');
      len = len * 256 + byte;
    }
    start += n;
  }
  const end = start + len;
  if (end > b.length) throw new Error('Truncated DER');
  return { tag, start, end, offset };
}

function children(b: Uint8Array, parent: Tlv): Tlv[] {
  const out: Tlv[] = [];
  for (let at = parent.start; at < parent.end;) {
    const t = readTlv(b, at);
    out.push(t);
    at = t.end;
  }
  return out;
}

const SEQUENCE = 0x30;
const INTEGER = 0x02;
const VERSION = 0xa0; // [0] EXPLICIT

/** The SubjectPublicKeyInfo (DER) of an X.509 certificate. */
export function spkiFromCertificate(der: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const cert = readTlv(der, 0);
  const [tbs] = cert.tag === SEQUENCE ? children(der, cert) : [];
  if (tbs?.tag !== SEQUENCE) throw new Error('Not an X.509 certificate');
  const fields = children(der, tbs);
  // version?, serial, signature, issuer, validity, subject, subjectPublicKeyInfo
  const spki = fields[fields[0]?.tag === VERSION ? 6 : 5];
  if (spki?.tag !== SEQUENCE) throw new Error('Not an X.509 certificate');
  return der.slice(spki.offset, spki.end);
}

/** ECDSA signature: DER `SEQUENCE { r INTEGER, s INTEGER }` → JOSE/WebCrypto raw r‖s. */
export function ecdsaDerToRaw(der: Uint8Array, size: number): Uint8Array<ArrayBuffer> {
  const seq = readTlv(der, 0);
  const ints = seq.tag === SEQUENCE ? children(der, seq) : [];
  const [r, s] = ints;
  if (ints.length !== 2 || r?.tag !== INTEGER || s?.tag !== INTEGER) {
    throw new Error('Not a DER ECDSA signature');
  }
  const out = new Uint8Array(size * 2);
  [r, s].forEach((int, i) => {
    let bytes = der.subarray(int.start, int.end);
    while (bytes.length > size && bytes[0] === 0) bytes = bytes.subarray(1);
    if (bytes.length > size) throw new Error('ECDSA signature too long for the curve');
    out.set(bytes, i * size + size - bytes.length);
  });
  return out;
}
