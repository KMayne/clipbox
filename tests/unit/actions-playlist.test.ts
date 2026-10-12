import { describe, expect, it } from 'vitest';
import type { EntryId } from '../../src/core/types';
import { Engine } from '../../src/engine/engine';
import { MASTER, MEDIA_VOD } from '../fixtures/playlists';

const td = new TextDecoder();

async function engineWith(text: string, name = 'index.m3u8') {
  const engine = new Engine({ loaders: {} });
  const blob = new Blob([text], { type: 'application/vnd.apple.mpegurl' });
  const id: EntryId = 'en-1';
  const result = await engine.ingest({ id, mime: blob.type, name, size: blob.size, blob });
  const run = async (action: string, params: Record<string, unknown> = {}) =>
    engine.runAction(id, 'playlist', action, params);
  const actions = () => engine.actions(id, 'playlist');
  return { result, run, actions };
}

describe('playlist ingest', () => {
  it('offers playlist first, labelled', async () => {
    const { result } = await engineWith(MEDIA_VOD);
    expect(result.interpretations[0]).toMatchObject({
      kind: 'playlist',
      status: 'ready',
      label: 'HLS media · 3 segments · 0:17 · VOD',
    });
  });

  it('offers segment actions for media playlists and variant actions for master ones', async () => {
    const media = await (await engineWith(MEDIA_VOD)).actions();
    expect(media.filter(id => id.startsWith('playlist.'))).toEqual([
      'playlist.resolveUrls',
      'playlist.segmentsCsv',
      'playlist.segmentsJson',
      'playlist.urls',
    ]);
    const master = await (await engineWith(MASTER)).actions();
    expect(master.filter(id => id.startsWith('playlist.'))).toEqual([
      'playlist.resolveUrls',
      'playlist.variantsJson',
      'playlist.urls',
    ]);
  });
});

describe('playlist actions', () => {
  it('resolves URIs against a base URL, including URI attributes', async () => {
    const { run } = await engineWith(MEDIA_VOD);
    const [out] = await run('playlist.resolveUrls', {
      base: 'https://cdn.example.com/vod/index.m3u8',
    });
    expect(out).toMatchObject({
      mime: 'application/vnd.apple.mpegurl',
      name: 'index.m3u8',
      note: '3 URIs resolved',
    });
    const text = td.decode(out?.bytes);
    expect(text).toContain('#EXT-X-MAP:URI="https://cdn.example.com/vod/init.mp4"');
    expect(text).toContain('\nhttps://cdn.example.com/vod/seg100.m4s\n');
    // Already absolute: unchanged
    expect(text).toContain('URI="https://keys.example.com/key?id=1"');
    expect(text).toContain('\nhttps://other.example.com/ad.ts\n');
  });

  it('leaves the playlist as it is without a base, and rejects non-http(s) bases', async () => {
    const { run } = await engineWith(MEDIA_VOD);
    const [same] = await run('playlist.resolveUrls');
    expect(td.decode(same?.bytes)).toBe(MEDIA_VOD);
    await expect(run('playlist.resolveUrls', { base: 'file:///tmp/x.m3u8' })).rejects.toThrow(
      'Base URL must start with http:// or https://',
    );
    await expect(run('playlist.resolveUrls', { base: 'not a url' })).rejects.toThrow(
      "Base URL isn't a valid URL",
    );
  });

  it('gives segments as CSV', async () => {
    const { run } = await engineWith(MEDIA_VOD);
    const [csv] = await run('playlist.segmentsCsv');
    expect(csv).toMatchObject({ mime: 'text/csv', name: 'index.csv' });
    expect(td.decode(csv?.bytes)).toBe(
      [
        'sequence,duration,start,uri,title,byte_range,discontinuity,program_date_time,key_method,key_uri',
        '100,6.006,0,seg100.m4s,Intro,,false,2024-01-01T00:00:00.000Z,AES-128,https://keys.example.com/key?id=1',
        '101,6.006,6.006,seg101.m4s,,,false,,AES-128,https://keys.example.com/key?id=1',
        '102,4.5,12.012,https://other.example.com/ad.ts,,,true,,,',
        '',
      ].join('\r\n'),
    );
  });

  it('gives segments as JSON', async () => {
    const { run } = await engineWith(MEDIA_VOD);
    const [json] = await run('playlist.segmentsJson');
    const segments: unknown = JSON.parse(td.decode(json?.bytes));
    expect(segments).toMatchObject([
      {
        sequence: 100,
        uri: 'seg100.m4s',
        duration: 6.006,
        start: 0,
        key: { method: 'AES-128', uri: 'https://keys.example.com/key?id=1' },
        map: { uri: 'init.mp4', byteRange: null },
      },
      { sequence: 101 },
      { sequence: 102, discontinuity: true, key: null },
    ]);
  });

  it('gives variants as JSON in source order', async () => {
    const { run } = await engineWith(MASTER, 'master.m3u8');
    const [json] = await run('playlist.variantsJson');
    expect(json?.name).toBe('master.json');
    const variants: unknown = JSON.parse(td.decode(json?.bytes));
    expect(variants).toMatchObject([
      { uri: '360p/index.m3u8', bandwidth: 800000, resolution: '640x360', frameRate: 25 },
      { uri: '1080p/index.m3u8', bandwidth: 5000000, hdcpLevel: 'TYPE-0' },
      { uri: '720p/index.m3u8', codecs: 'avc1.64001f,mp4a.40.2' },
    ]);
  });

  it('lists URLs', async () => {
    const { run } = await engineWith(MASTER);
    const [list] = await run('playlist.urls');
    expect(list?.note).toBe('7 URLs');
    expect(td.decode(list?.bytes)).toBe(
      [
        '360p/index.m3u8',
        '1080p/index.m3u8',
        '720p/index.m3u8',
        '720p/iframes.m3u8',
        'audio/en/index.m3u8',
        'audio/fr/index.m3u8',
        'subs/en.m3u8',
        '',
      ].join('\n'),
    );
  });
});
