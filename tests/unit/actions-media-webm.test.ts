import { describe, expect, it } from 'vitest';
import { mediaToWebm } from '../../src/core/actions/catalog/media';
import { actionLabel, formFields } from '../../src/core/actions/form';
import { Engine } from '../../src/engine/engine';
import { isWebmConverter } from '../../src/modules/audiotools/service';
import { service } from '../../src/modules/audiotools/worker';
import { wav } from '../fixtures/media';

describe('Convert to WebM settings', () => {
  it('offers the codecs and qualities', () => {
    const [codec, quality] = formFields(mediaToWebm.params);
    expect(codec).toMatchObject({ key: 'codec', type: 'enum', default: 'vp9' });
    expect(codec?.type === 'enum' && codec.options.map(o => o.label)).toEqual([
      'VP9',
      'AV1',
      'VP8',
    ]);
    expect(quality).toMatchObject({ key: 'quality', type: 'enum', default: 'high' });
  });

  it('labels the codec', () => {
    expect(actionLabel(mediaToWebm, {})).toBe('Convert to WebM (VP9)');
    expect(actionLabel(mediaToWebm, { codec: 'av1', quality: 'medium' })).toBe(
      'Convert to WebM (AV1)',
    );
  });

  it('is served by the audiotools module', () => {
    expect(isWebmConverter(service)).toBe(true);
  });
});

describe('Convert to WebM availability', () => {
  it('is not offered for audio', async () => {
    const engine = new Engine({
      loaders: {
        media: () => import('../../src/modules/media/worker'),
        audiotools: () => import('../../src/modules/audiotools/worker'),
      },
    });
    const blob = new Blob([wav()], { type: 'audio/wav' });
    await engine.ingest({ id: 'en-w', mime: 'audio/wav', size: blob.size, blob, name: 'a.wav' });
    await engine.resolve('en-w', 'audio');
    expect(await engine.actions('en-w', 'audio')).not.toContain('media.toWebm');
  });
});
