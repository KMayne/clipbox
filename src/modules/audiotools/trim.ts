/**
 * "Trim": keeps one time range of the input, every track included, in the same container where
 * Mediabunny can write it (else Matroska). A fast cut copies packets, so video starts at the
 * keyframe at or before the start (lossless audio is still cut exactly); an exact cut re-encodes
 * the tracks that don't line up.
 */
import {
  ALL_FORMATS,
  BufferSource,
  canEncodeAudio,
  Input,
  MkvOutputFormat,
  PCM_AUDIO_CODECS,
  type InputAudioTrack,
} from 'mediabunny';
import { pointSeconds } from '../../core/mediaTime';
import { throwIfAborted } from '../../core/progress';
import { asM4a, convertInto, outputMime, sameFormat, withInput } from './conversion';
import type { ExtensionCodec, TimePoint, TrimOptions, TrimResult } from './service';

const fmt = (s: number) => `${Math.round(s * 100) / 100} s`;

/** Checks and clamps a requested range; throws when it's empty or outside the media. */
export function resolveRange(
  start: TimePoint,
  end: TimePoint | undefined,
  first: number,
  duration: number,
): { start: number; end: number } {
  const from = Math.max(first, pointSeconds(start, first, duration));
  const to = Math.min(duration, end ? pointSeconds(end, first, duration) : duration);
  if (from >= duration) {
    throw new Error(`The start (${fmt(from)}) is at or past the end (${fmt(duration)})`);
  }
  if (to <= from) throw new Error(`The end (${fmt(to)}) must be after the start (${fmt(from)})`);
  return { start: from, end: to };
}

/**
 * How long an output file plays. Copied video may keep the frames from the keyframe on, before
 * zero (an MP4 edit list), which players decode but don't show.
 */
async function durationOf(bytes: Uint8Array<ArrayBuffer>): Promise<number> {
  const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
  try {
    return (await input.computeDuration()) - Math.max(0, await input.getFirstTimestamp());
  } finally {
    input.dispose();
  }
}

const LOSSLESS = new Set<string>([...PCM_AUDIO_CODECS, 'flac']);

/**
 * Lossless audio is cut exactly even in a fast cut: its packets can be long (a WAV's run to
 * tenths of a second), and re-encoding it loses nothing.
 */
async function recutLossless(track: InputAudioTrack): Promise<boolean> {
  const codec = track.codec;
  if (!codec || !LOSSLESS.has(codec)) return false;
  return canEncodeAudio(codec, {
    numberOfChannels: track.numberOfChannels,
    sampleRate: track.sampleRate,
  });
}

const EXTENSIONS: Partial<Record<string, ExtensionCodec>> = { mp3: 'mp3', aac: 'aac' };

export function trim(bytes: Uint8Array<ArrayBuffer>, options: TrimOptions): Promise<TrimResult> {
  const { exact, loadEncoder, signal, progress } = options;
  return withInput(bytes, async input => {
    const tracks = await input.getTracks();
    if (!tracks.some(t => t.type === 'audio' || t.type === 'video')) {
      throw new Error('No audio or video track');
    }
    const hasVideo = tracks.some(t => t.type === 'video');
    const first = await input.getFirstTimestamp();
    const duration = await input.computeDuration();
    const range = resolveRange(options.start, options.end, first, duration);

    // An exact cut may re-encode MP3 or AAC, which WebCodecs can't always do
    const audio = await input.getPrimaryAudioTrack();
    const extension = audio?.codec ? EXTENSIONS[audio.codec] : undefined;
    if (exact && audio && extension && loadEncoder) {
      const config = { numberOfChannels: audio.numberOfChannels, sampleRate: audio.sampleRate };
      if (!(await canEncodeAudio(extension, config))) await loadEncoder(extension);
    }

    const inputFormat = await input.getFormat();
    const same = sameFormat(inputFormat);
    const format = same ? same() : new MkvOutputFormat();
    const message = exact ? 'Cutting exactly' : 'Copying';
    throwIfAborted(signal);
    progress?.(undefined, message);
    const out = await convertInto(
      input,
      format,
      {
        trim: range,
        // Fast: copy, widening the range out to keyframes and packet edges. Exact: copy only
        // where the packets line up with the cut, else re-encode.
        copy: exact ? { boundaryTolerance: 0 } : { shiftTolerance: Infinity },
        ...(!exact && {
          audio: async (t: InputAudioTrack) =>
            (await recutLossless(t)) ? { forceTranscode: true } : {},
        }),
      },
      {
        signal,
        onProgress: fraction => progress?.(fraction, message),
        needs: t => t.type === 'audio' || t.type === 'video',
      },
    );
    const isMp4 = format.fileExtension === '.mp4';
    const result = !hasVideo && isMp4 ? asM4a(out) : out;
    return {
      bytes: result,
      mime: outputMime(format, hasVideo),
      extension: same ? format.fileExtension.slice(1) : hasVideo ? 'mkv' : 'mka',
      sameContainer: !!same,
      start: range.start,
      end: range.end,
      duration: await durationOf(result),
    };
  });
}
