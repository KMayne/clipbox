/** Chrome extension (CRX2/CRX3) headers: where the zip starts, and the extension ID. */

import { bytesFields, protoFields } from './protobuf';

export interface CrxHeader {
  version: 2 | 3;
  /** Offset of the zip after the header. */
  zipOffset: number;
  /** DER SubjectPublicKeyInfo keys (CRX2's one key; CRX3's RSA then ECDSA proofs). */
  publicKeys: Uint8Array<ArrayBuffer>[];
  /** CRX3 signed_header_data.crx_id (16 bytes), when present. */
  crxId: Uint8Array<ArrayBuffer> | null;
}

const MAX_HEADER = 1 << 20;

/** "Cr24" magic. */
export const hasCrxMagic = (b: Uint8Array) =>
  b.length >= 16 && b[0] === 0x43 && b[1] === 0x72 && b[2] === 0x32 && b[3] === 0x34;

/** Parses the header; null when it isn't a CRX we understand. */
export function parseCrxHeader(b: Uint8Array<ArrayBuffer>): CrxHeader | null {
  if (!hasCrxMagic(b)) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const version = dv.getUint32(4, true);
  if (version === 2) {
    const keyLen = dv.getUint32(8, true);
    const sigLen = dv.getUint32(12, true);
    const zipOffset = 16 + keyLen + sigLen;
    if (keyLen > MAX_HEADER || sigLen > MAX_HEADER || zipOffset > b.length) return null;
    return { version, zipOffset, publicKeys: [b.subarray(16, 16 + keyLen)], crxId: null };
  }
  if (version !== 3) return null;
  const headerLen = dv.getUint32(8, true);
  const zipOffset = 12 + headerLen;
  if (headerLen > MAX_HEADER || zipOffset > b.length) return null;
  // CrxFileHeader: sha256_with_rsa = 2, sha256_with_ecdsa = 3 (AsymmetricKeyProof: public_key = 1),
  // signed_header_data = 10000 (SignedData: crx_id = 1)
  try {
    const header = protoFields(b.subarray(12, zipOffset));
    const keys = [...bytesFields(header, 2), ...bytesFields(header, 3)].flatMap(proof =>
      bytesFields(protoFields(proof), 1),
    );
    const signed = bytesFields(header, 10000).at(-1);
    const crxId = signed ? (bytesFields(protoFields(signed), 1).at(-1) ?? null) : null;
    return { version, zipOffset, publicKeys: keys, crxId };
  } catch {
    return { version, zipOffset, publicKeys: [], crxId: null };
  }
}

/** Chrome's ID alphabet: each hex digit 0–f becomes a–p. */
export function idFromBytes(bytes: Uint8Array): string {
  let id = '';
  for (const b of bytes.subarray(0, 16)) id += String.fromCharCode(97 + (b >> 4), 97 + (b & 0xf));
  return id;
}

/** First 16 bytes of SHA-256(key) in Chrome's a–p alphabet. */
export async function extensionId(publicKey: Uint8Array<ArrayBuffer>): Promise<string> {
  return idFromBytes(new Uint8Array(await crypto.subtle.digest('SHA-256', publicKey)));
}

/**
 * The extension's ID: CRX3's declared crx_id, else the ID of the first key (CRX2's only key).
 * `verified` says whether one of the keys hashes to the declared ID.
 */
export async function crxExtensionId(
  h: CrxHeader,
): Promise<{ id: string | null; verified: boolean }> {
  const ids = await Promise.all(h.publicKeys.map(extensionId));
  if (h.crxId && h.crxId.length === 16) {
    const id = idFromBytes(h.crxId);
    return { id, verified: ids.includes(id) };
  }
  return { id: ids[0] ?? null, verified: ids.length > 0 };
}
