import { isRecord } from '../../core/guards';

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

/** The x509 module's service for the core PEM actions (certificates come back leaf first). */
export interface X509ActionService {
  /** One JSON-ready object per certificate. */
  certificateDetails(pem: string, now?: number): Promise<Record<string, unknown>[]>;
  /** SPKI PEM of each certificate, CSR and public key, certificates first. */
  publicKeys(pem: string): Promise<{ source: string; pem: string }[]>;
}

export const isX509ActionService = (s: unknown): s is X509ActionService =>
  isRecord(s) && typeof s.certificateDetails === 'function' && typeof s.publicKeys === 'function';

/** The part of a pem value the core actions read, checked without importing the library. */
export interface PemValueInfo {
  kind: 'pem';
  blocks: { type: string; subject?: unknown; sha256?: unknown }[];
}

export const isPemValueInfo = (v: unknown): v is PemValueInfo =>
  isRecord(v) &&
  v.kind === 'pem' &&
  Array.isArray(v.blocks) &&
  v.blocks.every(b => isRecord(b) && typeof b.type === 'string');
