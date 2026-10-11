/**
 * Two-pass loudness normalisation with Mediabunny: pass 1 decodes the primary audio track and
 * measures it; pass 2 is a Mediabunny Conversion that copies the other tracks (video included)
 * and re-encodes only that audio track, scaling each decoded chunk on the way through.
 */
import {
  ADTS,
  ALL_FORMATS,
  AdtsOutputFormat,
  AudioSample,
  AudioSampleSink,
  BufferSource,
  BufferTarget,
  canEncodeAudio,
  Conversion,
  FLAC,
  FlacOutputFormat,
  Input,
  MATROSKA,
  MkvOutputFormat,
  MovOutputFormat,
  MP3,
  Mp3OutputFormat,
  MP4,
  Mp4OutputFormat,
  OGG,
  OggOutputFormat,
  Output,
  QTFF,
  WAVE,
  WavOutputFormat,
  WEBM,
  WebMOutputFormat,
  type AudioCodec,
  type InputAudioTrack,
  type InputFormat,
  type OutputFormat,
} from 'mediabunny';
import { throwIfAborted } from '../../core/progress';
import { GainCurve, planGain, planLimited } from './limiter';
import { LoudnessMeter, type SubBlocks } from './loudness';
import type { NormaliseOptions, NormaliseResult } from './service';
import { toDb, TruePeakMeter } from './truePeak';

/** Planar float32 copies of a decoded chunk's channels. */
function planesOf(sample: AudioSample): Float32Array[] {
  return Array.from({ length: sample.numberOfChannels }, (_, c) => {
    const plane = new Float32Array(sample.numberOfFrames);
    sample.copyTo(plane, { planeIndex: c, format: 'f32-planar' });
    return plane;
  });
}

type Progress = NonNullable<NormaliseOptions['progress']>;

/** Reports a pass's progress as decoded time over the track's span. */
function passProgress(
  progress: Progress | undefined,
  message: string,
  span: { start: number; end: number },
) {
  const length = span.end - span.start;
  return (sample: AudioSample) =>
    progress?.(
      length > 0 ? (sample.timestamp + sample.duration - span.start) / length : undefined,
      message,
    );
}

interface Analysis {
  integrated: number;
  truePeak: number;
  sampleRate: number;
  blocks: SubBlocks;
  /** Per-sub-block true peaks; only kept when the limiter needs them. */
  peaks: Float32Array | null;
}

/** Pass 1: decode and measure. Each chunk is measured then dropped, so memory stays flat. */
async function analyse(
  track: InputAudioTrack,
  keepPeaks: boolean,
  signal: AbortSignal | undefined,
  report: (sample: AudioSample) => void,
): Promise<Analysis> {
  let loudness: LoudnessMeter | null = null;
  let peaks: TruePeakMeter | null = null;
  for await (const sample of new AudioSampleSink(track).samples()) {
    try {
      throwIfAborted(signal);
      report(sample);
      loudness ??= new LoudnessMeter(sample.sampleRate, sample.numberOfChannels);
      peaks ??= new TruePeakMeter(sample.numberOfChannels, keepPeaks ? loudness.frames : undefined);
      const planes = planesOf(sample);
      loudness.push(planes);
      peaks.push(planes);
    } finally {
      sample.close();
    }
  }
  if (!loudness || !peaks) throw new Error('The audio track has no samples');
  peaks.flush();
  return {
    integrated: loudness.integrated(),
    truePeak: toDb(peaks.truePeak),
    sampleRate: loudness.sampleRate,
    blocks: loudness.subBlocks(),
    peaks: keepPeaks ? peaks.subBlockPeaks() : null,
  };
}

const LOSSLESS = new Set<string>(['flac']);
const isLossless = (codec: string | null) =>
  !!codec && (codec.startsWith('pcm-') || LOSSLESS.has(codec));

