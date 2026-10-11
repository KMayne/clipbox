import jsQR from 'jsqr';
import type { QrService } from './service';

/**
 * QR decoding for "Read QR / barcode" where the browser has no BarcodeDetector (Chromium on
 * Windows and Linux). It owns no kinds.
 */
export const service: QrService = {
  decode(rgba, width, height) {
    return jsQR(rgba, width, height, { inversionAttempts: 'attemptBoth' })?.data ?? null;
  },
};
