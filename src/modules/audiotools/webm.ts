/**
 * "Convert to WebM": the primary video track in VP9, AV1 or VP8 and the primary audio track in
 * Opus, in a WebM file. A track that already has a codec WebM takes (the chosen video codec;
 * Opus or Vorbis audio) is copied rather than re-encoded.
 */
import {
  canEncodeAudio,
  canEncodeVideo,
  QUALITY_HIGH,
  QUALITY_MEDIUM,
  QUALITY_VERY_HIGH,
  WebMOutputFormat,
  type ConversionAudioOptions,
  type ConversionVideoOptions,
  type Quality,
} from 'mediabunny';
import { throwIfAborted } from '../../core/progress';
import { convertInto, outputMime, withInput } from './conversion';
import type { WebmOptions, WebmResult } from './service';

const QUALITIES: Record<WebmOptions['quality'], Quality> = {
  medium: QUALITY_MEDIUM,
  high: QUALITY_HIGH,
  'very-high': QUALITY_VERY_HIGH,
};

const CODEC_NAMES: Record<WebmOptions['codec'], string> = { vp9: 'VP9', av1: 'AV1', vp8: 'VP8' };

/** Audio codecs WebM holds, which are copied as they are. */
const WEBM_AUDIO = new Set(['opus', 'vorbis']);

/** Opus at stereo-transparent rates; more channels get a little more each. */
const opusBitrate = (channels: number) => (channels > 2 ? 64_000 * channels : 128_000);

export function toWebm(bytes: Uint8Array<ArrayBuffer>, options: WebmOptions): Promise<WebmResult> {
  const { codec, quality, signal, progress } = options;
  return withInput(bytes, async input => {
    const video = await input.getPrimaryVideoTrack();
    if (!video) throw new Error('There is no video track');
    const videoCopied = video.codec === codec;
    let videoOptions: ConversionVideoOptions = { codec };
    if (!videoCopied) {
      if (!(await video.canDecode())) {
        throw new Error(`This browser can't decode ${video.codec ?? 'this'} video`);
      }
      const size = { width: video.displayWidth, height: video.displayHeight };
      if (!(await canEncodeVideo(codec, size))) {
        throw new Error(
          `This browser can't encode ${CODEC_NAMES[codec]} at ${size.width}×${size.height}`,
        );
      }
      videoOptions = { codec, quality: QUALITIES[quality], forceTranscode: true };
    }

    const audio = await input.getPrimaryAudioTrack();
    let audioOptions: ConversionAudioOptions = {};
    if (audio && !(audio.codec && WEBM_AUDIO.has(audio.codec))) {
      if (!(await audio.canDecode())) {
        throw new Error(`This browser can't decode ${audio.codec ?? 'this'} audio`);
      }
      const bitrate = opusBitrate(audio.numberOfChannels);
      const config = { numberOfChannels: audio.numberOfChannels, sampleRate: 48000, bitrate };
      if (!(await canEncodeAudio('opus', config))) {
        throw new Error(`This browser can't encode Opus with ${audio.numberOfChannels} channels`);
      }
      audioOptions = { codec: 'opus', sampleRate: 48000, bitrate, forceTranscode: true };
    }

    const format = new WebMOutputFormat();
    throwIfAborted(signal);
    const message = videoCopied && !audioOptions.codec ? 'Copying' : 'Encoding';
    progress?.(undefined, message);
    const out = await convertInto(
      input,
      format,
      {
        video: t => (t.id === video.id ? videoOptions : { discard: true }),
        audio: t => (audio && t.id === audio.id ? audioOptions : { discard: true }),
      },
      {
        signal,
        onProgress: fraction => progress?.(fraction, message),
        needs: t => t.id === video.id || t.id === audio?.id,
      },
    );
    return { bytes: out, mime: outputMime(format, true), videoCopied };
  });
}
