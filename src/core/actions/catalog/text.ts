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

export const textActions = [textChangeCase, textSortLines, textReplace];
