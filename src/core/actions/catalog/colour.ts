import { z } from 'zod';
import { defineAction } from '../types';

export const COLOUR_FORMATS = { hex: 'Hex', rgb: 'rgb()', hsl: 'hsl()', oklch: 'oklch()' };

export const colourConvert = defineAction({
  id: 'colour.convert',
  title: 'Convert to',
  group: 'Convert',
  kinds: ['colour'],
  params: z.object({
    to: z
      .enum(['hex', 'rgb', 'hsl', 'oklch'])
      .default('hex')
      .meta({ title: 'Format', optionLabels: COLOUR_FORMATS }),
  }),
  label: p => `Convert to ${COLOUR_FORMATS[p.to]}`,
});

export const colourContrast = defineAction({
  id: 'colour.contrast',
  title: 'Contrast check',
  group: 'Inspect',
  kinds: ['colour'],
  params: z.object({
    against: z.string().default('').meta({
      title: 'Second colour',
      description: 'Optional, e.g. #1e1e2e: checks the pair too',
    }),
  }),
  label: p =>
    p.against.trim() ? `Contrast vs ${p.against.trim().slice(0, 24)}` : 'Contrast check',
});

export const colourActions = [colourConvert, colourContrast];
