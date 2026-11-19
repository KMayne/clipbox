import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mediaTrim } from '../../src/core/actions/catalog/media';
import { actionLabel } from '../../src/core/actions/form';
import { trimmedName } from '../../src/core/actions/run/media';
import { clock, parseTrimPoint } from '../../src/core/mediaTime';
import { Engine } from '../../src/engine/engine';
import { resolveRange } from '../../src/modules/audiotools/trim';
import { wav } from '../fixtures/media';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../fixtures/audio/${name}`, import.meta.url)));

describe('Trim settings', () => {
  it('accepts times, percentages and times before the end', () => {
    const ok = (p: Record<string, string>) => mediaTrim.params.safeParse(p).success;
    expect(ok({ start: '1:05.5', end: '' })).toBe(true);
    expect(ok({ start: '10%', end: '-5' })).toBe(true);
    expect(ok({ start: '-0:30' })).toBe(true);
    expect(ok({ start: 'soon' })).toBe(false);
    expect(ok({ start: '' })).toBe(false);
    expect(ok({ end: '-10%' })).toBe(false);
  });

  it('parses points', () => {
    expect(parseTrimPoint('')).toBeUndefined();
    expect(parseTrimPoint(' 1:02.5 ')).toEqual({ seconds: 62.5 });
    expect(parseTrimPoint('25%')).toEqual({ fraction: 0.25 });
    expect(parseTrimPoint('-5s')).toEqual({ beforeEnd: 5 });
    expect(parseTrimPoint('- 0:30')).toEqual({ beforeEnd: 30 });
  });

  it('labels the range', () => {
    expect(actionLabel(mediaTrim, {})).toBe('Trim 0 → end');
    expect(actionLabel(mediaTrim, { start: '0:05', end: '-3', mode: 'exact' })).toBe(
      'Trim 0:05 → 3 before the end, exact',
    );
  });

  it('resolves and checks ranges', () => {
    expect(resolveRange({ seconds: 2 }, undefined, 0, 10)).toEqual({ start: 2, end: 10 });
    expect(resolveRange({ fraction: 0.5 }, { beforeEnd: 1 }, 0, 10)).toEqual({ start: 5, end: 9 });
    expect(resolveRange({ seconds: 0 }, { seconds: 99 }, 0, 10)).toEqual({ start: 0, end: 10 });
    expect(() => resolveRange({ seconds: 10 }, undefined, 0, 10)).toThrow(/past the end/);
    expect(() => resolveRange({ seconds: 5 }, { seconds: 4 }, 0, 10)).toThrow(/after the start/);
  });

  it('formats clock times and names', () => {
    expect(clock(5)).toBe('0:05');
    expect(clock(65.25)).toBe('1:05.25');
    expect(clock(0.5)).toBe('0:00.5');
    expect(clock(3723)).toBe('1:02:03');
    const result = { start: 1, end: 2.5, extension: 'mkv', sameContainer: true };
    expect(
      trimmedName('clip.mp4', 'video', {
        ...result,
        bytes: new Uint8Array(),
        mime: '',
        duration: 1.5,
      }),
    ).toBe('clip (0:01–0:02.5).mp4');
    expect(
      trimmedName('clip.avi', 'video', {
        ...result,
        sameContainer: false,
        bytes: new Uint8Array(),
        mime: '',
        duration: 1.5,
      }),
    ).toBe('clip (0:01–0:02.5).mkv');
  });
});

describe('Trim', () => {
  const loaders = {
    media: () => import('../../src/modules/media/worker'),
    audiotools: () => import('../../src/modules/audiotools/worker'),
  };

  async function run(
    bytes: Uint8Array<ArrayBuffer>,
    mime: string,
    name: string,
    kind: 'audio' | 'video',
    params: Record<string, unknown>,
  ) {
    const engine = new Engine({ loaders });
    const blob = new Blob([bytes], { type: mime });
    await engine.ingest({ id: 'en-t', mime, size: blob.size, blob, name });
    expect(await engine.resolve('en-t', kind)).toMatchObject({ status: 'ready' });
    expect(await engine.actions('en-t', kind)).toContain('media.trim');
    const [out, ...rest] = await engine.runAction('en-t', kind, 'media.trim', params);
    expect(rest).toEqual([]);
    if (!out) throw new Error('no result');
    return out;
  }

  /** WAV data size in seconds (8 kHz mono 16-bit). */
  const wavSeconds = (bytes: Uint8Array) => (bytes.length - 44) / 16000;

  it('tops and tails a WAV', async () => {
    const out = await run(wav({ seconds: 4 }), 'audio/wav', 'tone.wav', 'audio', {
      start: '0:01',
      end: '-1',
    });
    expect(out.name).toBe('tone (0:01–0:03).wav');
    expect(out.mime).toBe('audio/wav');
    expect(wavSeconds(out.bytes)).toBeCloseTo(2, 1);
  });

  it('cuts a WAV exactly', async () => {
    const out = await run(wav({ seconds: 4 }), 'audio/wav', 'tone.wav', 'audio', {
      start: '25%',
      end: '1.5',
      mode: 'exact',
    });
    expect(out.name).toBe('tone (0:01–0:01.5).wav');
    expect(wavSeconds(out.bytes)).toBeCloseTo(0.5, 2);
  });

  it('trims FLAC and keeps it FLAC', async () => {
    const out = await run(fixture('tone.flac'), 'audio/flac', 'tone.flac', 'audio', {
      start: '0.25',
      end: '0.75',
    });
    expect(out.name).toBe('tone (0:00.25–0:00.75).flac');
    expect(out.mime).toBe('audio/flac');
  });

  it('refuses an empty range', async () => {
    await expect(
      run(wav({ seconds: 2 }), 'audio/wav', 'tone.wav', 'audio', { start: '3' }),
    ).rejects.toThrow(/past the end/);
  });
});
