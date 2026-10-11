import { z } from 'zod';
import { defineAction } from '../types';

export const IMAGE_FORMATS = { png: 'PNG', jpeg: 'JPEG', webp: 'WebP' };

export const imageConvert = defineAction({
  id: 'image.convert',
  title: 'Convert',
  group: 'Convert',
  kinds: ['image'],
  params: z.object({
    format: z
      .enum(['png', 'jpeg', 'webp'])
      .default('webp')
      .meta({ title: 'Format', optionLabels: IMAGE_FORMATS }),
    quality: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(90)
      .meta({ title: 'Quality', description: 'JPEG and WebP only' }),
  }),
  label: p =>
    `Convert to ${IMAGE_FORMATS[p.format]}${p.format === 'png' ? '' : ` (${p.quality}%)`}`,
});

export const imagePagesAsPng = defineAction({
  id: 'image.pagesAsPng',
  title: 'Pages as PNG',
  group: 'Convert',
  kinds: ['image'],
  params: z.object({}),
});

export const imageActions = [imageConvert, imagePagesAsPng];
