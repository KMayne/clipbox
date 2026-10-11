export type HashAlgorithm = 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512';

/** Lowercase hex digest of `bytes`. */
export async function digestHex(
  algorithm: HashAlgorithm,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<string> {
  const digest = await crypto.subtle.digest(algorithm, bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

export const sha256 = (bytes: Uint8Array<ArrayBuffer>) => digestHex('SHA-256', bytes);
