import { z } from 'zod';
import { defineAction } from '../types';

export const emailAttachments = defineAction({
  id: 'email.attachments',
  title: 'Attachments',
  group: 'Extract',
  kinds: ['email'],
  params: z.object({
    inline: z.boolean().default(false).meta({
      title: 'Include inline images',
      description: 'Pictures shown inside the HTML body (cid: images)',
    }),
  }),
  label: p => `Attachments${p.inline ? ' (with inline images)' : ''}`,
});

export const emailBodyText = defineAction({
  id: 'email.bodyText',
  title: 'Body as text',
  group: 'Convert',
  kinds: ['email'],
  params: z.object({}),
});

export const emailBodyMarkdown = defineAction({
  id: 'email.bodyMarkdown',
  title: 'Body as Markdown',
  group: 'Convert',
  kinds: ['email'],
  params: z.object({}),
});

export const emailHeadersJson = defineAction({
  id: 'email.headersJson',
  title: 'Headers as JSON',
  group: 'Extract',
  kinds: ['email'],
  params: z.object({}),
});

export const emailReceivedChain = defineAction({
  id: 'email.receivedChain',
  title: 'Received chain',
  group: 'Inspect',
  kinds: ['email'],
  params: z.object({
    format: z
      .enum(['csv', 'json'])
      .default('csv')
      .meta({ title: 'Format', optionLabels: { csv: 'CSV', json: 'JSON' } }),
  }),
  label: p => `Received chain${p.format === 'json' ? ' (JSON)' : ''}`,
});

export const emailActions = [
  emailAttachments,
  emailBodyText,
  emailBodyMarkdown,
  emailHeadersJson,
  emailReceivedChain,
];
