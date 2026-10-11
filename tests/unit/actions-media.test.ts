import { describe, expect, it } from 'vitest';
import { FRAME_TIME } from '../../src/core/actions/catalog/media';
import { parseFrameTime } from '../../src/core/actions/run/media';
import { Engine } from '../../src/engine/engine';
import { mp3WithId3 } from '../fixtures/media';
import { pngHeader } from './helpers';

const td = new TextDecoder();

describe('media Metadata as JSON', () => {
  it('reads streams and tags through the media module', async () => {
    const engine = new Engine({
      loaders: { media: () => import('../../src/modules/media/worker') },
    });
    const bytes = new Uint8Array(mp3WithId3({ cover: pngHeader(2, 2) }));
    const blob = new Blob([bytes], { type: 'audio/mpeg' });
    await engine.ingest({
      id: 'en-1',
      mime: 'audio/mpeg',
      size: blob.size,
      blob,
      name: 'tone.mp3',
    });
    await engine.resolve('en-1', 'audio');
    expect(await engine.actions('en-1', 'audio')).toContain('media.metadata');
    // Video frames are for video only
    expect(await engine.actions('en-1', 'audio')).not.toContain('media.videoFrame');

    const [out, ...rest] = await engine.runAction('en-1', 'audio', 'media.metadata', {});
    expect(rest).toEqual([]);
    expect(out).toMatchObject({ name: 'tone-metadata.json', mime: 'application/json' });
    const meta: unknown = JSON.parse(td.decode(out?.bytes));
    expect(meta).toMatchObject({
      kind: 'audio',
      container: 'mp3',
      format: 'MP3',
      sampleRate: 44100,
      tags: { title: 'Test Tone', artist: 'Clipbox', album: 'Fixtures', track: '3/12' },
      streams: { container: 'MPEG', codec: 'MPEG 1 Layer 3', sampleRate: 44100 },
      common: { title: 'Test Tone', artist: 'Clipbox', track: { no: 3, of: 12 } },
      pictures: [{ format: 'image/png', type: 'Cover (front)' }],
      native: { 'ID3v2.3': expect.arrayContaining([{ id: 'TIT2', value: 'Test Tone' }]) },
    });
    // Picture bytes are described, never embedded
    expect(td.decode(out?.bytes)).toMatch(/"data": "<\d+ bytes>"/);
  });
});

describe('video frame time', () => {
  it('parses seconds, m:ss and percentages', () => {
    expect(parseFrameTime('10%')).toEqual({ fraction: 0.1 });
    expect(parseFrameTime(' 12.5s ')).toEqual({ seconds: 12.5 });
    expect(parseFrameTime('1:23')).toEqual({ seconds: 83 });
    expect(parseFrameTime('1:02:03.5')).toEqual({ seconds: 3723.5 });
    expect(() => parseFrameTime('150%')).toThrow("Invalid percentage '150%'");
    for (const ok of ['0', '10%', '2.5 %', '3s', '0:05'])
      expect(FRAME_TIME.test(ok), ok).toBe(true);
    for (const bad of ['', 'abc', '-1', '1:2:3:4', '10%%'])
      expect(FRAME_TIME.test(bad), bad).toBe(false);
  });
});
