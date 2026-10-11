import { z } from 'zod';
import { defineAction } from '../types';

export const UUID_FORMATS = {
  lower: 'lowercase',
  upper: 'UPPERCASE',
  plain: 'No dashes',
  braces: '{Braces}',
  urn: 'URN (urn:uuid:…)',
};

export const uuidFormat = defineAction({
  id: 'uuid.format',
  title: 'Reformat',
  group: 'Format',
  kinds: ['uuid'],
  params: z.object({
    to: z
      .enum(['lower', 'upper', 'plain', 'braces', 'urn'])
      .default('lower')
      .meta({ title: 'Format', optionLabels: UUID_FORMATS }),
  }),
  label: p => `Reformat (${UUID_FORMATS[p.to]})`,
});

export const uuidTime = defineAction({
  id: 'uuid.time',
  title: 'Extract time',
  group: 'Extract',
  kinds: ['uuid'],
  params: z.object({}),
});

export const uuidActions = [uuidFormat, uuidTime];
