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

export const pdfActions = [pdfExtractImages];
