import { z } from 'zod';
import { defineAction } from '../types';

export const HASH_LABELS = {
  'SHA-256': 'SHA-256',
  'SHA-1': 'SHA-1',
  'SHA-384': 'SHA-384',
  'SHA-512': 'SHA-512',
};

/** Actions for every kind; they read the raw entry, not the parsed value. */
export const anyHash = defineAction({
  id: 'any.hash',
  title: 'Hash',
  group: 'Inspect',
  kinds: '*',
  params: z.object({
    algorithm: z
      .enum(['SHA-256', 'SHA-1', 'SHA-384', 'SHA-512'])
      .default('SHA-256')
      .meta({ title: 'Algorithm' }),
  }),
  label: p => p.algorithm,
});

export const anyActions = [anyHash];