/**
 * Output codec preference: the source codec, then lossless ones for lossless sources (FLAC, then
 * 16-bit PCM), then lossy ones (AAC, Opus, MP3, Vorbis), limited to what `format` can hold.
 */
export function codecPreference(supported: readonly string[], source: string | null): string[] {
  const lossless = ['flac', 'pcm-s16', 'pcm-s24', 'pcm-f32'];
  const lossy = ['aac', 'opus', 'mp3', 'vorbis'];
  const order = [
    ...(source ? [source] : []),
    ...(isLossless(source) ? [...lossless, ...lossy] : [...lossy, ...lossless]),
  ];
  return [...new Set(order)].filter(c => supported.includes(c));
}

const audioCodecs = (format: OutputFormat): AudioCodec[] => format.getSupportedAudioCodecs();

async function encodable(codec: AudioCodec, channels: number, sampleRate: number) {
  // Mediabunny resamples to 48 kHz stereo when an encoder rejects the source layout (e.g. Opus)
  return (
    (await canEncodeAudio(codec, { numberOfChannels: channels, sampleRate })) ||
    (await canEncodeAudio(codec, { numberOfChannels: 2, sampleRate: 48000 }))
  );
}

interface Target {
  makeFormat: () => OutputFormat;
  codec: AudioCodec;
  sameContainer: boolean;
}

/** An output format like the input's, or null for inputs Mediabunny can read but not write. */
function sameFormat(input: InputFormat): (() => OutputFormat) | null {
  if (input === MP4) return () => new Mp4OutputFormat({ fastStart: 'in-memory' });
  if (input === QTFF) return () => new MovOutputFormat({ fastStart: 'in-memory' });
  if (input === WEBM) return () => new WebMOutputFormat();
  if (input === MATROSKA) return () => new MkvOutputFormat();
  if (input === WAVE) return () => new WavOutputFormat();
  if (input === OGG) return () => new OggOutputFormat();
  if (input === FLAC) return () => new FlacOutputFormat();
  if (input === MP3) return () => new Mp3OutputFormat();
  if (input === ADTS) return () => new AdtsOutputFormat();
  return null;
}

/**
 * Keeps the container and codec when the browser can encode it. Otherwise: audio goes to Opus in
 * Ogg for lossy sources (WAV if Opus isn't available) and WAV for lossless ones; video goes to
 * Matroska, which takes any video codec, so the video track can still be copied.
 */
async function chooseTarget(
  inputFormat: InputFormat,
  track: InputAudioTrack,
  hasVideo: boolean,
): Promise<Target> {
  const channels = track.numberOfChannels;
  const rate = track.sampleRate;
  const source = track.codec;
  const candidates: { make: () => OutputFormat; same: boolean }[] = [];
  const same = sameFormat(inputFormat);
  if (same) candidates.push({ make: same, same: true });
  if (hasVideo) candidates.push({ make: () => new MkvOutputFormat(), same: false });
  else {
    if (!isLossless(source)) candidates.push({ make: () => new OggOutputFormat(), same: false });
    candidates.push({ make: () => new WavOutputFormat(), same: false });
  }
  for (const { make, same: sameContainer } of candidates) {
    const format = make();
    const supported = audioCodecs(format);
    for (const name of codecPreference(supported, source)) {
      const codec = supported.find(c => c === name);
      if (codec && (await encodable(codec, channels, rate)))
        return { makeFormat: make, codec, sameContainer };
    }
  }
  throw new Error(`This browser can't encode audio for this file`);
}

