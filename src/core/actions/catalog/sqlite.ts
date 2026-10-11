import { z } from 'zod';
import { defineAction } from '../types';

export const sqliteTableJson = defineAction({
  id: 'sqlite.tableJson',
  title: 'Table as JSON',
  group: 'Convert',
  kinds: ['sqlite'],
  module: 'sqlite',
  params: z.object({
    table: z.string().default('').meta({
      title: 'Table',
      description: 'Name or number (1 is the first); empty for the first',
    }),
  }),
  label: p => (p.table.trim() ? `Table ${p.table.trim()} as JSON` : 'Table as JSON'),
});

/** Every CREATE statement in sqlite_master: tables first, then indexes, views and triggers. */
export const sqliteSchema = defineAction({
  id: 'sqlite.schema',
  title: 'Schema as SQL',
  group: 'Extract',
  kinds: ['sqlite'],
  params: z.object({}),
});

export const sqliteActions = [sqliteTableJson, sqliteSchema];
