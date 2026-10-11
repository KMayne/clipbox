import { z } from 'zod';
import { defineAction } from '../types';

export const CASE_LABELS = {
  upper: 'UPPERCASE',
  lower: 'lowercase',
  title: 'Title Case',
  camel: 'camelCase',
  snake: 'snake_case',
  kebab: 'kebab-case',
};

export const textChangeCase = defineAction({
  id: 'text.changeCase',
  title: 'Change case',
  group: 'Format',
  kinds: ['text'],
  params: z.object({
    to: z
      .enum(['upper', 'lower', 'title', 'camel', 'snake', 'kebab'])
      .default('upper')
      .meta({ title: 'To', optionLabels: CASE_LABELS }),
  }),
  label: p => CASE_LABELS[p.to],
});

export const textSortLines = defineAction({
  id: 'text.sortLines',
  title: 'Sort lines',
  group: 'Lines',
  kinds: ['text'],
  params: z.object({
    order: z
      .enum(['asc', 'desc'])
      .default('asc')
      .meta({ title: 'Order', optionLabels: { asc: 'A → Z', desc: 'Z → A' } }),
    unique: z.boolean().default(false).meta({ title: 'Remove duplicates' }),
  }),
  label: p => `Sort lines ${p.order === 'asc' ? 'A → Z' : 'Z → A'}${p.unique ? ', unique' : ''}`,
});

export const textReplace = defineAction({
  id: 'text.replace',
  title: 'Find & replace',
  group: 'Format',
  kinds: ['text'],
  params: z.object({
    find: z.string().default('').meta({ title: 'Find', hint: 'regex' }),
    replace: z.string().default('').meta({ title: 'Replace with' }),
    regex: z.boolean().default(false).meta({ title: 'Regular expression' }),
  }),
  label(p) {
    const clip = (s: string) => (s.length > 14 ? `${s.slice(0, 13)}…` : s);
    const find = p.regex ? `/${clip(p.find)}/` : `"${clip(p.find)}"`;
    return `Find & replace ${find} → ${clip(p.replace) || '∅'}`;
  },
});

const SIDE_LABELS = { both: 'Both ends', start: 'Leading', end: 'Trailing' };

export const textTrim = defineAction({
  id: 'text.trim',
  title: 'Trim',
  group: 'Lines',
  kinds: ['text'],
  params: z.object({
    side: z
      .enum(['both', 'start', 'end'])
      .default('both')
      .meta({ title: 'Whitespace', optionLabels: SIDE_LABELS }),
    scope: z
      .enum(['lines', 'whole'])
      .default('lines')
      .meta({ title: 'Apply to', optionLabels: { lines: 'Each line', whole: 'Whole text' } }),
  }),
  label: p =>
    `Trim (${SIDE_LABELS[p.side].toLowerCase()}${p.scope === 'lines' ? ', each line' : ''})`,
});

export const textRemoveBlank = defineAction({
  id: 'text.removeBlank',
  title: 'Remove blank lines',
  group: 'Lines',
  kinds: ['text'],
  params: z.object({
    whitespace: z.boolean().default(true).meta({ title: 'Whitespace-only lines count as blank' }),
  }),
  label: () => 'Remove blank lines',
});

export const textDedupe = defineAction({
  id: 'text.dedupeLines',
  title: 'Dedupe lines',
  group: 'Lines',
  kinds: ['text'],
  params: z.object({
    ignoreCase: z.boolean().default(false).meta({ title: 'Ignore case' }),
  }),
  label: p => `Dedupe lines${p.ignoreCase ? ' (ignoring case)' : ''}`,
});

export const textReverse = defineAction({
  id: 'text.reverseLines',
  title: 'Reverse lines',
  group: 'Lines',
  kinds: ['text'],
  params: z.object({}),
});

export const CODEC_LABELS = {
  base64: 'Base64',
  base64url: 'Base64 (URL-safe)',
  component: 'URL component',
  uri: 'Full URL',
  html: 'HTML entities',
  json: 'JSON string',
};
const codec = z
  .enum(['base64', 'base64url', 'component', 'uri', 'html', 'json'])
  .default('base64')
  .meta({ title: 'Format', optionLabels: CODEC_LABELS });

export const textEncode = defineAction({
  id: 'text.encode',
  title: 'Encode',
  group: 'Encode',
  kinds: ['text'],
  params: z.object({
    format: codec,
    nonAscii: z
      .boolean()
      .default(false)
      .meta({ title: 'Escape non-ASCII', description: 'HTML entities and JSON strings only' }),
    quotes: z.boolean().default(false).meta({ title: 'Wrap JSON string in quotes' }),
  }),
  label: p => `Encode ${CODEC_LABELS[p.format]}`,
});

export const textDecode = defineAction({
  id: 'text.decode',
  title: 'Decode',
  group: 'Encode',
  kinds: ['text'],
  params: z.object({ format: codec }),
  label: p => `Decode ${CODEC_LABELS[p.format]}`,
});

export const textSplitLines = defineAction({
  id: 'text.splitLines',
  title: 'Split lines → JSON array',
  group: 'Convert',
  kinds: ['text'],
  params: z.object({
    trim: z.boolean().default(true).meta({ title: 'Trim each line' }),
    skipEmpty: z.boolean().default(true).meta({ title: 'Skip empty lines' }),
  }),
  label: () => 'Lines as JSON array',
});

export const textActions = [
  textChangeCase,
  textSortLines,
  textReplace,
  textTrim,
  textRemoveBlank,
  textDedupe,
  textReverse,
  textEncode,
  textDecode,
  textSplitLines,
];
