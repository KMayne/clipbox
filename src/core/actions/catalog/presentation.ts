import { z } from 'zod';
import { rangeParam } from '../extract';
import { defineAction } from '../types';

export const presentationExtractImages = defineAction({
  id: 'presentation.extractImages',
  title: 'Extract images',
  group: 'Extract',
  kinds: ['presentation'],
  params: z.object({
    slides: rangeParam('Slides'),
    convert: z.boolean().default(false).meta({
      title: 'Convert vector/legacy images to PNG',
      description: 'EMF, WMF and TIFF pictures as PNG renders instead of the original files',
    }),
  }),
  label: p =>
    `Extract images${p.slides.trim() ? ` (slides ${p.slides.trim()})` : ''}${p.convert ? ' as PNG' : ''}`,
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
