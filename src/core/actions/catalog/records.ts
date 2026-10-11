import { z } from 'zod';
import { defineAction } from '../types';

const columnHint = 'A header name or a 1-based column number';

export const recordsToCsv = defineAction({
  id: 'records.toCsv',
  title: 'To CSV',
  group: 'Convert',
  kinds: ['records'],
  params: z.object({}),
});

export const recordsToTsv = defineAction({
  id: 'records.toTsv',
  title: 'To TSV',
  group: 'Convert',
  kinds: ['records'],
  params: z.object({}),
});

export const ALIGN_LABELS = {
  auto: 'Auto (numbers right)',
  left: 'Left',
  center: 'Centre',
  right: 'Right',
  none: 'Unspecified',
};

export const recordsToMarkdown = defineAction({
  id: 'records.toMarkdown',
  title: 'To Markdown table',
  group: 'Convert',
  kinds: ['records'],
  params: z.object({
    align: z
      .enum(['auto', 'left', 'center', 'right', 'none'])
      .default('auto')
      .meta({ title: 'Alignment', optionLabels: ALIGN_LABELS }),
  }),
  label: () => 'Markdown table',
});

export const SQL_DIALECTS = {
  ansi: 'ANSI SQL',
  mysql: 'MySQL',
  postgres: 'PostgreSQL',
  sqlite: 'SQLite',
};

export const recordsToSql = defineAction({
  id: 'records.toSql',
  title: 'To SQL INSERTs',
  group: 'Convert',
  kinds: ['records'],
  params: z.object({
    table: z.string().trim().min(1, 'Enter a table name').default('data').meta({
      title: 'Table name',
      description: 'May include a schema, e.g. public.users',
    }),
    dialect: z
      .enum(['ansi', 'mysql', 'postgres', 'sqlite'])
      .default('ansi')
      .meta({ title: 'Dialect', optionLabels: SQL_DIALECTS }),
    batch: z.number().int().min(1).max(10000).default(100).meta({ title: 'Rows per INSERT' }),
    emptyAsNull: z.boolean().default(true).meta({ title: 'Empty cells as NULL' }),
  }),
  label: p => `SQL INSERTs into ${p.table} (${SQL_DIALECTS[p.dialect]})`,
});

export const recordsTypes = defineAction({
  id: 'records.types',
  title: 'Generate TypeScript types',
  group: 'Convert',
  kinds: ['records'],
  params: z.object({
    rowName: z
      .string()
      .regex(/^[A-Za-z_$][\w$]*$/, 'Must be a valid identifier')
      .default('Row')
      .meta({ title: 'Row type name' }),
  }),
  label: p => `TypeScript types (${p.rowName})`,
});

export const recordsPick = defineAction({
  id: 'records.pickColumns',
  title: 'Pick/rename columns',
  group: 'Format',
  kinds: ['records'],
  params: z.object({
    columns: z.string().default('').meta({
      title: 'Columns',
      description:
        'Comma-separated, in output order; rename with old:new, e.g. "id, 3, name:title"',
    }),
  }),
  label: p => `Columns ${p.columns}`,
});

export const COMPARE_LABELS = { natural: 'Natural', numeric: 'Numeric', text: 'Text' };

export const recordsSort = defineAction({
  id: 'records.sort',
  title: 'Sort by column',
  group: 'Format',
  kinds: ['records'],
  params: z.object({
    column: z.string().default('1').meta({ title: 'Column', description: columnHint }),
    order: z
      .enum(['asc', 'desc'])
      .default('asc')
      .meta({ title: 'Order', optionLabels: { asc: 'Ascending', desc: 'Descending' } }),
    compare: z
      .enum(['natural', 'numeric', 'text'])
      .default('natural')
      .meta({ title: 'Compare as', optionLabels: COMPARE_LABELS }),
  }),
  label: p => `Sort by ${p.column} ${p.order === 'asc' ? '↑' : '↓'}`,
});

export const FILTER_OPS = {
  eq: 'equals',
  ne: 'not equals',
  contains: 'contains',
  starts: 'starts with',
  regex: 'matches regex',
  gt: '>',
  lt: '<',
  empty: 'is empty',
  notEmpty: 'is not empty',
};

export const recordsFilter = defineAction({
  id: 'records.filter',
  title: 'Filter rows',
  group: 'Extract',
  kinds: ['records'],
  params: z.object({
    column: z.string().default('1').meta({ title: 'Column', description: columnHint }),
    op: z
      .enum(['eq', 'ne', 'contains', 'starts', 'regex', 'gt', 'lt', 'empty', 'notEmpty'])
      .default('contains')
      .meta({ title: 'Condition', optionLabels: FILTER_OPS }),
    value: z.string().default('').meta({ title: 'Value' }),
    ignoreCase: z.boolean().default(true).meta({ title: 'Ignore case' }),
  }),
  label: p =>
    `Rows where ${p.column} ${FILTER_OPS[p.op]}${
      p.op === 'empty' || p.op === 'notEmpty' ? '' : ` "${p.value}"`
    }`,
});

export const recordsActions = [
  recordsSort,
  recordsPick,
  recordsFilter,
  recordsToCsv,
  recordsToTsv,
  recordsToMarkdown,
  recordsToSql,
  recordsTypes,
];
