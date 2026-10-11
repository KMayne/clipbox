import { z } from 'zod';
import { rangeParam } from '../extract';
import { defineAction } from '../types';

export const presentationExtractImages = defineAction({
  id: 'presentation.extractImages',
  title: 'Extract images',
  group: 'Extract',
  kinds: ['presentation'],
  params: z.object({ slides: rangeParam('Slides') }),
  label: p => (p.slides.trim() ? `Extract images (slides ${p.slides.trim()})` : 'Extract images'),
});

export const presentationExtractText = defineAction({
  id: 'presentation.extractText',
  title: 'Extract text',
  group: 'Extract',
  kinds: ['presentation'],
  params: z.object({
    notes: z.boolean().default(true).meta({ title: 'Include speaker notes' }),
  }),
  label: p => `Extract text${p.notes ? '' : ' (no notes)'}`,
});

export const presentationSlidesJson = defineAction({
  id: 'presentation.slidesJson',
  title: 'Slides as JSON',
  group: 'Convert',
  kinds: ['presentation'],
  params: z.object({}),
});

export const presentationActions = [
  presentationExtractImages,
  presentationExtractText,
  presentationSlidesJson,
];
