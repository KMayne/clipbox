import { isRecord } from '../../guards';
import type { MediaContainer } from '../../../modules/media/detect';
import { isAudioTools, type NormaliseResult } from '../../../modules/audiotools/service';
import { mediaNormalise } from '../catalog/media';
import { implement } from '../types';

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
      });
      return {
        mime: result.mime,
        name: normalisedName(content.name, value.kind, result, target),
        bytes: result.bytes,
      };
    },
  }),
];
