/** Display data for PEM blocks; shared by the worker interpreter and the core PemView preview. */

export interface CertificateInfo {
  type: 'certificate';
  subject: string;
  issuer: string;
  serial: string;
  /** ISO 8601 */
  notBefore: string;
  notAfter: string;
  sans: string[];
  publicKey: string;
  signature: string;
  /** Colon-separated uppercase hex. */
  sha256: string;
  isCA: boolean;
  selfSigned: boolean;
}

export interface CsrInfo {
  type: 'csr';
  subject: string;
  sans: string[];
  publicKey: string;
  signature: string;
}

export interface PublicKeyInfo {
  type: 'public-key';
  publicKey: string;
}

/** Only the type and size: key material is never surfaced. */
export interface PrivateKeyInfo {
  type: 'private-key';
  format: string;
  key: string;
}

export interface UnknownBlockInfo {
  type: 'unknown';
  label: string;
  error: string;
}

export type PemBlockInfo =
  CertificateInfo | CsrInfo | PublicKeyInfo | PrivateKeyInfo | UnknownBlockInfo;

/** Whole days until `iso`: rounded up while in the future, 0 or negative (whole days ago) once past. */
export function daysUntil(iso: string, now = Date.now()): number {
  const diff = Date.parse(iso) - now;
  return diff > 0 ? Math.ceil(diff / 86_400_000) : -Math.floor(-diff / 86_400_000);
}

export function expiryText(iso: string, now = Date.now()): string {
  const d = daysUntil(iso, now);
  if (d > 0) return `expires in ${d}d`;
  return d === 0 ? 'expired today' : `expired ${-d}d ago`;
}

/** Common name, or the whole distinguished name if there is none. */
export function commonName(dn: string): string {
  const cn = /(?:^|,\s*)CN=((?:\\,|[^,])+)/.exec(dn)?.[1];
  return cn ? `CN=${cn}` : dn;
}
