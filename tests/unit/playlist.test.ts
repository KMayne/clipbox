import { describe, expect, it } from 'vitest';
import { makeContent } from '../../src/core/content';
import { detectKinds } from '../../src/core/interpreters';
import { playlistInterpreter } from '../../src/core/interpreters/playlist';
import {
  formatClock,
  isUriLike,
  parseAttributes,
  parsePlaylist,
  resolvePlaylistUris,
  type Playlist,
} from '../../src/core/playlist/m3u';
import { textContent } from './helpers';
import { MASTER, MEDIA_VOD } from '../fixtures/playlists';

const LIVE = `#EXTM3U
#EXT-X-TARGETDURATION:4
#EXT-X-MEDIA-SEQUENCE:5000
#EXT-X-PART-INF:PART-TARGET=1.0
#EXTINF:4.0,
live5000.ts
#EXT-X-PART:DURATION=1.0,URI="live5001.part0.ts"
#EXT-X-PART:DURATION=1.0,URI="live5001.part1.ts"
#EXTINF:4.0,
live5001.ts
#EXT-X-PART:DURATION=1.0,URI="live5002.part0.ts"
#EXT-X-PRELOAD-HINT:TYPE=PART,URI="live5002.part1.ts"
`;

const BYTE_RANGES = `#EXTM3U
#EXT-X-VERSION:4
#EXT-X-TARGETDURATION:10
#EXTINF:10,
#EXT-X-BYTERANGE:75232@0
main.ts
#EXTINF:10,
#EXT-X-BYTERANGE:82112
main.ts
#EXTINF:10,
#EXT-X-BYTERANGE:69864@157344
main.ts
#EXT-X-ENDLIST
`;

const PLAIN_CRLF = [
  '#EXTM3U',
  '#PLAYLIST:Road trip',
  '#EXTINF:215,Queen - Bohemian Rhapsody',
  'C:\\Music\\Queen\\Bohemian Rhapsody.mp3',
  '#EXTGRP:Rock',
  '#EXTINF:-1,Radio stream',
  'http://radio.example.com:8000/stream',
  '#EXTINF:3600 tvg-id="bbc1" group-title="News, UK",BBC One',
  'https://iptv.example.com/bbc1.m3u8',
  '',
].join('\r\n');

const parse = (text: string): Playlist => parsePlaylist(text);

describe('attribute lists', () => {
  it('keeps commas inside quoted strings and reads unquoted values', () => {
    expect(
      parseAttributes(
        'BANDWIDTH=1280000,CODECS="avc1.4d401e,mp4a.40.2",RESOLUTION=640x360, NAME="a=b"',
      ),
    ).toEqual({
      BANDWIDTH: '1280000',
      CODECS: 'avc1.4d401e,mp4a.40.2',
      RESOLUTION: '640x360',
      NAME: 'a=b',
    });
  });

  it('tolerates an unterminated quote and empty values', () => {
    expect(parseAttributes('URI="half,open')).toEqual({ URI: 'half,open' });
    expect(parseAttributes('A=,B="",C=x')).toEqual({ A: '', B: '', C: 'x' });
  });
});

describe('master playlists', () => {
  const p = parse(MASTER);

  it('reads variants, renditions, I-frame streams and session tags', () => {
    if (p.type !== 'master') throw new Error(p.type);
    expect(p.version).toBe(6);
    expect(p.independentSegments).toBe(true);
    expect(p.variants.map(v => v.uri)).toEqual([
      '360p/index.m3u8',
      '1080p/index.m3u8',
      '720p/index.m3u8',
    ]);
    expect(p.variants[0]).toMatchObject({
      bandwidth: 800000,
      averageBandwidth: 700000,
      resolution: { width: 640, height: 360 },
      codecs: 'avc1.4d401e,mp4a.40.2',
      frameRate: 25,
      audio: 'aac',
      subtitles: 'subs',
    });
    expect(p.variants[1]?.hdcpLevel).toBe('TYPE-0');
    expect(p.renditions.map(r => [r.type, r.name, r.default])).toEqual([
      ['AUDIO', 'English', true],
      ['AUDIO', 'Français, VF', false],
      ['SUBTITLES', 'English', false],
    ]);
    expect(p.iframeStreams[0]?.uri).toBe('720p/iframes.m3u8');
    expect(p.sessionKeys[0]).toMatchObject({ method: 'SAMPLE-AES', uri: 'skd://key-1' });
    expect(p.sessionData[0]?.VALUE).toBe('Big, Buck Bunny');
    expect(p.unknownTags).toEqual([
      { name: 'EXT-X-FUTURE-TAG', text: '#EXT-X-FUTURE-TAG:SOMETHING=1', line: 16 },
    ]);
  });

  it('labels and tabulates by bandwidth', async () => {
    const v = await playlistInterpreter.parse(textContent(MASTER), { service: async () => null });
    expect(playlistInterpreter.label(v)).toBe('HLS master · 3 variants · up to 1080p');
    const s = await playlistInterpreter.summarise(v);
    expect(s.tables?.map(t => [t.name, t.extent])).toEqual([
      ['Variants', 3],
      ['Renditions', 3],
      ['I-frame streams', 1],
    ]);
    const rows = await playlistInterpreter.slice(v, { type: 'rows', from: 0, to: 10 });
    expect(rows).toMatchObject([
      { bandwidth: '5.00 Mbps', resolution: '1920×1080', uri: '1080p/index.m3u8' },
      { bandwidth: '2.50 Mbps', uri: '720p/index.m3u8' },
      { bandwidth: '800 kbps', average: '700 kbps', uri: '360p/index.m3u8' },
    ]);
    const renditions = await playlistInterpreter.slice(v, {
      type: 'rows',
      from: 1,
      to: 2,
      table: 1,
    });
    expect(renditions).toEqual([
      {
        type: 'AUDIO',
        group: 'aac',
        name: 'Français, VF',
        language: 'fr',
        default: '',
        autoselect: '',
        forced: '',
        channels: null,
        uri: 'audio/fr/index.m3u8',
      },
    ]);
    const stat = (label: string) => s.stats.find(r => r.label === label)?.value;
    expect(stat('Highest')).toBe('1080p · 5.00 Mbps');
    expect(stat('Renditions')).toBe('2 audio, 1 subtitles');
    expect(stat('Other tags')).toBe('EXT-X-FUTURE-TAG');
  });
});

