import { z } from 'zod';
import { defineAction } from '../types';
import { baseParam } from './html';

export const markdownToHtml = defineAction({
  id: 'markdown.toHtml',
  title: 'Render to HTML',
  group: 'Convert',
  kinds: ['markdown'],
  params: z.object({
    sanitise: z.boolean().default(true).meta({
      title: 'Sanitise',
      description: 'Removes scripts, event handlers and unsafe links from embedded HTML',
    }),
    document: z.boolean().default(false).meta({
      title: 'Full document',
      description: 'Wraps the HTML in <!doctype html>, <head> and <body>',
    }),
    title: z.string().default('').meta({
      title: 'Document title',
      description: 'For a full document; empty uses the first heading',
    }),
  }),
  label: p =>
    `Render to HTML${p.document ? ' (document)' : ''}${p.sanitise ? '' : ' (unsanitised)'}`,
});

export const markdownToText = defineAction({
  id: 'markdown.toText',
  title: 'To plain text',
  group: 'Convert',
  kinds: ['markdown'],
  params: z.object({
    linkUrls: z.boolean().default(false).meta({
      title: 'Show link URLs',
      description: 'Writes links as "text (url)"',
    }),
  }),
  label: p => `To plain text${p.linkUrls ? ' (with URLs)' : ''}`,
});

export const markdownExtractLinks = defineAction({
  id: 'markdown.extractLinks',
  title: 'Extract links',
  group: 'Extract',
  kinds: ['markdown'],
  params: z.object({ base: baseParam() }),
  label: () => 'Extract links',
});

export const markdownExtractCode = defineAction({
  id: 'markdown.extractCode',
  title: 'Extract code blocks',
  group: 'Extract',
  kinds: ['markdown'],
  params: z.object({}),
});

export const markdownExtractTables = defineAction({
  id: 'markdown.extractTables',
  title: 'Extract tables',
  group: 'Extract',
  kinds: ['markdown'],
  params: z.object({}),
});

export const markdownActions = [
  markdownToHtml,
  markdownToText,
  markdownExtractLinks,
  markdownExtractCode,
  markdownExtractTables,
];
