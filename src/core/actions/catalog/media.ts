import { z } from 'zod';
import { defineAction } from '../types';

/** Two-pass loudness normalisation (BS.1770 / EBU R128); video tracks are copied untouched. */
export const mediaNormalise = defineAction({
  id: 'media.normalise',
  title: 'Normalise audio',
  group: 'Convert',
  kinds: ['audio', 'video'],
  module: 'audiotools',
  params: z.object({
    target: z
      .number()
      .min(-36)
      .max(-5)
      .default(-14)
      .meta({ title: 'Target loudness (LUFS)', description: 'Integrated, per EBU R128' }),
    ceiling: z.number().min(-12).max(0).default(-1).meta({ title: 'True-peak ceiling (dBTP)' }),
    limit: z.boolean().default(false).meta({
      title: 'Limit peaks',
      description: 'Reach the target with a true-peak limiter instead of lowering the gain',
    }),
  }),
  label: p => `Normalise to ${p.target} LUFS${p.limit ? ', limited' : ''}`,
});

/** Container, streams and every tag music-metadata reads (pictures described, not embedded). */
export const mediaMetadata = defineAction({
  id: 'media.metadata',
  title: 'Metadata as JSON',
  group: 'Inspect',
  kinds: ['audio', 'video'],
  module: 'media',
  params: z.object({}),
});

/** "10%", "12.5", "12.5s", "1:23", "1:02:03.5". */
export const FRAME_TIME = /^\s*(\d+(\.\d+)?\s*%|(\d+:){0,2}\d+(\.\d+)?\s*s?)\s*$/;

export const mediaVideoFrame = defineAction({
  id: 'media.videoFrame',
  title: 'Video frame as PNG',
  group: 'Extract',
  kinds: ['video'],
  module: 'audiotools',
  params: z.object({
    time: z
      .string()
      .regex(FRAME_TIME, 'Use seconds (12.5), m:ss (1:23) or a percentage (10%)')
      .default('10%')
      .meta({ title: 'Time', description: 'Seconds, m:ss, or a percentage of the way through' }),
  }),
  label: p => `Frame at ${p.time.trim()}`,
});

export const mediaActions = [mediaNormalise, mediaMetadata, mediaVideoFrame];
