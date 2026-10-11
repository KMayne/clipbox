import { z } from 'zod';
import { defineAction } from '../types';

const INDENT_LABELS = { '2': '2 spaces', '4': '4 spaces', tab: 'tabs' };

export const jsonFormat = defineAction({
  id: 'json.format',
  title: 'Format',
  group: 'Format',
  kinds: ['json'],
  params: z.object({
    indent: z
      .enum(['2', '4', 'tab'])
      .default('2')
      .meta({ title: 'Indent', optionLabels: INDENT_LABELS }),
  }),
  label: p => `Format (${INDENT_LABELS[p.indent]})`,
});

export const jsonMinify = defineAction({
  id: 'json.minify',
  title: 'Minify',
  group: 'Format',
  kinds: ['json'],
  params: z.object({}),
});

export const jsonSortKeys = defineAction({
  id: 'json.sortKeys',
  title: 'Sort keys',
  group: 'Format',
  kinds: ['json'],
  params: z.object({}),
});

export const jsonToYaml = defineAction({
  id: 'json.toYaml',
  title: 'To YAML',
  group: 'Convert',
  kinds: ['json'],
  params: z.object({}),
});

export const jsonTypes = defineAction({
  id: 'json.types',
  title: 'Generate TypeScript types',
  group: 'Convert',
  kinds: ['json'],
  params: z.object({
    rootName: z
      .string()
      .regex(/^[A-Za-z_$][\w$]*$/, 'Must be a valid identifier')
      .default('Root')
      .meta({ title: 'Root type name' }),
  }),
  label: p => `TypeScript types (${p.rootName})`,
});

export const jsonActions = [jsonFormat, jsonMinify, jsonSortKeys, jsonToYaml, jsonTypes];
