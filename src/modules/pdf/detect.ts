import type { Detector } from '../types';

/** Cheap core-side detector (`%PDF-` header via magic); parsing lives in the lazy worker half. */
export const pdfDetector: Detector = {
  kind: 'pdf',
  module: 'pdf',
  detect: c => (c.magic === 'pdf' ? 1 : 0),
};
