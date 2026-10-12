import { isRecord } from '../../guards';
import type { MediaContainer } from '../../../modules/media/detect';
import {
  isAudioConverter,
  isAudioTools,
  isEncoderExtension,
  isVideoFrameTool,
  type ExtensionCodec,
  type FrameOptions,
  type NormaliseResult,
} from '../../../modules/audiotools/service';
import { isMediaService } from '../../../modules/media/service';
import {
  mediaConvert,
  mediaExtractAudio,
  mediaMetadata,
  mediaNormalise,
  mediaVideoFrame,
} from '../catalog/media';
import { implement, type ActionContext } from '../types';
import { textResult, withExtension } from './util';

/**
 * The fields of the media module's value these actions read. A light guard rather than the
 * module's own, so this file doesn't pull music-metadata into the core worker chunk.
 */
interface MediaInfo {
  kind: 'audio' | 'video';
  container: MediaContainer;
  hasVideo: boolean;
}

const isMediaInfo = (v: unknown): v is MediaInfo =>
  isRecord(v) &&
  (v.kind === 'audio' || v.kind === 'video') &&
  typeof v.container === 'string' &&
  typeof v.hasVideo === 'boolean';

/** Containers Mediabunny can read (and write, or remux into a fallback). Not AVI. */
const NORMALISABLE = new Set<string>([
  'wav',
  'mp3',
  'ogg',
  'flac',
  'm4a',
  'mp4',
  'mov',
  'webm',
  'mkv',
]);

/** One decimal, without "-0.0". */
const fmt = (n: number) => {
  const s = n.toFixed(1);
  return s === '-0.0' ? '0.0' : s;
};
const signed = (n: number) => (n >= 0 ? `+${fmt(n)}` : fmt(n));
/** "-14", "-14.5": the setting as typed. */
const setting = (n: number) => String(Math.round(n * 10) / 10);

/**
 * "song (normalised -14 LUFS; was -23.1 LUFS, +9.1 dB).wav". When the result misses the target
 * (the gain was capped by the true-peak ceiling), the measured loudness is shown instead.
 */
export function normalisedName(
  name: string | undefined,
  fallback: string,
  result: NormaliseResult,
  target: number,
): string {
  const stem = (name ? name.replace(/\.[^./\\]*$/, '') : '') || fallback;
  const reached = Math.abs(result.after.integrated - target) < 0.5;
  const what = result.capped
    ? `normalised ${fmt(result.after.integrated)} LUFS, peak-capped below ${setting(target)}`
    : reached
      ? `normalised ${setting(target)} LUFS${result.limited ? ', limited' : ''}`
      : `normalised ${fmt(result.after.integrated)} LUFS${result.limited ? ', limited' : ''}`;
  const keepExt = result.sameContainer && name ? /\.([^./\\]+)$/.exec(name)?.[1] : undefined;
  const ext = keepExt ?? result.extension;
  return `${stem} (${what}; was ${fmt(result.before.integrated)} LUFS, ${signed(result.gainDb)} dB).${ext}`;
}

/** "clip.mp4" → "clip (audio).m4a". */
export function extractedName(name: string | undefined, extension: string): string {
  const stem = (name ? name.replace(/\.[^./\\]*$/, '') : '') || 'video';
  return `${stem} (audio).${extension}`;
}

/** Registers an encoder module's encoder with Mediabunny; false when the module can't load. */
const encoderLoader = (ctx: ActionContext) => async (codec: ExtensionCodec) => {
  const extension = await ctx.service(
    codec === 'mp3' ? 'mp3encoder' : 'aacencoder',
    isEncoderExtension,
  );
  extension?.register();
  return !!extension;
};

