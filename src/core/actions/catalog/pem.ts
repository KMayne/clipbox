import { z } from 'zod';
import { defineAction } from '../types';

export const pemDetails = defineAction({
  id: 'pem.details',
  title: 'Certificate details',
  group: 'Extract',
  kinds: ['pem'],
  module: 'x509',
  params: z.object({}),
});

const FINGERPRINTS = { 'SHA-256': 'SHA-256', 'SHA-1': 'SHA-1', both: 'SHA-256 and SHA-1' };

export const pemFingerprint = defineAction({
  id: 'pem.fingerprint',
  title: 'Fingerprint',
  group: 'Inspect',
  kinds: ['pem'],
  params: z.object({
    algorithm: z
      .enum(['SHA-256', 'SHA-1', 'both'])
      .default('SHA-256')
      .meta({ title: 'Algorithm', optionLabels: FINGERPRINTS }),
  }),
  label: p => `Fingerprint (${FINGERPRINTS[p.algorithm]})`,
});

export const pemPublicKey = defineAction({
  id: 'pem.publicKey',
  title: 'Extract public key',
  group: 'Extract',
  kinds: ['pem'],
  module: 'x509',
  params: z.object({
    all: z
      .boolean()
      .default(false)
      .meta({
        title: 'Every block',
        description: 'Otherwise only the first (the leaf certificate)',
      }),
  }),
  label: p => (p.all ? 'Extract public keys' : 'Extract public key'),
});

export const pemActions = [pemDetails, pemFingerprint, pemPublicKey];
