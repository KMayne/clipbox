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

export const jsonToNdjson = defineAction({
  id: 'json.toNdjson',
  title: 'To NDJSON',
  group: 'Convert',
  kinds: ['json'],
  params: z.object({}),
});

export const jsonFlatten = defineAction({
  id: 'json.flatten',
  title: 'Flatten to paths',
  group: 'Format',
  kinds: ['json'],
  params: z.object({
    separator: z.string().min(1, 'Enter a separator').default('.').meta({ title: 'Separator' }),
    arrays: z
      .enum(['dot', 'bracket'])
      .default('dot')
      .meta({
        title: 'Array indices',
        optionLabels: { dot: 'As keys (a.0.b)', bracket: 'In brackets (a[0].b)' },
      }),
  }),
  label: p => `Flatten (${p.arrays === 'dot' ? `a${p.separator}0` : 'a[0]'})`,
});

export const jsonPick = defineAction({
  id: 'json.pick',
  title: 'Pick by path',
  group: 'Extract',
  kinds: ['json'],
  params: z.object({
    path: z.string().default('$').meta({
      title: 'JSONPath',
      hint: 'regex',
      description: "e.g. $.items[*].name, $..id, $.list[0:5], $['a key']",
    }),
    wrap: z.boolean().default(false).meta({ title: 'Always return an array' }),
  }),
  label: p => `Pick ${p.path}`,
});

export const jsonActions = [
  jsonFormat,
  jsonMinify,
  jsonSortKeys,
  jsonFlatten,
  jsonToYaml,
  jsonToNdjson,
  jsonTypes,
  jsonPick,
];
