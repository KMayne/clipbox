import { describe, expect, it } from 'vitest';
import { normalisedName } from '../../src/core/actions/run/media';
import { Engine } from '../../src/engine/engine';
import { LoudnessMeter } from '../../src/modules/audiotools/loudness';
import { codecPreference } from '../../src/modules/audiotools/normalise';
import type { NormaliseResult } from '../../src/modules/audiotools/service';
import { TruePeakMeter, fromDb, toDb } from '../../src/modules/audiotools/truePeak';

/** 16-bit PCM WAV; `sample(i, channel)` returns -1..1. */
function wav(
  rate: number,
  channels: number,
  frames: number,
  sample: (i: number, c: number) => number,
): Uint8Array<ArrayBuffer> {
  const bytes = frames * channels * 2;
  const dv = new DataView(new ArrayBuffer(44 + bytes));
  const ascii = (at: number, s: string) =>
    [...s].forEach((ch, i) => dv.setUint8(at + i, ch.charCodeAt(0)));
  ascii(0, 'RIFF');
  dv.setUint32(4, 36 + bytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, channels, true);
  dv.setUint32(24, rate, true);
  dv.setUint32(28, rate * channels * 2, true);
  dv.setUint16(32, channels * 2, true);
  dv.setUint16(34, 16, true);
  ascii(36, 'data');
  dv.setUint32(40, bytes, true);
  for (let i = 0; i < frames; i++)
    for (let c = 0; c < channels; c++) {
      const v = Math.max(-1, Math.min(1, sample(i, c)));
      dv.setInt16(44 + (i * channels + c) * 2, Math.round(v * 32767), true);
    }
  return new Uint8Array(dv.buffer);
}

/** Reads a PCM WAV (16-bit integer or 32-bit float) into planar channels. */
function readWav(b: Uint8Array) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const tag = (at: number) => String.fromCharCode(...b.subarray(at, at + 4));
  let format = 0;
  let channels = 0;
  let rate = 0;
  let bits = 0;
  for (let at = 12; at + 8 <= b.length;) {
    const size = dv.getUint32(at + 4, true);
    if (tag(at) === 'fmt ') {
      format = dv.getUint16(at + 8, true);
      channels = dv.getUint16(at + 10, true);
      rate = dv.getUint32(at + 12, true);
      bits = dv.getUint16(at + 22, true);
    } else if (tag(at) === 'data') {
      const width = bits / 8;
      const frames = Math.floor(size / (width * channels));
      const planes = Array.from({ length: channels }, () => new Float32Array(frames));
      for (let i = 0; i < frames; i++)
        planes.forEach((p, c) => {
          const pos = at + 8 + (i * channels + c) * width;
          p[i] =
            bits === 16
              ? dv.getInt16(pos, true) / 32768
              : format === 3 || format === 0xfffe
                ? dv.getFloat32(pos, true)
                : 0;
        });
      return { rate, planes };
    }
    at += 8 + size + (size % 2);
  }
  throw new Error('no data chunk');
}

function measure(b: Uint8Array) {
  const { rate, planes } = readWav(b);
  const loudness = new LoudnessMeter(rate, planes.length);
  const peak = new TruePeakMeter(planes.length);
  loudness.push(planes);
  peak.push(planes);
  peak.flush();
  return { integrated: loudness.integrated(), truePeak: toDb(peak.truePeak) };
}

const RATE = 44100;
const tone =
  (db: number, freq = 1000) =>
  (i: number) =>
    fromDb(db) * Math.sin((2 * Math.PI * freq * i) / RATE);

