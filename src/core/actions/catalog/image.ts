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

const SIZE_LABELS = { '75': '75%', '50': '50%', '25': '25%', custom: 'Width / height' };

export const imageResize = defineAction({
  id: 'image.resize',
  title: 'Resize',
  group: 'Convert',
  kinds: ['image'],
  params: z.object({
    size: z
      .enum(['75', '50', '25', 'custom'])
      .default('50')
      .meta({ title: 'Size', optionLabels: SIZE_LABELS }),
    width: z
      .number()
      .int()
      .min(0)
      .max(16_384)
      .default(0)
      .meta({ title: 'Width (px)', description: 'For Width / height; 0 to follow the height' }),
    height: z
      .number()
      .int()
      .min(0)
      .max(16_384)
      .default(0)
      .meta({ title: 'Height (px)', description: 'For Width / height; 0 to follow the width' }),
    keepAspect: z.boolean().default(true).meta({
      title: 'Keep aspect ratio',
      description: 'With both set, fits inside them',
    }),
  }),
  label: p => {
    if (p.size !== 'custom') return `Resize to ${p.size}%`;
    const side = (n: number) => (n ? String(n) : 'auto');
    return `Resize to ${side(p.width)}×${side(p.height)}${p.keepAspect ? '' : ' (stretched)'}`;
  },
});

export const TRANSFORM_LABELS = {
  cw: 'Rotate 90° clockwise',
  '180': 'Rotate 180°',
  ccw: 'Rotate 90° anticlockwise',
  flipH: 'Flip horizontally',
  flipV: 'Flip vertically',
};

export const imageRotate = defineAction({
  id: 'image.rotate',
  title: 'Rotate / flip',
  group: 'Convert',
  kinds: ['image'],
  params: z.object({
    op: z
      .enum(['cw', '180', 'ccw', 'flipH', 'flipV'])
      .default('cw')
      .meta({ title: 'Transform', optionLabels: TRANSFORM_LABELS }),
  }),
  label: p => TRANSFORM_LABELS[p.op],
});

export const imageDataUrl = defineAction({
  id: 'image.dataUrl',
  title: 'To data URL',
  group: 'Encode',
  kinds: ['image'],
  params: z.object({}),
});

/** Chromium's BarcodeDetector: QR, EAN, Code 128… where the platform provides it. */
export const imageReadCodes = defineAction({
  id: 'image.readCodes',
  title: 'Read QR / barcode',
  group: 'Extract',
  kinds: ['image'],
  params: z.object({}),
});

export const imagePalette = defineAction({
  id: 'image.palette',
  title: 'Extract palette',
  group: 'Extract',
  kinds: ['image'],
  params: z.object({
    count: z.number().int().min(1).max(16).default(6).meta({ title: 'Colours' }),
  }),
  label: p => `Extract palette (${p.count})`,
});

export const imageActions = [
  imageConvert,
  imageResize,
  imageRotate,
  imageDataUrl,
  imageReadCodes,
  imagePalette,
];
