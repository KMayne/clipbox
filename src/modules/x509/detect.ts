import type { Detector } from '../types';

const PEM_BEGIN =
  /^-----BEGIN (CERTIFICATE|CERTIFICATE REQUEST|PUBLIC KEY|PRIVATE KEY|RSA PRIVATE KEY|EC PRIVATE KEY)-----\s*$/m;

/** Cheap core-side detector; parsing lives in the lazily-loaded worker half. */
export const pemDetector: Detector = {
  kind: 'pem',
  module: 'x509',
  detect: c => (c.text !== null && PEM_BEGIN.test(c.text) ? 0.95 : 0),
};
