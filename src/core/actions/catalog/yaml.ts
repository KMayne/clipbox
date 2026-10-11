import { z } from 'zod';
import { defineAction } from '../types';

export const yamlToJson = defineAction({
  id: 'yaml.toJson',
  title: 'To JSON',
  group: 'Convert',
  kinds: ['yaml'],
  params: z.object({}),
});

export const yamlFormat = defineAction({
  id: 'yaml.format',
  title: 'Format',
  group: 'Format',
  kinds: ['yaml'],
  params: z.object({
    indent: z.number().int().min(1).max(8).default(2).meta({ title: 'Indent (spaces)' }),
  }),
  label: p => `Format (${p.indent} spaces)`,
});

export const yamlActions = [yamlFormat, yamlToJson];
