import { gridCsv } from '../../csvGrid';
import { plural } from '../../format';
import { playlistInterpreter, type PlaylistValue } from '../../interpreters/playlist';
import {
  playlistUris,
  resolvePlaylistUris,
  type ByteRange,
  type MediaPlaylist,
  type Variant,
} from '../../playlist/m3u';
import {
  playlistResolveUrls,
  playlistSegmentsCsv,
  playlistSegmentsJson,
  playlistUrls,
  playlistVariantsJson,
} from '../catalog/playlist';
import { implement } from '../types';
import { textResult, withExtension } from './util';

const value = playlistInterpreter.isValue;

const isMedia = (v: PlaylistValue) => v.type === 'media' && v.segments.length > 0;

/** The base URL setting, checked: empty, or an absolute http(s) URL. */
function baseUrl(base: string): string | null {
  const trimmed = base.trim();
  if (trimmed === '') return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`Base URL isn't a valid URL: ${trimmed}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Base URL must start with http:// or https://');
  }
  return url.href;
}

const rangeText = (r: ByteRange | null) =>
  r ? `${r.length}${r.offset === null ? '' : `@${r.offset}`}` : '';

/** Seconds to 3 decimal places, without float noise (6.006 + 6.006 + …). */
const seconds = (n: number) => Math.round(n * 1000) / 1000;

function segmentObjects(p: MediaPlaylist) {
  return p.segments.map(s => {
    const key = s.key === null ? null : (p.keys[s.key] ?? null);
    const map = s.map === null ? null : (p.maps[s.map] ?? null);
    return {
      sequence: s.sequence,
      uri: s.uri,
      duration: s.duration,
      start: seconds(s.start),
      title: s.title,
      byteRange: s.byteRange,
      discontinuity: s.discontinuity,
      programDateTime: s.programDateTime,
      key: key && { method: key.method, uri: key.uri, iv: key.iv, keyFormat: key.keyFormat },
      map,
      gap: s.gap,
      parts: s.parts,
    };
  });
}

const variantObject = (v: Variant) => ({
  uri: v.uri,
  bandwidth: v.bandwidth,
  averageBandwidth: v.averageBandwidth,
  resolution: v.resolution && `${v.resolution.width}x${v.resolution.height}`,
  codecs: v.codecs,
  frameRate: v.frameRate,
  audio: v.audio,
  video: v.video,
  subtitles: v.subtitles,
  closedCaptions: v.closedCaptions,
  hdcpLevel: v.hdcpLevel,
  attributes: v.attributes,
});

export const playlistImpls = [
  implement(playlistResolveUrls, {
    value,
    run({ value, content }, { base }) {
      const url = baseUrl(base);
      const hls = value.type !== 'plain';
      const name = content.name ?? (hls ? 'playlist.m3u8' : 'playlist.m3u');
      const mime = hls ? 'application/vnd.apple.mpegurl' : 'audio/x-mpegurl';
      if (url === null) {
        return { ...textResult(value.source, mime, name), note: 'no base URL: unchanged' };
      }
      const resolved = resolvePlaylistUris(value.source, url);
      return {
        ...textResult(resolved.text, mime, name),
        note: `${plural(resolved.changed, 'URI')} resolved`,
      };
    },
  }),
  implement(playlistSegmentsCsv, {
    value,
    applies: ({ value }) => isMedia(value),
    run({ value, content }) {
      if (value.type !== 'media') return [];
      const rows = segmentObjects(value).map(s => [
        String(s.sequence),
        String(s.duration),
        String(s.start),
        s.uri,
        s.title,
        rangeText(s.byteRange),
        s.discontinuity ? 'true' : 'false',
        s.programDateTime ?? '',
        s.key?.method ?? '',
        s.key?.uri ?? '',
      ]);
      const header = [
        'sequence',
        'duration',
        'start',
        'uri',
        'title',
        'byte_range',
        'discontinuity',
        'program_date_time',
        'key_method',
        'key_uri',
      ];
      return textResult(
        gridCsv([header, ...rows]),
        'text/csv',
        withExtension(content.name, 'csv', 'segments'),
      );
    },
  }),
  implement(playlistSegmentsJson, {
    value,
    applies: ({ value }) => isMedia(value),
    run({ value, content }) {
      if (value.type !== 'media') return [];
      return textResult(
        JSON.stringify(segmentObjects(value), null, 2),
        'application/json',
        withExtension(content.name, 'json', 'segments'),
      );
    },
  }),
  implement(playlistVariantsJson, {
    value,
    applies: ({ value }) => value.type === 'master' && value.variants.length > 0,
    run({ value, content }) {
      if (value.type !== 'master') return [];
      return textResult(
        JSON.stringify(value.variants.map(variantObject), null, 2),
        'application/json',
        withExtension(content.name, 'json', 'variants'),
      );
    },
  }),
  implement(playlistUrls, {
    value,
    applies: ({ value }) => playlistUris(value).length > 0,
    run({ value }) {
      const uris = playlistUris(value);
      return {
        ...textResult(uris.join('\n') + '\n', 'text/plain', 'urls.txt'),
        note: plural(uris.length, 'URL'),
      };
    },
  }),
];
