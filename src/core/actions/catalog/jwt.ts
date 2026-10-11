import { z } from 'zod';
import { defineAction } from '../types';

export const jwtVerify = defineAction({
  id: 'jwt.verify',
  title: 'Verify signature',
  group: 'Inspect',
  kinds: ['jwt'],
  params: z.object({
    key: z.string().default('').meta({
      title: 'Key',
      description: 'HMAC secret, PEM public key or certificate, or JWK (JSON)',
      hint: 'multiline',
      secret: true,
    }),
    secretIsBase64: z
      .boolean()
      .default(false)
      .meta({ title: 'Secret is base64', description: 'HMAC only (standard or URL-safe)' }),
    clockSkew: z
      .number()
      .int()
      .min(0)
      .max(86_400)
      .default(60)
      .meta({ title: 'Clock skew (seconds)', description: 'Leeway for exp, nbf and iat' }),
  }),
  // Never mentions the key (the `secret` flag keeps it out of default labels too)
  label: () => 'Verify signature',
});

export const jwtActions = [jwtVerify];
