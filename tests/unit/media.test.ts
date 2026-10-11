import { describe, expect, it } from 'vitest';
import { makeContent } from '../../src/core/content';
import { Engine } from '../../src/engine/engine';
import { parseAvi, parseMp4 } from '../../src/modules/media/containers';
import { audioDetector, sniffMedia, videoDetector } from '../../src/modules/media/detect';
import {
  formatDuration,
  mediaLabel,
  parseMedia,
  tagsText,
  type MediaValue,
} from '../../src/modules/media/media';
import { computePeaks } from '../../src/components/previews/waveform';
import { avi, ftyp, mp3Frame, mp3WithId3, mp4, ogg, riff, wav, webm } from '../fixtures/media';
import { bytesContent, pngHeader } from './helpers';

const content = (b: Uint8Array) => makeContent('application/octet-stream', new Uint8Array(b));
const kindOf = (b: Uint8Array) => sniffMedia(b);
const enc = (s: string) => [...s].map(c => c.charCodeAt(0));

describe('media detection', () => {
  it.each([
    ['WAV', wav(), { container: 'wav', kind: 'audio' }],
    ['ID3 MP3', mp3WithId3(), { container: 'mp3', kind: 'audio' }],
    [
      'frame-sync MP3',
      new Uint8Array([...mp3Frame(), ...mp3Frame()]),
      { container: 'mp3', kind: 'audio' },
    ],
    [
      'FLAC',
      new Uint8Array([...enc('fLaC'), 0, 0, 0, 34, ...new Array<number>(34).fill(0)]),
      { container: 'flac', kind: 'audio' },
    ],
    ['Ogg Vorbis', ogg([1, ...enc('vorbis'), 0, 0, 0, 0]), { container: 'ogg', kind: 'audio' }],
    ['Ogg Opus', ogg(enc('OpusHead')), { container: 'ogg', kind: 'audio' }],
    ['Ogg Theora', ogg([0x80, ...enc('theora'), 3, 2]), { container: 'ogg', kind: 'video' }],
    ['M4A', ftyp('M4A ', 'M4A ', 'mp42', 'isom'), { container: 'm4a', kind: 'audio' }],
    ['M4B', ftyp('M4B ', 'M4B '), { container: 'm4a', kind: 'audio' }],
    ['MP4 isom', ftyp('isom', 'isom', 'avc1'), { container: 'mp4', kind: 'video' }],
    ['MP4 mp42', ftyp('mp42', 'mp41'), { container: 'mp4', kind: 'video' }],
    ['MOV', ftyp('qt  ', 'qt  '), { container: 'mov', kind: 'video' }],
    ['AVI', avi(), { container: 'avi', kind: 'video' }],
    ['WebM video+audio', webm([1, 2]), { container: 'webm', kind: 'video' }],
    ['WebM audio', webm([2]), { container: 'webm', kind: 'audio' }],
    ['WebM without tracks yet', webm([], { tracks: false }), { container: 'webm', kind: 'video' }],
    ['Matroska audio', webm([2], { docType: 'matroska' }), { container: 'mkv', kind: 'audio' }],
  ])('%s', (_, b, expected) => {
    expect(kindOf(b)).toEqual(expected);
  });

  it.each([
    ['random RIFF', riff('ABCD')],
    ['WebP (RIFF image)', riff('WEBP')],
    ['zip', new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new Array<number>(26).fill(0)])],
    ['PNG', pngHeader(10, 10)],
    ['JPEG', new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array<number>(20).fill(0)])],
    ['HEIC', ftyp('heic', 'mif1', 'heic')],
    ['AVIF', ftyp('avif', 'mif1', 'avif')],
    ['unknown ftyp brand', ftyp('abcd', 'efgh')],
    ['frame sync then garbage', new Uint8Array([...mp3Frame(), 1, 2, 3, 4, 5])],
    ['bad MPEG header', new Uint8Array([0xff, 0xfb, 0xf0, 0x00, ...new Array<number>(20).fill(0)])],
    ['EBML that is not Matroska', webm([1], { docType: 'other' })],
    ['ID3 lookalike text', new TextEncoder().encode('ID3 is a tag format, see docs')],
  ])('rejects %s', (_, b) => {
    expect(kindOf(b)).toBeNull();
  });

  it('detectors report 0.95 for their own kind only', () => {
    const audio = content(wav());
    expect(audioDetector.detect(audio)).toBe(0.95);
    expect(videoDetector.detect(audio)).toBe(0);
    const video = content(mp4());
    expect(videoDetector.detect(video)).toBe(0.95);
    expect(audioDetector.detect(video)).toBe(0);
    expect(audioDetector.detect(bytesContent([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).toBe(0);
  });
});

describe('media metadata', () => {
  it('reads a generated WAV', async () => {
    const v = await parseMedia('audio', content(wav({ seconds: 2, rate: 8000 })));
    expect(v).toMatchObject({
      kind: 'audio',
      format: 'WAV',
      mime: 'audio/wav',
      hasVideo: false,
      duration: 2,
      sampleRate: 8000,
      channels: 1,
      bitDepth: 16,
      bitrate: 128000,
      cover: null,
      video: null,
      warning: null,
    });
    expect(v.codecs).toContain('PCM');
    expect(mediaLabel(v)).toBe('WAV · 0:02 · 128 kbps');
  });

  it('reads ID3 tags and cover art from an MP3', async () => {
    const cover = pngHeader(4, 4);
    const v = await parseMedia('audio', content(mp3WithId3({ frames: 8, cover })));
    expect(v.tags).toEqual({
      title: 'Test Tone',
      artist: 'Clipbox',
      album: 'Fixtures',
      year: '2026',
      track: '3/12',
    });
    expect(v.cover?.mime).toBe('image/png');
    expect([...(v.cover?.bytes ?? [])]).toEqual([...cover]);
    expect(v.sampleRate).toBe(44100);
    expect(v.bitrate).toBe(128000);
    expect(mediaLabel(v)).toMatch(/^MP3 · 0:00\.\d · 128 kbps$/);
    expect(tagsText(v.tags)).toBe(
      'Title: Test Tone\nArtist: Clipbox\nAlbum: Fixtures\nYear: 2026\nTrack: 3/12',
    );
  });

  it('reads MP4 video dimensions, frame rate and rotation', async () => {
    const box = parseMp4(mp4({ width: 1920, height: 1080, fps: 30, frames: 60, rotation: 90 }));
    expect(box.video).toEqual({
      width: 1920,
      height: 1080,
      frameRate: 30,
      rotation: 90,
      codec: 'avc1',
    });
    expect(box.duration).toBe(2);
    const v = await parseMedia('video', content(mp4({ fps: 25, frames: 1450 })));
    expect(v).toMatchObject({ hasVideo: true, mime: 'video/mp4', duration: 58 });
    expect(mediaLabel(v)).toBe('MP4 · 1920×1080 · 0:58');
  });

  it('corrects an MP4 with no video track to audio only', async () => {
    const b = mp4({ handler: 'soun', fps: 25, frames: 50 });
    expect(sniffMedia(b)?.kind).toBe('video');
    const v = await parseMedia('video', content(b));
    expect(v).toMatchObject({ hasVideo: false, video: null, mime: 'audio/mp4' });
    expect(mediaLabel(v)).toBe('MP4 · audio only · 0:02');
  });

  it('reads AVI headers', async () => {
    expect(parseAvi(avi({ width: 640, height: 480, fps: 25, frames: 50 }))).toEqual({
      duration: 2,
      video: { width: 640, height: 480, frameRate: 25, rotation: 0, codec: 'MJPG' },
      audio: null,
    });
    const v = await parseMedia('video', content(avi()));
    expect(mediaLabel(v)).toBe('AVI · 640×480 · 0:02');
  });
});

describe('media labels', () => {
  const base: MediaValue = {
    kind: 'audio',
    container: 'mp3',
    format: 'MP3',
    mime: 'audio/mpeg',
    hasVideo: false,
    codecs: ['MPEG 1 Layer 3'],
    duration: 222,
    bitrate: 320000,
    sampleRate: 44100,
    channels: 2,
    bitDepth: null,
    lossless: false,
    tags: {},
    cover: null,
    video: null,
    warning: null,
    bytes: new Uint8Array(0),
  };

  it('formats audio, video and audio-only video', () => {
    expect(mediaLabel(base)).toBe('MP3 · 3:42 · 320 kbps');
    const video = { width: 1920, height: 1080, frameRate: 30, rotation: 0, codec: 'avc1' };
    expect(
      mediaLabel({ ...base, kind: 'video', format: 'MP4', hasVideo: true, duration: 58, video }),
    ).toBe('MP4 · 1920×1080 · 0:58');
    expect(
      mediaLabel({
        ...base,
        kind: 'video',
        format: 'MP4',
        hasVideo: true,
        video: { ...video, rotation: 90 },
      }),
    ).toBe('MP4 · 1080×1920 · 3:42');
    expect(mediaLabel({ ...base, kind: 'video', format: 'WebM', duration: 3, bitrate: null })).toBe(
      'WebM · audio only · 0:03',
    );
    expect(mediaLabel({ ...base, duration: null, bitrate: null })).toBe('MP3');
  });

  it('formats durations', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(0.42)).toBe('0:00.4');
    expect(formatDuration(59.6)).toBe('1:00');
    expect(formatDuration(3723)).toBe('1:02:03');
  });
});