describe('media playlists', () => {
  it('reads a VOD playlist with a key, a map and a discontinuity', async () => {
    const p = parse(MEDIA_VOD);
    if (p.type !== 'media') throw new Error(p.type);
    expect(p).toMatchObject({
      version: 7,
      targetDuration: 6,
      mediaSequence: 100,
      playlistType: 'VOD',
      endList: true,
      discontinuities: 1,
    });
    expect(p.totalDuration).toBeCloseTo(16.512);
    expect(p.segments.map(s => [s.sequence, s.uri, s.key, s.discontinuity])).toEqual([
      [100, 'seg100.m4s', 0, false],
      [101, 'seg101.m4s', 0, false],
      [102, 'https://other.example.com/ad.ts', null, true],
    ]);
    expect(p.segments[0]).toMatchObject({
      title: 'Intro',
      programDateTime: '2024-01-01T00:00:00.000Z',
      map: 0,
    });
    expect(p.keys).toEqual([
      {
        method: 'AES-128',
        uri: 'https://keys.example.com/key?id=1',
        iv: '0x00000000000000000000000000000001',
        keyFormat: null,
      },
    ]);
    expect(p.maps).toEqual([{ uri: 'init.mp4', byteRange: null }]);

    const v = await playlistInterpreter.parse(textContent(MEDIA_VOD), {
      service: async () => null,
    });
    expect(playlistInterpreter.label(v)).toBe('HLS media · 3 segments · 0:17 · VOD');
    const s = await playlistInterpreter.summarise(v);
    const stat = (label: string) => s.stats.find(r => r.label === label)?.value;
    expect(stat('Encryption')).toBe('AES-128 · 2 segments');
    expect(stat('Discontinuities')).toBe('1');
    expect(stat('Init section')).toBe('init.mp4');
    expect(s.tables?.[0]?.name).toBe('Segments');
    const rows = await playlistInterpreter.slice(v, { type: 'rows', from: 2, to: 3 });
    expect(rows).toMatchObject([
      { sequence: 102, duration: 4.5, start: '0:12', discontinuity: 'yes', key: null },
    ]);
  });

  it('reads a live LL-HLS playlist and counts its partial segments', async () => {
    const p = parse(LIVE);
    if (p.type !== 'media') throw new Error(p.type);
    expect(p.endList).toBe(false);
    expect(p.partCount).toBe(3);
    expect(p.partTarget).toBe(1);
    expect(p.preloadHints).toBe(1);
    expect(p.segments.map(s => s.parts)).toEqual([0, 2]);
    const v = await playlistInterpreter.parse(textContent(LIVE), { service: async () => null });
    expect(playlistInterpreter.label(v)).toBe('HLS media · 2 segments · 0:08 · live');
  });

  it('treats an EVENT playlist without ENDLIST as live', async () => {
    const text = '#EXTM3U\n#EXT-X-PLAYLIST-TYPE:EVENT\n#EXTINF:10,\na.ts\n';
    const v = await playlistInterpreter.parse(textContent(text), { service: async () => null });
    expect(playlistInterpreter.label(v)).toBe('HLS media · 1 segment · 0:10 · live (event)');
  });

  it('continues byte ranges without an offset from the previous one', () => {
    const p = parse(BYTE_RANGES);
    if (p.type !== 'media') throw new Error(p.type);
    expect(p.segments.map(s => s.byteRange)).toEqual([
      { length: 75232, offset: 0 },
      { length: 82112, offset: 75232 },
      { length: 69864, offset: 157344 },
    ]);
  });
});

