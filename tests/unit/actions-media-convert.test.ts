import { describe, expect, it } from 'vitest';
import { mediaConvert, mediaExtractAudio } from '../../src/core/actions/catalog/media';
import { actionLabel, formFields } from '../../src/core/actions/form';
import { extractedName } from '../../src/core/actions/run/media';
import { withExtension } from '../../src/core/actions/run/util';
import { Engine } from '../../src/engine/engine';
import { asM4a } from '../../src/modules/audiotools/conversion';
import { FORMATS, targetSampleRate } from '../../src/modules/audiotools/convert';
import { audioContainer } from '../../src/modules/audiotools/extract';
import { CONVERT_FORMATS, isEncoderExtension } from '../../src/modules/audiotools/service';
import { wav } from '../fixtures/media';

describe('Convert audio catalog', () => {
  it('offers the formats and bitrates as choices', () => {
    const [format, bitrate] = formFields(mediaConvert.params);
    expect(format).toMatchObject({ key: 'format', type: 'enum', default: 'mp3' });
    expect(format?.type === 'enum' && format.options.map(o => o.value)).toEqual([
      ...CONVERT_FORMATS,
    ]);
    expect(format?.type === 'enum' && format.options[1]).toEqual({
      value: 'm4a',
      label: 'M4A (AAC)',
    });
    expect(bitrate).toMatchObject({ key: 'bitrate', type: 'enum', default: '192' });
    expect(bitrate?.type === 'enum' && bitrate.options.map(o => o.label)).toEqual([
      '96 kbps',
      '128 kbps',
      '192 kbps',
      '256 kbps',
      '320 kbps',
    ]);
    expect(() => mediaConvert.params.parse({ bitrate: '100' })).toThrow();
  });

  it('labels lossy results with the bitrate and lossless ones without', () => {
    expect(actionLabel(mediaConvert, {})).toBe('Convert to MP3 (192 kbps)');
    expect(actionLabel(mediaConvert, { format: 'ogg', bitrate: '96' })).toBe(
      'Convert to Ogg (96 kbps)',
    );
    expect(actionLabel(mediaConvert, { format: 'flac', bitrate: '320' })).toBe('Convert to FLAC');
    expect(actionLabel(mediaConvert, { format: 'wav' })).toBe('Convert to WAV');
    expect(actionLabel(mediaExtractAudio, {})).toBe('Extract audio track');
  });
});

describe('Convert audio formats', () => {
  it('maps each format to its file and codec', () => {
    const table = Object.fromEntries(
      CONVERT_FORMATS.map(f => {
        const spec = FORMATS[f];
        const format = spec.make();
        const codec = spec.codec(null);
        // The container can hold the codec it's paired with
        expect(format.getSupportedAudioCodecs()).toContain(codec);
        return [f, [spec.extension, spec.mime, codec, spec.lossless]];
      }),
    );
    expect(table).toEqual({
      mp3: ['mp3', 'audio/mpeg', 'mp3', false],
      m4a: ['m4a', 'audio/mp4', 'aac', false],
      ogg: ['ogg', 'audio/ogg', 'opus', false],
      webm: ['webm', 'audio/webm', 'opus', false],
      flac: ['flac', 'audio/flac', 'flac', true],
      wav: ['wav', 'audio/wav', 'pcm-s16', true],
    });
  });

  it('keeps sources deeper than 16 bits 24-bit in WAV', () => {
    expect(FORMATS.wav.codec('pcm-s24')).toBe('pcm-s24');
    expect(FORMATS.wav.codec('pcm-f32')).toBe('pcm-s24');
    expect(FORMATS.wav.codec('pcm-s16')).toBe('pcm-s16');
    expect(FORMATS.wav.codec('flac')).toBe('pcm-s16');
  });

  it('picks a sample rate the encoder takes', () => {
    expect(targetSampleRate('opus', 44100)).toBe(48000);
    expect(targetSampleRate('opus', 8000)).toBe(48000);
    expect(targetSampleRate('mp3', 44100)).toBeUndefined();
    expect(targetSampleRate('mp3', 8000)).toBeUndefined();
    expect(targetSampleRate('mp3', 96000)).toBe(48000);
    expect(targetSampleRate('mp3', 88200)).toBe(44100);
    expect(targetSampleRate('mp3', 176400)).toBe(44100);
    expect(targetSampleRate('mp3', 6000)).toBe(8000);
    expect(targetSampleRate('aac', 96000)).toBeUndefined();
    expect(targetSampleRate('aac', 192000)).toBe(96000);
    expect(targetSampleRate('flac', 192000)).toBeUndefined();
    expect(targetSampleRate('pcm-s16', 7000)).toBeUndefined();
  });
});

