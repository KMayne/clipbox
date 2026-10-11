import { z } from 'zod';
import { defineAction } from '../types';

const INDENT_LABELS = { '2': '2 spaces', '4': '4 spaces', tab: 'tabs' };

export const xmlFormat = defineAction({
  id: 'xml.format',
  title: 'Format',
  group: 'Format',
  kinds: ['xml'],
  params: z.object({
    indent: z
      .enum(['2', '4', 'tab'])
      .default('2')
      .meta({ title: 'Indent', optionLabels: INDENT_LABELS }),
  }),
  label: p => `Format (${INDENT_LABELS[p.indent]})`,
});

export const xmlMinify = defineAction({
  id: 'xml.minify',
  title: 'Minify',
  group: 'Format',
  kinds: ['xml'],
  params: z.object({
    comments: z.boolean().default(false).meta({ title: 'Remove comments' }),
  }),
});

export const xmlToJson = defineAction({
  id: 'xml.toJson',
  title: 'To JSON',
  group: 'Convert',
  kinds: ['xml'],
  params: z.object({
    attributes: z
      .enum(['prefix', 'group', 'ignore'])
      .default('prefix')
      .meta({
        title: 'Attributes',
        optionLabels: {
          prefix: 'Prefixed keys (@_id)',
          group: 'Grouped under ":@"',
          ignore: 'Leave out',
        },
      }),
    prefix: z.string().default('@_').meta({ title: 'Attribute prefix' }),
    parseValues: z.boolean().default(true).meta({ title: 'Numbers and booleans as values' }),
  }),
  label: p => `To JSON${p.attributes === 'ignore' ? ' (no attributes)' : ''}`,
});

export const xmlActions = [xmlFormat, xmlMinify, xmlToJson];
