import { z } from 'zod';
import { rangeParam } from '../extract';
import { defineAction } from '../types';

export const pdfExtractImages = defineAction({
  id: 'pdf.extractImages',
  title: 'Extract images',
  group: 'Extract',
  kinds: ['pdf'],
  module: 'pdf',
  params: z.object({
    pages: rangeParam('Pages'),
    minSize: z
      .number()
      .int()
      .min(1)
      .max(10_000)
      .default(32)
      .meta({ title: 'Minimum size (px)', description: 'Skips smaller images, e.g. bullets' }),
  }),
  label: p => (p.pages.trim() ? `Extract images (pages ${p.pages.trim()})` : 'Extract images'),
});

/** Info dictionary, XMP, page count and sizes, outline and attachments. */
export const pdfMetadata = defineAction({
  id: 'pdf.metadata',
  title: 'Metadata as JSON',
  group: 'Inspect',
  kinds: ['pdf'],
  module: 'pdf',
  params: z.object({}),
});

export const pdfActions = [pdfExtractImages, pdfMetadata];
