import { describe, expect, it } from 'vitest';
import { mediaToGif } from '../../src/core/actions/catalog/media';
import { actionLabel, formFields } from '../../src/core/actions/form';
import { gifName } from '../../src/core/actions/run/media';
import { Engine } from '../../src/engine/engine';
import { gifFrames, gifSize, MAX_GIF_FRAMES } from '../../src/modules/audiotools/gifPlan';
import { isGifMaker } from '../../src/modules/audiotools/service';
import { service } from '../../src/modules/audiotools/worker';
import { wav } from '../fixtures/media';

describe('Video to GIF settings', () => {
  it('has the range, frame rate, width, colours and loop', () => {
    const fields = formFields(mediaToGif.params);
    expect(fields.map(f => f.key)).toEqual(['start', 'end', 'fps', 'width', 'colours', 'loop']);
    expect(fields[2]).toMatchObject({ type: 'enum', default: '10' });
    expect(fields[3]).toMatchObject({ type: 'enum', default: '480' });
    expect(fields[5]).toMatchObject({ type: 'boolean', default: true });
  });

  it('labels the range only when there is one', () => {
    expect(actionLabel(mediaToGif, {})).toBe('GIF (10 fps)');
    expect(actionLabel(mediaToGif, { start: '5', end: '8', fps: '15', loop: false })).toBe(
      'GIF (5 → 8, 15 fps, once)',
    );
  });

  it('is served by the audiotools module', () => {
    expect(isGifMaker(service)).toBe(true);
  });
});

describe('gifSize', () => {
  it('scales down, keeping the shape', () => {
    expect(gifSize(1920, 1080, 480)).toEqual({ width: 480, height: 270 });
  });
  it("doesn't upscale, and 0 keeps the video's width", () => {
    expect(gifSize(64, 48, 480)).toEqual({ width: 64, height: 48 });
    expect(gifSize(1280, 720, 0)).toEqual({ width: 1280, height: 720 });
  });
});

describe('gifFrames', () => {
  it('samples at the frame rate', () => {
    const frames = gifFrames(1, 3, 10);
    expect(frames).toHaveLength(20);
    expect(frames[0]).toEqual({ at: 1, delay: 100 });
    expect(frames[19]?.at).toBeCloseTo(2.9);
  });

  it('keeps the total length when delays round', () => {
    const frames = gifFrames(0, 1, 15);
    expect(frames).toHaveLength(15);
    expect(new Set(frames.map(f => f.delay))).toEqual(new Set([60, 70]));
    expect(frames.reduce((t, f) => t + f.delay, 0)).toBe(1000);
  });

  it('shortens the last frame to the end of the range', () => {
    const frames = gifFrames(0, 0.25, 10);
    expect(frames.map(f => f.delay)).toEqual([100, 100, 50]);
  });

  it('always has a frame, and refuses too many', () => {
    expect(gifFrames(0, 0.01, 5)).toHaveLength(1);
    expect(() => gifFrames(0, MAX_GIF_FRAMES, 5)).toThrow(/Lower the frame rate/);
  });
});

describe('gifName', () => {
  const result = { bytes: new Uint8Array(), width: 1, height: 1, frames: 1, start: 5, end: 8 };
  it('names the range when there is one', () => {
    expect(gifName('clip.mp4', result, true)).toBe('clip (0:05–0:08).gif');
    expect(gifName('clip.mp4', result, false)).toBe('clip.gif');
    expect(gifName(undefined, result, false)).toBe('video.gif');
  });
});

describe('Video to GIF availability', () => {
  it('is not offered for audio', async () => {
    const engine = new Engine({
      loaders: {
        media: () => import('../../src/modules/media/worker'),
        audiotools: () => import('../../src/modules/audiotools/worker'),
      },
    });
    const blob = new Blob([wav()], { type: 'audio/wav' });
    await engine.ingest({ id: 'en-g', mime: 'audio/wav', size: blob.size, blob, name: 'a.wav' });
    await engine.resolve('en-g', 'audio');
    expect(await engine.actions('en-g', 'audio')).not.toContain('media.toGif');
  });
});
