/**
 * "Convert audio": the primary audio track re-encoded into a chosen format with Mediabunny, or
 * copied when it already has the target codec. MP3 (and AAC where WebCodecs has none) comes from
 * an encoder module that the caller registers through `loadEncoder`.
 */
import {
  canEncodeAudio,
  FlacOutputFormat,
  Mp3OutputFormat,
  Mp4OutputFormat,
  OggOutputFormat,
  WavOutputFormat,
  WebMOutputFormat,
  type AudioCodec,
  type ConversionAudioOptions,
  type OutputFormat,
} from 'mediabunny';
import { asM4a, convertInto, withInput } from './conversion';
import type { ConvertFormat, ConvertOptions, ConvertResult, ExtensionCodec } from './service';

interface FormatSpec {
  /** Display name for errors, e.g. "MP3". */
  name: string;
  extension: string;
  mime: string;
  make(): OutputFormat;
  /** The codec written, which may depend on the source's (WAV keeps 24-bit sources 24-bit). */
  codec(source: string | null): AudioCodec;
  lossless: boolean;
}

/** PCM layouts deeper than 16 bits, written as 24-bit WAV. */
const DEEP_PCM = new Set([
  'pcm-s24',
  'pcm-s24be',
  'pcm-s32',
  'pcm-s32be',
  'pcm-f32',
  'pcm-f32be',
  'pcm-f64',
  'pcm-f64be',
]);

export const FORMATS: Record<ConvertFormat, FormatSpec> = {
  mp3: {
    name: 'MP3',
    extension: 'mp3',
    mime: 'audio/mpeg',
    make: () => new Mp3OutputFormat(),
    codec: () => 'mp3',
    lossless: false,
  },
  m4a: {
    name: 'AAC',
    extension: 'm4a',
    mime: 'audio/mp4',
    make: () => new Mp4OutputFormat({ fastStart: 'in-memory' }),
    codec: () => 'aac',
    lossless: false,
  },
  ogg: {
    name: 'Opus',
    extension: 'ogg',
    mime: 'audio/ogg',
    make: () => new OggOutputFormat(),
    codec: () => 'opus',
    lossless: false,
  },
  webm: {
    name: 'Opus',
    extension: 'webm',
    mime: 'audio/webm',
    make: () => new WebMOutputFormat(),
    codec: () => 'opus',
    lossless: false,
  },
  flac: {
    name: 'FLAC',
    extension: 'flac',
    mime: 'audio/flac',
    make: () => new FlacOutputFormat(),
    codec: () => 'flac',
    lossless: true,
  },
  wav: {
    name: 'WAV',
    extension: 'wav',
    mime: 'audio/wav',
    make: () => new WavOutputFormat(),
    codec: source => (source && DEEP_PCM.has(source) ? 'pcm-s24' : 'pcm-s16'),
    lossless: true,
  },
};

/** MPEG-1, 2 and 2.5 Layer III sample rates. */
const MP3_RATES = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000];
/** AAC's sampling frequency index. */
const AAC_RATES = [
  7350, 8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000, 64000, 88200, 96000,
];

/**
 * The sample rate to encode at, or undefined to keep the source's: Opus is always 48 kHz; MP3 and
 * AAC move an unsupported rate to the nearest one of the same family (44.1 kHz for multiples of
 * 11025 Hz, else 48 kHz) at or below the source, capped at 48 kHz for MP3.
 */
export function targetSampleRate(codec: AudioCodec, rate: number): number | undefined {
  if (codec === 'opus') return 48000;
  const allowed = codec === 'mp3' ? MP3_RATES : codec === 'aac' ? AAC_RATES : null;
  if (!allowed || allowed.includes(rate)) return undefined;
  const below = allowed.filter(r => r <= rate);
  const family = below.filter(r => (rate % 11025 === 0) === (r % 11025 === 0));
  return family.at(-1) ?? below.at(-1) ?? allowed[0];
}

/** LAME takes mono or stereo only; more channels are downmixed to stereo. */
const targetChannels = (codec: AudioCodec, channels: number) =>
  codec === 'mp3' && channels > 2 ? 2 : undefined;

const EXTENSIONS: Partial<Record<AudioCodec, ExtensionCodec>> = { mp3: 'mp3', aac: 'aac' };

/**
 * Makes sure Mediabunny can encode `codec` with this layout: WebCodecs first, then the encoder
 * module the caller loads. Returns which one will run.
 */
async function ensureEncoder(
  spec: FormatSpec,
  codec: AudioCodec,
  config: { numberOfChannels: number; sampleRate: number; bitrate?: number },
  loadEncoder: ConvertOptions['loadEncoder'],
): Promise<'native' | 'extension'> {
  if (await canEncodeAudio(codec, config)) return 'native';
  const extension = EXTENSIONS[codec];
  if (extension && loadEncoder) {
    if (!(await loadEncoder(extension)))
      throw new Error(`The ${spec.name} encoder module is unavailable`);
    if (await canEncodeAudio(codec, config)) return 'extension';
  }
  throw new Error(
    `Can't encode ${spec.name} at ${config.sampleRate} Hz with ${config.numberOfChannels} channels`,
  );
}

export async function convert(
  bytes: Uint8Array<ArrayBuffer>,
  options: ConvertOptions,
): Promise<ConvertResult> {
  const { format, bitrate, loadEncoder, signal, progress } = options;
  const spec = FORMATS[format];
  return withInput(bytes, async input => {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error('No audio track');
    const codec = spec.codec(track.codec);
    const copied = track.codec === codec;

    let audio: ConversionAudioOptions = { codec };
    let encoder: ConvertResult['encoder'] = 'none';
    if (!copied) {
      if (!(await track.canDecode()))
        throw new Error(`This browser can't decode ${track.codec ?? 'this'} audio`);
      const sampleRate = targetSampleRate(codec, track.sampleRate);
      const numberOfChannels = targetChannels(codec, track.numberOfChannels);
      audio = {
        codec,
        forceTranscode: true,
        ...(!spec.lossless && { bitrate: bitrate * 1000 }),
        ...(sampleRate !== undefined && { sampleRate }),
        ...(numberOfChannels !== undefined && { numberOfChannels }),
      };
      encoder = await ensureEncoder(
        spec,
        codec,
        {
          numberOfChannels: numberOfChannels ?? track.numberOfChannels,
          sampleRate: sampleRate ?? track.sampleRate,
          ...(!spec.lossless && { bitrate: bitrate * 1000 }),
        },
        loadEncoder,
      );
    }

    const message = copied ? 'Copying' : 'Encoding';
    progress?.(undefined, message);
    const out = await convertInto(
      input,
      spec.make(),
      {
        video: { discard: true },
        // Only the primary track; the formats here hold one audio track at most
        audio: t => (t.id === track.id ? audio : { discard: true }),
        // A copy may shift the packets slightly (e.g. AAC priming), which doesn't matter alone
        ...(copied && { copy: { mode: 'forced', shiftTolerance: Infinity } }),
      },
      {
        signal,
        onProgress: fraction => progress?.(fraction, message),
        needs: t => t.id === track.id,
      },
    );
    return {
      bytes: format === 'm4a' ? asM4a(out) : out,
      mime: spec.mime,
      extension: spec.extension,
      codec,
      copied,
      encoder,
    };
  });
}