export const mediaImpls = [
  implement(mediaNormalise, {
    value: isMediaInfo,
    applies: ({ value }) =>
      NORMALISABLE.has(value.container) && !(value.container === 'ogg' && value.hasVideo),
    async run({ value, content }, { target, ceiling, limit }, ctx) {
      const tools = await ctx.service('audiotools', isAudioTools);
      if (!tools) throw new Error('The audio tools module is unavailable');
      const result = await tools.normalise(content.bytes, {
        target,
        ceiling,
        limit,
        signal: ctx.signal,
        progress: ctx.progress,
      });
      return {
        mime: result.mime,
        name: normalisedName(content.name, value.kind, result, target),
        bytes: result.bytes,
      };
    },
  }),
  implement(mediaConvert, {
    value: isMediaInfo,
    applies: ({ value }) => NORMALISABLE.has(value.container),
    async run({ content }, { format, bitrate }, ctx) {
      const tools = await ctx.service('audiotools', isAudioConverter);
      if (!tools) throw new Error('The audio tools module is unavailable');
      const result = await tools.convert(content.bytes, {
        format,
        bitrate: Number(bitrate),
        loadEncoder: encoderLoader(ctx),
        signal: ctx.signal,
        progress: ctx.progress,
      });
      return {
        mime: result.mime,
        name: withExtension(content.name, result.extension, 'audio'),
        bytes: result.bytes,
        ...(result.copied && { note: 'copied, not re-encoded' }),
      };
    },
  }),
  implement(mediaExtractAudio, {
    value: isMediaInfo,
    applies: ({ value }) => value.hasVideo && NORMALISABLE.has(value.container),
    async run({ content }, _params, ctx) {
      const tools = await ctx.service('audiotools', isAudioConverter);
      if (!tools) throw new Error('The audio tools module is unavailable');
      const result = await tools.extractAudio(content.bytes, {
        signal: ctx.signal,
        progress: ctx.progress,
      });
      return {
        mime: result.mime,
        name: extractedName(content.name, result.extension),
        bytes: result.bytes,
      };
    },
  }),
  implement(mediaMetadata, {
    value: isMediaInfo,
    async run({ value, content }, _params, ctx) {
      const media = await ctx.service('media', isMediaService);
      if (!media) throw new Error("The audio/video module isn't available");
      const meta = await media.metadata(value);
      const stem = (content.name ?? '').replace(/\.[^./\\]*$/, '') || value.kind;
      return textResult(
        `${JSON.stringify(meta, null, 2)}\n`,
        'application/json',
        `${stem}-metadata.json`,
      );
    },
  }),
  implement(mediaVideoFrame, {
    value: isMediaInfo,
    // Mediabunny can't read AVI; Ogg video is Theora, which WebCodecs can't decode
    applies: ({ value }) =>
      value.hasVideo && NORMALISABLE.has(value.container) && value.container !== 'ogg',
    async run({ content }, { time }, ctx) {
      const at = parseFrameTime(time);
      const tools = await ctx.service('audiotools', isVideoFrameTool);
      if (!tools) throw new Error('The audio tools module is unavailable');
      const frame = await tools.videoFrame(content.bytes, {
        at,
        signal: ctx.signal,
        progress: ctx.progress,
      });
      const stem = (content.name ?? '').replace(/\.[^./\\]*$/, '') || 'video';
      return {
        mime: 'image/png',
        name: `${stem} (frame at ${Math.round(frame.timestamp * 100) / 100}s).png`,
        bytes: frame.bytes,
      };
    },
  }),
];

/** "12.5" → 12.5 s, "1:02:03.5" → 3723.5 s, "10%" → a tenth of the way through. */
export function parseFrameTime(text: string): FrameOptions['at'] {
  const t = text.trim().replace(/\s*s$/, '');
  if (t.endsWith('%')) {
    const pct = Number(t.slice(0, -1).trim());
    if (!Number.isFinite(pct) || pct > 100) throw new Error(`Invalid percentage '${text.trim()}'`);
    return { fraction: pct / 100 };
  }
  const parts = t.split(':').map(Number);
  if (!parts.length || parts.some(n => !Number.isFinite(n))) {
    throw new Error(`Invalid time '${text.trim()}'`);
  }
  return { seconds: parts.reduce((acc, n) => acc * 60 + n, 0) };
}
