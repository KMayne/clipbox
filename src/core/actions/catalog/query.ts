import { z } from 'zod';
import { defineAction } from '../types';

/**
 * Querying and grouping for arrays of objects (JSON) and records (CSV, TSV, NDJSON rows), plus
 * jq for any JSON-like value.
 */

const field = (title = 'Field') =>
  z.string().default('').meta({
    title,
    description: 'A dot path such as user.country (JSON), or a column name or 1-based number (CSV)',
  });

export const GROUP_OUTPUTS = {
  summary: 'Summary table',
  object: 'Object of arrays',
  groups: 'Array of groups',
};

export const GROUP_SORTS = {
  keyAsc: 'Key, A → Z',
  keyDesc: 'Key, Z → A',
  countDesc: 'Count, largest first',
  countAsc: 'Count, smallest first',
  first: 'First seen',
};

export const MISSING_LABELS = { none: 'Group as (none)', skip: 'Skip' };

const missing = z
  .enum(['none', 'skip'])
  .default('none')
  .meta({ title: 'Missing values', optionLabels: MISSING_LABELS });

export const queryGroupBy = defineAction({
  id: 'query.groupBy',
  title: 'Group by',
  group: 'Convert',
  kinds: ['json', 'records'],
  params: z.object({
    field: field(),
    output: z
      .enum(['summary', 'object', 'groups'])
      .default('summary')
      .meta({ title: 'Output', optionLabels: GROUP_OUTPUTS }),
    aggregates: z
      .string()
      .default('')
      .meta({
        title: 'Aggregates',
        description:
          'Summary table columns as function:field, comma-separated, e.g. "sum:price, avg:age". ' +
          'Functions: count, sum, avg, min, max, distinct (count distinct), first, last',
      }),
    sort: z
      .enum(['keyAsc', 'keyDesc', 'countDesc', 'countAsc', 'first'])
      .default('keyAsc')
      .meta({ title: 'Sort groups', optionLabels: GROUP_SORTS }),
    missing,
  }),
  label: p => `Group by ${p.field} (${GROUP_OUTPUTS[p.output].toLowerCase()})`,
});

export const queryCountBy = defineAction({
  id: 'query.countBy',
  title: 'Count by',
  group: 'Inspect',
  kinds: ['json', 'records'],
  params: z.object({ field: field(), missing }),
  label: p => `Count by ${p.field}`,
});

export const DISTINCT_SORTS = { first: 'First seen', asc: 'A → Z', count: 'Most common first' };

export const queryDistinct = defineAction({
  id: 'query.distinct',
  title: 'Distinct values',
  group: 'Inspect',
  kinds: ['json', 'records'],
  params: z.object({
    field: field(),
    sort: z
      .enum(['first', 'asc', 'count'])
      .default('first')
      .meta({ title: 'Order', optionLabels: DISTINCT_SORTS }),
  }),
  label: p => `Distinct ${p.field}`,
});

export const queryJq = defineAction({
  id: 'query.jq',
  title: 'jq',
  group: 'Extract',
  kinds: ['json', 'yaml', 'ndjson', 'records'],
  module: 'jq',
  params: z.object({
    filter: z
      .string()
      .default('.')
      .meta({
        title: 'Filter',
        hint: 'multiline',
        description:
          'A jq program, e.g. .[] | select(.age > 30) | .name  ·  ' +
          'group_by(.team) | map({team: .[0].team, n: length})  ·  ' +
          'map(.price) | add  ·  to_entries | map("\\(.key)=\\(.value)")',
      }),
    raw: z.boolean().default(false).meta({ title: 'Raw output (-r)' }),
    compact: z.boolean().default(false).meta({ title: 'Compact (-c)' }),
    slurp: z.boolean().default(false).meta({
      title: 'Slurp (-s)',
      description: 'Read every input into one array: NDJSON lines or YAML documents',
    }),
    args: z.string().default('').meta({
      title: 'Variables (--arg)',
      hint: 'multiline',
      description: 'One name=value per line, used as $name; name:=JSON for --argjson',
    }),
    timeout: z.number().int().min(1).max(300).default(30).meta({
      title: 'Timeout (seconds)',
      description: 'jq is stopped after this long (some programs, e.g. repeat(.), never end)',
    }),
  }),
  label: p => {
    const filter = p.filter.trim().replace(/\s+/g, ' ');
    return `jq ${filter.length > 40 ? `${filter.slice(0, 39)}…` : filter}`;
  },
});

export const queryActions = [queryGroupBy, queryCountBy, queryDistinct, queryJq];