describe('waveform peaks', () => {
  it('takes the loudest sample per bucket across channels', () => {
    const left = new Float32Array([0.1, -0.5, 0.2, 0.3]);
    const right = new Float32Array([0, 0, -0.9, 0]);
    expect([...computePeaks([left, right], 2)]).toEqual([expect.closeTo(0.5), expect.closeTo(0.9)]);
    expect([...computePeaks([], 3)]).toEqual([0, 0, 0]);
  });
});

describe('media module in the engine', () => {
  const loaders = { media: () => import('../../src/modules/media/worker') };
  const entry = (b: Uint8Array, mime: string) => {
    const blob = new Blob([new Uint8Array(b)], { type: mime });
    return { id: 'en-m' as const, mime, size: blob.size, blob };
  };

  it('defers to the module, then resolves the audio kind with a cover derivation', async () => {
    const engine = new Engine({ loaders });
    const res = await engine.ingest(entry(mp3WithId3({ cover: pngHeader(2, 2) }), 'audio/mpeg'));
    expect(res.interpretations[0]).toMatchObject({
      kind: 'audio',
      status: 'loading',
      module: 'media',
    });
    expect(await engine.resolve('en-m', 'audio')).toMatchObject({ status: 'ready' });
    const summary = await engine.summary('en-m', 'audio');
    expect(summary.derivations).toEqual([{ id: 'cover', label: 'Cover art' }]);
    expect(summary.stats.find(s => s.label === 'Tags')?.children?.[0]).toEqual({
      label: 'Title',
      value: 'Test Tone',
    });
    const derived = await engine.derive('en-m', 'audio', 'cover');
    expect(derived).toMatchObject({ mime: 'image/png', name: 'cover.png' });
    expect(await engine.slice('en-m', 'audio', { type: 'media' })).toMatchObject({
      mime: 'audio/mpeg',
    });
    expect((await engine.exportValue('en-m', 'audio')).text).toContain('Artist: Clipbox');
  });
});
