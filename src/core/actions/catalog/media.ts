import { z } from 'zod';
import { defineAction } from '../types';

/** Two-pass loudness normalisation (BS.1770 / EBU R128); video tracks are copied untouched. */
export const mediaNormalise = defineAction({
  id: 'media.normalise',
  title: 'Normalise audio',
  group: 'Convert',
  kinds: ['audio', 'video'],
  module: 'audiotools',
  params: z.object({
    target: z
      .number()
      .min(-36)
      .max(-5)
      .default(-14)
      .meta({ title: 'Target loudness (LUFS)', description: 'Integrated, per EBU R128' }),
    ceiling: z.number().min(-12).max(0).default(-1).meta({ title: 'True-peak ceiling (dBTP)' }),
    limit: z.boolean().default(false).meta({
      title: 'Limit peaks',
      description: 'Reach the target with a true-peak limiter instead of lowering the gain',
    }),
  }),
  label: p => `Normalise to ${p.target} LUFS${p.limit ? ', limited' : ''}`,
});

export const mediaActions = [mediaNormalise];