describe('Extract audio track containers', () => {
  it('picks the container by codec', () => {
    const table = Object.fromEntries(
      [
        'aac',
        'mp3',
        'opus',
        'vorbis',
        'flac',
        'pcm-s16',
        'pcm-f32',
        'ulaw',
        'ac3',
        'pcm-s16be',
        null,
      ].map(c => [String(c), audioContainer(c).extension]),
    );
    expect(table).toEqual({
      aac: 'm4a',
      mp3: 'mp3',
      opus: 'ogg',
      vorbis: 'ogg',
      flac: 'flac',
      'pcm-s16': 'wav',
      'pcm-f32': 'wav',
      ulaw: 'wav',
      // Codecs without a container of their own, and PCM layouts WAV can't hold, go to Matroska
      ac3: 'mka',
      'pcm-s16be': 'mka',
      null: 'mka',
    });
    expect(audioContainer('aac').mime).toBe('audio/mp4');
    expect(audioContainer('ac3').mime).toBe('audio/x-matroska');
  });
});

describe('result names', () => {
  it('swaps the extension for conversions and marks extracted audio', () => {
    expect(withExtension('song.ogg', 'mp3', 'audio')).toBe('song.mp3');
    expect(withExtension('my.song.flac', 'm4a', 'audio')).toBe('my.song.m4a');
    expect(withExtension(undefined, 'mp3', 'audio')).toBe('audio.mp3');
    expect(extractedName('clip.mp4', 'm4a')).toBe('clip (audio).m4a');
    expect(extractedName('holiday.final.webm', 'ogg')).toBe('holiday.final (audio).ogg');
    expect(extractedName(undefined, 'mka')).toBe('video (audio).mka');
  });
});

describe('M4A brand', () => {
  it("rewrites an MP4's major brand", () => {
    const ftyp = new Uint8Array(
      [0, 0, 0, 16, ...'ftypisom\0\0\x02\0'].map(c =>
        typeof c === 'string' ? c.charCodeAt(0) : c,
      ),
    );
    expect(String.fromCharCode(...asM4a(ftyp).subarray(8, 12))).toBe('M4A ');
    const other = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect([...asM4a(other)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('checks encoder module services', () => {
    expect(isEncoderExtension({ register: () => {} })).toBe(true);
    expect(isEncoderExtension({})).toBe(false);
    expect(isEncoderExtension(null)).toBe(false);
  });
});

describe('Convert audio in the engine', () => {
  const loaders = {
    media: () => import('../../src/modules/media/worker'),
    audiotools: () => import('../../src/modules/audiotools/worker'),
  };

  async function engineWith(bytes: Uint8Array<ArrayBuffer>, name: string) {
    const engine = new Engine({ loaders });
    const blob = new Blob([bytes], { type: 'audio/wav' });
    await engine.ingest({ id: 'en-a', mime: 'audio/wav', size: blob.size, blob, name });
    expect(await engine.resolve('en-a', 'audio')).toMatchObject({ status: 'ready' });
    return engine;
  }

  it('copies a 16-bit WAV to WAV, and says so', async () => {
    const engine = await engineWith(new Uint8Array(wav({ seconds: 1, rate: 8000 })), 'tone.wav');
    const ids = await engine.actions('en-a', 'audio');
    expect(ids).toContain('media.convert');
    expect(ids).not.toContain('media.extractAudio');
    const [out, ...rest] = await engine.runAction('en-a', 'audio', 'media.convert', {
      format: 'wav',
    });
    expect(rest).toEqual([]);
    expect(out).toMatchObject({
      name: 'tone.wav',
      mime: 'audio/wav',
      note: 'copied, not re-encoded',
    });
    // Same sample count: 8000 frames of 16-bit mono
    expect(out?.bytes.byteLength).toBeGreaterThanOrEqual(16000);
  });
});
