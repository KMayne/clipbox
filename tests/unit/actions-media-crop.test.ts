import { describe, expect, it } from 'vitest';
import { mediaCrop } from '../../src/core/actions/catalog/media';
import { actionLabel, formFields } from '../../src/core/actions/form';
import { croppedName } from '../../src/core/actions/run/media';
import { Engine } from '../../src/engine/engine';
import { fitCrop } from '../../src/modules/audiotools/crop';
import { wav } from '../fixtures/media';

describe('Crop video settings', () => {
  it('has pixel fields and a quality', () => {
    const fields = formFields(mediaCrop.params);
    expect(fields.map(f => f.key)).toEqual(['left', 'top', 'width', 'height', 'quality']);
    expect(fields[0]).toMatchObject({ type: 'number', integer: true, default: 0 });
    expect(() => mediaCrop.params.parse({ left: -1 })).toThrow();
    expect(() => mediaCrop.params.parse({ width: 1.5 })).toThrow();
  });

  it('labels the region', () => {
    expect(actionLabel(mediaCrop, { left: 100, top: 50, width: 640, height: 360 })).toBe(
      'Crop 640×360 at 100, 50',
    );
    expect(actionLabel(mediaCrop, { left: 10 })).toBe('Crop full×full at 10, 0');
  });

  it('names the result', () => {
    const result = {
      bytes: new Uint8Array(),
      mime: 'video/mp4',
      extension: 'mp4',
      sameContainer: true,
      rect: { left: 0, top: 0, width: 640, height: 360 },
    };
    expect(croppedName('clip.mov', result)).toBe('clip (cropped 640×360).mov');
    expect(croppedName('clip.avi', { ...result, sameContainer: false, extension: 'mkv' })).toBe(
      'clip (cropped 640×360).mkv',
    );
    expect(croppedName(undefined, result)).toBe('video (cropped 640×360).mp4');
  });
});

describe('fitCrop', () => {
  it('rounds to even pixels', () => {
    expect(fitCrop({ left: 101, top: 51, width: 641, height: 361 }, 1920, 1080)).toEqual({
      left: 100,
      top: 50,
      width: 640,
      height: 360,
    });
  });

  it('runs 0 sizes to the edge and clamps to the frame', () => {
    expect(fitCrop({ left: 1000, top: 0, width: 0, height: 0 }, 1920, 1080)).toEqual({
      left: 1000,
      top: 0,
      width: 920,
      height: 1080,
    });
    expect(fitCrop({ left: 1800, top: 1000, width: 500, height: 500 }, 1920, 1080)).toEqual({
      left: 1800,
      top: 1000,
      width: 120,
      height: 80,
    });
    expect(fitCrop({ left: -20, top: -20, width: 100, height: 100 }, 64, 48)).toEqual({
      left: 0,
      top: 0,
      width: 64,
      height: 48,
    });
  });

  it('refuses a crop outside the frame', () => {
    expect(() => fitCrop({ left: 1920, top: 0, width: 10, height: 10 }, 1920, 1080)).toThrow(
      /outside the 1920×1080 frame/,
    );
  });
});

describe('Crop video availability', () => {
  it('is not offered for audio', async () => {
    const engine = new Engine({
      loaders: {
        media: () => import('../../src/modules/media/worker'),
        audiotools: () => import('../../src/modules/audiotools/worker'),
      },
    });
    const blob = new Blob([wav()], { type: 'audio/wav' });
    await engine.ingest({ id: 'en-c', mime: 'audio/wav', size: blob.size, blob, name: 'a.wav' });
    await engine.resolve('en-c', 'audio');
    expect(await engine.actions('en-c', 'audio')).not.toContain('media.crop');
  });
});
