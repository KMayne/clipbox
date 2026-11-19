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

const FORMAT_NAMES = {
  mp3: 'MP3',
  m4a: 'M4A (AAC)',
  ogg: 'Ogg (Opus)',
  webm: 'WebM (Opus)',
  flac: 'FLAC',
  wav: 'WAV',
} as const;

/** Short names for the label, e.g. "Convert to MP3 (192 kbps)". */
const LABEL_NAMES = {
  mp3: 'MP3',
  m4a: 'M4A',
  ogg: 'Ogg',
  webm: 'WebM',
  flac: 'FLAC',
  wav: 'WAV',
} as const;

/** Lossless formats ignore the bitrate. */
const LOSSLESS_FORMATS = new Set<string>(['flac', 'wav']);

/** The primary audio track re-encoded (or copied, when it already has the codec). */
export const mediaConvert = defineAction({
  id: 'media.convert',
  title: 'Convert audio',
  group: 'Convert',
  kinds: ['audio'],
  module: 'audiotools',
  params: z.object({
    format: z
      .enum(['mp3', 'm4a', 'ogg', 'webm', 'flac', 'wav'])
      .default('mp3')
      .meta({ title: 'Format', optionLabels: FORMAT_NAMES }),
    // Forms show numbers as free inputs, so the bitrate choices are an enum of strings
    bitrate: z
      .enum(['96', '128', '192', '256', '320'])
      .default('192')
      .meta({
        title: 'Bitrate',
        description: 'Ignored for FLAC and WAV',
        optionLabels: {
          '96': '96 kbps',
          '128': '128 kbps',
          '192': '192 kbps',
          '256': '256 kbps',
          '320': '320 kbps',
        },
      }),
  }),
  label: p =>
    `Convert to ${LABEL_NAMES[p.format]}${LOSSLESS_FORMATS.has(p.format) ? '' : ` (${p.bitrate} kbps)`}`,
});

/** A video's audio track copied out as it is, in a container that suits its codec. */
export const mediaExtractAudio = defineAction({
  id: 'media.extractAudio',
  title: 'Extract audio track',
  group: 'Extract',
  kinds: ['video'],
  module: 'audiotools',
  params: z.object({}),
});

/** "0", "12.5", "1:23", "10%", or with a leading minus, time before the end ("-5", "-0:30"). */
export const TRIM_TIME = /^\s*(-?\s*(\d+:){0,2}\d+(\.\d+)?\s*s?|\d+(\.\d+)?\s*%)\s*$/;
const TRIM_HINT =
  'Use seconds (12.5), m:ss (1:23), a percentage (10%), or -5 for 5 s before the end';

/** "-0:05" → "0:05 before the end"; "" → "end". */
const pointLabel = (text: string, empty: string) => {
  const t = text.trim();
  if (!t) return empty;
  return t.startsWith('-') ? `${t.slice(1).trim()} before the end` : t;
};

/** Keeps one time range ("top and tail"); every track comes along. */
export const mediaTrim = defineAction({
  id: 'media.trim',
  title: 'Trim',
  group: 'Convert',
  kinds: ['audio', 'video'],
  module: 'audiotools',
  params: z.object({
    start: z
      .string()
      .regex(TRIM_TIME, TRIM_HINT)
      .default('0')
      .meta({ title: 'Start', description: 'Seconds, m:ss, a percentage, or -s before the end' }),
    end: z
      .string()
      .regex(new RegExp(`${TRIM_TIME.source}|^\\s*$`), TRIM_HINT)
      .default('')
      .meta({ title: 'End', description: 'Empty for the end; -5 for 5 s before it' }),
    mode: z
      .enum(['fast', 'exact'])
      .default('fast')
      .meta({
        title: 'Cut',
        optionLabels: {
          fast: 'Fast (no re-encode; video may start at a keyframe)',
          exact: 'Exact (re-encodes when needed)',
        },
      }),
  }),
  label: p =>
    `Trim ${pointLabel(p.start, '0')} → ${pointLabel(p.end, 'end')}${p.mode === 'exact' ? ', exact' : ''}`,
});

/** "640×360 at 100, 50"; 0 width or height runs to the frame's edge. */
const cropLabel = (p: { left: number; top: number; width: number; height: number }) => {
  const size = `${p.width || 'full'}×${p.height || 'full'}`;
  return `Crop ${size} at ${p.left}, ${p.top}`;
};

const pixels = (title: string, description?: string) =>
  z
    .number()
    .int()
    .min(0)
    .default(0)
    .meta({ title, ...(description && { description }) });

/** Re-encodes the video to one region of the frame; the audio is copied. */
export const mediaCrop = defineAction({
  id: 'media.crop',
  title: 'Crop video',
  group: 'Convert',
  kinds: ['video'],
  module: 'audiotools',
  params: z.object({
    left: pixels('Left (px)'),
    top: pixels('Top (px)'),
    width: pixels('Width (px)', '0 for the rest of the frame'),
    height: pixels('Height (px)', '0 for the rest of the frame'),
    quality: z
      .enum(['medium', 'high', 'very-high'])
      .default('high')
      .meta({
        title: 'Quality',
        optionLabels: { medium: 'Medium', high: 'High', 'very-high': 'Very high' },
      }),
  }),
  label: cropLabel,
});

const WEBM_CODECS = { vp9: 'VP9', av1: 'AV1', vp8: 'VP8' } as const;

/** The video re-encoded to VP9, AV1 or VP8 with Opus audio in WebM; matching tracks are copied. */
export const mediaToWebm = defineAction({
  id: 'media.toWebm',
  title: 'Convert to WebM',
  group: 'Convert',
  kinds: ['video'],
  module: 'audiotools',
  params: z.object({
    codec: z
      .enum(['vp9', 'av1', 'vp8'])
      .default('vp9')
      .meta({ title: 'Video codec', optionLabels: WEBM_CODECS }),
    quality: z
      .enum(['medium', 'high', 'very-high'])
      .default('high')
      .meta({
        title: 'Quality',
        optionLabels: { medium: 'Medium', high: 'High', 'very-high': 'Very high' },
      }),
  }),
  label: p => `Convert to WebM (${WEBM_CODECS[p.codec]})`,
});

export const mediaActions = [
  mediaNormalise,
  mediaMetadata,
  mediaVideoFrame,
  mediaConvert,
  mediaExtractAudio,
  mediaTrim,
  mediaCrop,
  mediaToWebm,
];