describe('Normalise audio in the engine', () => {
  const loaders = {
    media: () => import('../../src/modules/media/worker'),
    audiotools: () => import('../../src/modules/audiotools/worker'),
  };

  async function run(bytes: Uint8Array<ArrayBuffer>, params: Record<string, unknown>) {
    const engine = new Engine({ loaders });
    const blob = new Blob([bytes], { type: 'audio/wav' });
    await engine.ingest({
      id: 'en-a',
      mime: 'audio/wav',
      size: blob.size,
      blob,
      name: 'quiet.wav',
    });
    expect(await engine.resolve('en-a', 'audio')).toMatchObject({ status: 'ready' });
    expect(await engine.actions('en-a', 'audio')).toContain('media.normalise');
    const [result] = await engine.runAction('en-a', 'audio', 'media.normalise', params);
    if (!result) throw new Error('no result');
    return { result, engine };
  }

  it('normalises a quiet WAV to -14 LUFS, as WAV', async () => {
    const quiet = wav(RATE, 2, RATE * 3, tone(-30));
    const before = measure(quiet);
    expect(before.integrated).toBeCloseTo(-30, 0);
    const { result, engine } = await run(quiet, {});
    expect(result.mime).toBe('audio/wav');
    expect(result.name).toBe('quiet (normalised -14 LUFS; was -30.0 LUFS, +16.0 dB).wav');
    const after = measure(result.bytes);
    expect(Math.abs(after.integrated - -14)).toBeLessThanOrEqual(0.5);
    expect(after.truePeak).toBeLessThan(-1);

    // The result is itself an audio capture
    const blob = new Blob([result.bytes], { type: result.mime });
    await engine.ingest({ id: 'en-b', mime: result.mime, size: blob.size, blob });
    expect(await engine.resolve('en-b', 'audio')).toMatchObject({ status: 'ready' });
  });

  /** A -30 dBFS tone with a near-full-scale click every second. */
  const clicky = () =>
    wav(RATE, 2, RATE * 4, i => tone(-30)(i) + (i % RATE < 40 ? 0.9 * Math.sin(i / 2) : 0));

  it('caps the gain at the true-peak ceiling and says so', async () => {
    const { result } = await run(clicky(), { target: -14, ceiling: -1 });
    expect(result.name).toMatch(/^quiet \(normalised -\d+\.\d LUFS, peak-capped below -14; was /);
    const after = measure(result.bytes);
    expect(after.integrated).toBeLessThan(-15);
    expect(after.truePeak).toBeLessThanOrEqual(-0.9);
  });

  it('reaches the target with the limiter, under the ceiling', async () => {
    const { result } = await run(clicky(), { target: -14, ceiling: -1, limit: true });
    expect(result.name).toMatch(/^quiet \(normalised -14 LUFS, limited; was /);
    const after = measure(result.bytes);
    expect(Math.abs(after.integrated - -14)).toBeLessThanOrEqual(0.5);
    expect(after.truePeak).toBeLessThanOrEqual(-0.9);
  });

  it('rejects settings outside the allowed range', async () => {
    await expect(run(wav(RATE, 1, RATE, tone(-20)), { target: -2 })).rejects.toThrow(
      /Invalid settings/,
    );
  });

  it('refuses silence', async () => {
    await expect(
      run(
        wav(RATE, 1, RATE, () => 0),
        {},
      ),
    ).rejects.toThrow(/too quiet/i);
  });
});

describe('output naming and codecs', () => {
  const result = (over: Partial<NormaliseResult>): NormaliseResult => ({
    bytes: new Uint8Array(0),
    mime: 'audio/ogg',
    extension: 'ogg',
    sameContainer: true,
    codec: 'opus',
    hasVideo: false,
    before: { integrated: -20.04, truePeak: -3 },
    after: { integrated: -14.02, truePeak: -1.5 },
    gainDb: 5.96,
    capped: false,
    limited: false,
    ...over,
  });

  it('keeps the original extension in the same container, else uses the new one', () => {
    expect(normalisedName('talk.opus', 'audio', result({}), -14)).toBe(
      'talk (normalised -14 LUFS; was -20.0 LUFS, +6.0 dB).opus',
    );
    expect(normalisedName('song.mp3', 'audio', result({ sameContainer: false }), -14)).toBe(
      'song (normalised -14 LUFS; was -20.0 LUFS, +6.0 dB).ogg',
    );
    expect(normalisedName(undefined, 'video', result({ extension: 'mkv' }), -16)).toMatch(
      /^video \(normalised -14\.0 LUFS; .*\)\.mkv$/,
    );
  });

  it('shows the measured loudness when the gain was capped', () => {
    const capped = result({ capped: true, after: { integrated: -17.25, truePeak: -1 } });
    expect(normalisedName('a.wav', 'audio', capped, -14)).toBe(
      'a (normalised -17.3 LUFS, peak-capped below -14; was -20.0 LUFS, +6.0 dB).wav',
    );
  });

  it('prefers the source codec, then lossless for lossless sources, else lossy', () => {
    expect(codecPreference(['aac', 'opus', 'pcm-s16', 'flac'], 'aac')).toEqual([
      'aac',
      'opus',
      'flac',
      'pcm-s16',
    ]);
    expect(codecPreference(['aac', 'opus', 'pcm-s16', 'flac'], 'pcm-s24')).toEqual([
      'flac',
      'pcm-s16',
      'aac',
      'opus',
    ]);
    expect(codecPreference(['opus', 'vorbis'], 'vorbis')).toEqual(['vorbis', 'opus']);
  });
});
