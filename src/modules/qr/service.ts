/** The qr module's service, typed and checked without importing jsQR. */
import { isRecord } from '../../core/guards';

export interface QrService {
  /** The QR code in RGBA pixels (one per image: jsQR finds the clearest), or null. */
  decode(rgba: Uint8ClampedArray, width: number, height: number): string | null;
}

export const isQrService = (s: unknown): s is QrService =>
  isRecord(s) && typeof s.decode === 'function';