export async function normalise(
  bytes: Uint8Array<ArrayBuffer>,
  options: NormaliseOptions,
): Promise<NormaliseResult> {
  const { target, ceiling, limit, signal, progress } = options;
  const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error('No audio track');
    if (!(await track.canDecode()))
      throw new Error(`This browser can't decode ${track.codec ?? 'this'} audio`);
    const hasVideo = (await input.getVideoTracks()).length > 0;

    const span = { start: await track.getFirstTimestamp(), end: await track.computeDuration() };
    const analysis = await analyse(
      track,
      limit,
      signal,
      passProgress(progress, 'Pass 1 of 2 · measuring loudness', span),
    );
    throwIfAborted(signal);
    const plan = planGain({
      integrated: analysis.integrated,
      truePeakDb: analysis.truePeak,
      target,
      ceiling,
      limit,
    });
    const needsLimiter = limit && analysis.truePeak + plan.gainDb > ceiling;
    const limited =
      needsLimiter && analysis.peaks
        ? planLimited({
            blocks: analysis.blocks,
            peaks: analysis.peaks,
            integrated: analysis.integrated,
            target,
            ceiling,
          })
        : null;
    const gainDb = limited?.gainDb ?? plan.gainDb;
    const curve = new GainCurve(
      gainDb,
      limited?.envelope ?? null,
      analysis.sampleRate / analysis.blocks.frames,
    );

    const destination = await chooseTarget(await input.getFormat(), track, hasVideo);
    const format = destination.makeFormat();
    const output = new Output({ format, target: new BufferTarget() });

    // Pass 2: scale and re-measure each chunk before it goes to the encoder
    // An object, so TypeScript doesn't narrow these to null across the callback
    const after: {
      start: number | null;
      loudness: LoudnessMeter | null;
      peak: TruePeakMeter | null;
    } = { start: null, loudness: null, peak: null };
    const report = passProgress(progress, 'Pass 2 of 2 · encoding', span);
    const process = (sample: AudioSample) => {
      throwIfAborted(signal);
      report(sample);
      after.start ??= sample.timestamp;
      const planes = planesOf(sample);
      curve.apply(planes, sample.timestamp - after.start, sample.sampleRate);
      after.loudness ??= new LoudnessMeter(sample.sampleRate, sample.numberOfChannels);
      after.peak ??= new TruePeakMeter(sample.numberOfChannels);
      after.loudness.push(planes);
      after.peak.push(planes);
      const data = new Float32Array(sample.numberOfFrames * sample.numberOfChannels);
      planes.forEach((p, c) => data.set(p, c * sample.numberOfFrames));
      return new AudioSample({
        data,
        format: 'f32-planar',
        numberOfChannels: sample.numberOfChannels,
        sampleRate: sample.sampleRate,
        timestamp: sample.timestamp,
      });
    };

    const conversion = await Conversion.init({
      input,
      output,
      showWarnings: false,
      // Only the measured track is re-encoded; other audio tracks are copied as they are
      audio: t => (t.id === track.id ? { codec: destination.codec, process } : {}),
    });
    const dropped = conversion.discardedTracks.filter(d => d.reason !== 'discarded_by_user');
    if (!conversion.isValid || dropped.length) {
      const what = dropped.map(d => `${d.track.type} (${d.reason.replace(/_/g, ' ')})`).join(', ');
      throw new Error(`Can't write this file${what ? `: ${what}` : ''}`);
    }
    const abort = () => void conversion.cancel();
    signal?.addEventListener('abort', abort);
    try {
      await conversion.execute();
    } finally {
      signal?.removeEventListener('abort', abort);
    }
    const buffer = output.target.buffer;
    if (!buffer) throw new Error('The encoder produced no output');

    after.peak?.flush();
    const mime = hasVideo ? format.mimeType : format.mimeType.replace(/^video\//, 'audio/');
    return {
      bytes: new Uint8Array(buffer),
      mime,
      extension: format.fileExtension.replace(/^\./, ''),
      sameContainer: destination.sameContainer,
      codec: destination.codec,
      hasVideo,
      before: { integrated: analysis.integrated, truePeak: analysis.truePeak },
      after: {
        integrated: after.loudness?.integrated() ?? -Infinity,
        truePeak: after.peak ? toDb(after.peak.truePeak) : -Infinity,
      },
      gainDb,
      capped: plan.capped,
      limited: needsLimiter,
    };
  } finally {
    input.dispose();
  }
}
