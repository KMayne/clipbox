import { z } from 'zod';
import { defineAction } from '../types';

export const base64DataUrl = defineAction({
  id: 'base64.dataUrl',
  title: 'To data URL',
  group: 'Convert',
  kinds: ['base64'],
  params: z.object({}),
});

const ALPHABETS = { url: 'URL-safe (-_)', standard: 'Standard (+/)' };
const PADDING = { keep: 'Keep as is', strip: 'Strip', add: 'Add' };

export const base64Alphabet = defineAction({
  id: 'base64.alphabet',
  title: 'Switch alphabet',
  group: 'Encode',
  kinds: ['base64'],
  params: z.object({
    to: z
      .enum(['url', 'standard'])
      .default('url')
      .meta({ title: 'Alphabet', optionLabels: ALPHABETS }),
    padding: z
      .enum(['keep', 'strip', 'add'])
      .default('keep')
      .meta({ title: 'Padding (=)', optionLabels: PADDING }),
  }),
  label: p =>
    `To ${p.to === 'url' ? 'URL-safe' : 'standard'} base64${p.padding === 'keep' ? '' : `, ${p.padding === 'strip' ? 'unpadded' : 'padded'}`}`,
});

export const base64Actions = [base64DataUrl, base64Alphabet];