describe('plain M3U', () => {
  it('reads tracks from a CRLF file with a BOM, artists, groups and IPTV attributes', async () => {
    const p = parse('\uFEFF' + PLAIN_CRLF);
    if (p.type !== 'plain') throw new Error(p.type);
    expect(p.header).toBe(true);
    expect(p.title).toBe('Road trip');
    expect(p.tracks.map(t => [t.artist, t.title, t.duration, t.group, t.uri])).toEqual([
      ['Queen', 'Bohemian Rhapsody', 215, null, 'C:\\Music\\Queen\\Bohemian Rhapsody.mp3'],
      [null, 'Radio stream', null, 'Rock', 'http://radio.example.com:8000/stream'],
      [null, 'BBC One', 3600, 'News, UK', 'https://iptv.example.com/bbc1.m3u8'],
    ]);
    expect(p.tracks[2]?.attributes).toEqual({ 'tvg-id': 'bbc1', 'group-title': 'News, UK' });

    const v = await playlistInterpreter.parse(textContent('\uFEFF' + PLAIN_CRLF), {
      service: async () => null,
    });
    expect(playlistInterpreter.label(v)).toBe('Playlist · 3 tracks · 1:03:35');
  });

  it('reads a headerless list of paths', () => {
    const p = parse('Music/a.mp3\nMusic/b.flac\n');
    expect(p.type).toBe('plain');
    if (p.type === 'plain')
      expect(p.tracks.map(t => t.uri)).toEqual(['Music/a.mp3', 'Music/b.flac']);
  });
});

describe('playlist detection', () => {
  const kindsOf = (text: string, mime = 'text/plain', name?: string) =>
    detectKinds(makeContent(mime, new TextEncoder().encode(text), name)).map(d => d.kind);

  it('puts playlist first for an #EXTM3U header, even after a BOM and blank lines', () => {
    expect(kindsOf(MASTER)[0]).toBe('playlist');
    expect(kindsOf('\uFEFF\n\n' + MEDIA_VOD)[0]).toBe('playlist');
    expect(kindsOf(PLAIN_CRLF)[0]).toBe('playlist');
  });

  it('accepts a headerless .m3u file of paths and URLs', () => {
    expect(kindsOf('Music/a.mp3\r\nhttp://example.com/b.mp3\r\n', 'audio/x-mpegurl')[0]).toBe(
      'playlist',
    );
    expect(kindsOf('a.mp3\nb.mp3\n', 'text/plain', 'mix.m3u')[0]).toBe('playlist');
  });

  it('ignores ordinary text', () => {
    expect(kindsOf('Hello world\nThis is a note.\n')).not.toContain('playlist');
    expect(kindsOf('Notes about #EXTM3U playlists\n#EXTM3U\n')).not.toContain('playlist');
    expect(kindsOf('# Heading\n\n- item\n')).not.toContain('playlist');
    expect(kindsOf('#EXTM3Ufoo\nseg.ts\n')).not.toContain('playlist');
    // A playlist's name isn't enough when the lines are prose
    expect(kindsOf('Buy milk\nCall Sam\n', 'text/plain', 'todo.m3u')).not.toContain('playlist');
    expect(kindsOf('', 'text/plain', 'empty.m3u')).not.toContain('playlist');
  });

  it('tells URL and path lines from prose', () => {
    expect(isUriLike('https://example.com/a.ts')).toBe(true);
    expect(isUriLike('C:\\Music\\a b.mp3')).toBe(true);
    expect(isUriLike('song.mp3')).toBe(true);
    expect(isUriLike('Note: this is prose')).toBe(false);
    expect(isUriLike('just some words')).toBe(false);
  });
});

describe('URL resolution', () => {
  it('rewrites URI lines and URI attributes, keeping CRLF, unknown tags and absolute URIs', () => {
    const text =
      '#EXTM3U\r\n#EXT-X-MAP:URI="init.mp4",BYTERANGE="100@0"\r\n#EXT-X-KEY:METHOD=AES-128,URI="../keys/k1"\r\n#EXT-X-CUSTOM:URI="x"\r\n#EXTINF:6,\r\nseg1.ts\r\n#EXTINF:6,\r\nhttps://cdn.example.org/seg2.ts\r\n';
    const out = resolvePlaylistUris(text, 'https://cdn.example.com/hls/v1/index.m3u8');
    expect(out.text).toBe(
      '#EXTM3U\r\n#EXT-X-MAP:URI="https://cdn.example.com/hls/v1/init.mp4",BYTERANGE="100@0"\r\n#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.example.com/hls/keys/k1"\r\n#EXT-X-CUSTOM:URI="https://cdn.example.com/hls/v1/x"\r\n#EXTINF:6,\r\nhttps://cdn.example.com/hls/v1/seg1.ts\r\n#EXTINF:6,\r\nhttps://cdn.example.org/seg2.ts\r\n',
    );
    expect(out.changed).toBe(4);
  });

  it('formats durations as a clock', () => {
    expect(formatClock(2052)).toBe('34:12');
    expect(formatClock(5530)).toBe('1:32:10');
    expect(formatClock(7.6)).toBe('0:08');
  });
});
