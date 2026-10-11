import { z } from 'zod';
import { defineAction } from '../types';

// Hex dump is `any.hexDump`, which covers binary too.

export const binaryToBase64 = defineAction({
  id: 'binary.toBase64',
  title: 'To base64',
  group: 'Encode',
  kinds: ['binary'],
  params: z.object({
    alphabet: z
      .enum(['standard', 'url'])
      .default('standard')
      .meta({ title: 'Alphabet', optionLabels: { standard: 'Standard', url: 'URL-safe' } }),
    wrap: z
      .boolean()
      .default(false)
      .meta({ title: 'Wrap at 76 columns', description: 'As MIME does' }),
  }),
  label: p => `To base64${p.alphabet === 'url' ? ' (URL-safe)' : ''}`,
});

export const binaryActions = [binaryToBase64];
