import { z } from 'zod';
import { defineAction } from '../types';

/** A base URL for resolving relative links; shared by the HTML and Markdown "Extract links". */
export const baseParam = () =>
  z.string().default('').meta({
    title: 'Base URL',
    description:
      "Resolves relative links, e.g. https://example.com/page; else the document's <base>",
  });

export const htmlToMarkdown = defineAction({
  id: 'html.toMarkdown',
  title: 'To Markdown',
  group: 'Convert',
  kinds: ['html'],
  params: z.object({}),
});

export const htmlToText = defineAction({
  id: 'html.toText',
  title: 'To plain text',
  group: 'Convert',
  kinds: ['html'],
  params: z.object({
    linkUrls: z.boolean().default(false).meta({
      title: 'Show link URLs',
      description: 'Writes links as "text (url)"',
    }),
  }),
  label: p => `To plain text${p.linkUrls ? ' (with URLs)' : ''}`,
});

export const htmlExtractLinks = defineAction({
  id: 'html.extractLinks',
  title: 'Extract links',
  group: 'Extract',
  kinds: ['html'],
  params: z.object({ base: baseParam() }),
  label: () => 'Extract links',
});

export const htmlExtractTables = defineAction({
  id: 'html.extractTables',
  title: 'Extract tables',
  group: 'Extract',
  kinds: ['html'],
  params: z.object({}),
});

export const htmlActions = [htmlToMarkdown, htmlToText, htmlExtractLinks, htmlExtractTables];
