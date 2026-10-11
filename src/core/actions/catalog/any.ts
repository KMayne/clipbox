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

export const TEXT_ENCODINGS = {
  'utf-8': 'UTF-8',
  latin1: 'Latin-1 (Windows-1252)',
  'utf-16le': 'UTF-16 LE',
  'utf-16be': 'UTF-16 BE',
};

/** Decodes the raw bytes as text; offered when they aren't already UTF-8 text. */
export const anyOpenAsText = defineAction({
  id: 'any.openAsText',
  title: 'Open as text',
  group: 'Convert',
  kinds: '*',
  params: z.object({
    encoding: z
      .enum(['utf-8', 'latin1', 'utf-16le', 'utf-16be'])
      .default('utf-8')
      .meta({ title: 'Encoding', optionLabels: TEXT_ENCODINGS }),
  }),
  label: p => `Open as text (${TEXT_ENCODINGS[p.encoding]})`,
});

export const anyHexDump = defineAction({
  id: 'any.hexDump',
  title: 'Hex dump',
  group: 'Inspect',
  kinds: '*',
  params: z.object({
    bytesPerRow: z.enum(['8', '16', '32']).default('16').meta({ title: 'Bytes per row' }),
  }),
  label: p => (p.bytesPerRow === '16' ? 'Hex dump' : `Hex dump (${p.bytesPerRow} per row)`),
});

export const anyActions = [anyHash, anyOpenAsText, anyHexDump];
