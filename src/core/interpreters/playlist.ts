import { createMemo } from '../content';
import { formatCount, plural } from '../format';
import { hasKind } from '../guards';
import { unsupportedSlice, type Interpreter } from '../interpreter';
import {
  formatBitrate,
  formatClock,
  hasM3uHeader,
  looksLikeEntries,
  parsePlaylist,
  resolutionLabel,
  variantsByBandwidth,
  type MasterPlaylist,
  type MediaPlaylist,
  type PlainPlaylist,
  type Playlist,
  type Variant,
} from '../playlist/m3u';
import type { ColumnInfo, StatRow, TableInfo } from '../types';

export type PlaylistValue = { kind: 'playlist'; source: string } & Playlist;

/** `#EXTM3U` first: as sure as a text format gets. */
const HEADER_CONFIDENCE = 0.95;
/** A playlist's name or MIME type with only URL/path lines: above text (0.3) and records. */
const NAMED_CONFIDENCE = 0.6;
const PLAYLIST_NAME = /\.m3u8?$/i;
const PLAYLIST_MIME = /mpegurl/i;

const detectPlaylist = createMemo(c => {
  const text = c.text;
  if (text === null) return 0;
  if (hasM3uHeader(text)) return HEADER_CONFIDENCE;
  const named = PLAYLIST_NAME.test(c.name ?? '') || PLAYLIST_MIME.test(c.mime);
  return named && looksLikeEntries(text) ? NAMED_CONFIDENCE : 0;
});

const typeName = (p: Playlist) =>
  p.type === 'master' ? 'HLS master' : p.type === 'media' ? 'HLS media' : 'Playlist';

const maxHeight = (variants: Variant[]) =>
  variants.reduce((h, v) => Math.max(h, v.resolution?.height ?? 0), 0);

const liveLabel = (p: MediaPlaylist) =>
  p.endList || p.playlistType === 'VOD'
    ? 'VOD'
    : p.playlistType === 'EVENT'
      ? 'live (event)'
      : 'live';

function label(v: PlaylistValue): string {
  const parts = [typeName(v)];
  if (v.type === 'master') {
    parts.push(plural(v.variants.length, 'variant'));
    const h = maxHeight(v.variants);
    if (h > 0) parts.push(`up to ${h}p`);
  } else if (v.type === 'media') {
    parts.push(plural(v.segments.length, 'segment'), formatClock(v.totalDuration), liveLabel(v));
  } else {
    parts.push(plural(v.tracks.length, 'track'));
    const known = v.tracks.filter(t => t.duration !== null);
    if (known.length > 0) parts.push(formatClock(known.reduce((s, t) => s + (t.duration ?? 0), 0)));
  }
  return parts.join(' · ');
}

// --- Tables ---

interface Table {
  info: TableInfo;
  rows: () => Record<string, unknown>[];
}

const col = (name: string, type = 'string'): ColumnInfo => ({ name, type });

const variantColumns = [
  col('bandwidth'),
  col('average'),
  col('resolution'),
  col('frame rate', 'number'),
  col('codecs'),
  col('audio'),
  col('subtitles'),
  col('hdcp'),
  col('uri'),
];

const variantRow = (v: Variant) => ({
  bandwidth: v.bandwidth === null ? null : formatBitrate(v.bandwidth),
  average: v.averageBandwidth === null ? null : formatBitrate(v.averageBandwidth),
  resolution: v.resolution ? `${v.resolution.width}×${v.resolution.height}` : null,
  'frame rate': v.frameRate,
  codecs: v.codecs,
  audio: v.audio,
  subtitles: v.subtitles,
  hdcp: v.hdcpLevel,
  uri: v.uri,
});

const yes = (b: boolean) => (b ? 'yes' : '');

function masterTables(p: MasterPlaylist): Table[] {
  const tables: Table[] = [
    {
      info: { name: 'Variants', extent: p.variants.length, columns: variantColumns },
      rows: () => variantsByBandwidth(p.variants).map(variantRow),
    },
  ];
  if (p.renditions.length > 0) {
    tables.push({
      info: {
        name: 'Renditions',
        extent: p.renditions.length,
        columns: [
          'type',
          'group',
          'name',
          'language',
          'default',
          'autoselect',
          'forced',
          'channels',
          'uri',
        ].map(n => col(n)),
      },
      rows: () =>
        p.renditions.map(r => ({
          type: r.type,
          group: r.groupId,
          name: r.name,
          language: r.language,
          default: yes(r.default),
          autoselect: yes(r.autoselect),
          forced: yes(r.forced),
          channels: r.channels,
          uri: r.uri,
        })),
    });
  }
  if (p.iframeStreams.length > 0) {
    tables.push({
      info: { name: 'I-frame streams', extent: p.iframeStreams.length, columns: variantColumns },
      rows: () => variantsByBandwidth(p.iframeStreams).map(variantRow),
    });
  }
  return tables;
}

const segmentColumns = [
  col('sequence', 'number'),
  col('duration', 'number'),
  col('start'),
  col('uri'),
  col('title'),
  col('byte range'),
  col('discontinuity'),
  col('date-time'),
  col('key'),
];

function mediaTables(p: MediaPlaylist): Table[] {
  return [
    {
      info: { name: 'Segments', extent: p.segments.length, columns: segmentColumns },
      rows: () =>
        p.segments.map(s => {
          const key = s.key === null ? undefined : p.keys[s.key];
          return {
            sequence: s.sequence,
            duration: s.duration,
            start: formatClock(s.start),
            uri: s.uri,
            title: s.title,
            'byte range': s.byteRange
              ? `${s.byteRange.length}${s.byteRange.offset === null ? '' : `@${s.byteRange.offset}`}`
              : null,
            discontinuity: yes(s.discontinuity),
            'date-time': s.programDateTime,
            key: key?.method ?? null,
          };
        }),
    },
  ];
}

function plainTables(p: PlainPlaylist): Table[] {
  return [
    {
      info: {
        name: 'Tracks',
        extent: p.tracks.length,
        columns: [col('duration'), col('artist'), col('title'), col('group'), col('uri')],
      },
      rows: () =>
        p.tracks.map(t => ({
          duration: t.duration === null ? null : formatClock(t.duration),
          artist: t.artist,
          title: t.title,
          group: t.group,
          uri: t.uri,
        })),
    },
  ];
}

const tablesCache = new WeakMap<PlaylistValue, Table[]>();
const rowsCache = new WeakMap<Table, Record<string, unknown>[]>();

function tablesOf(v: PlaylistValue): Table[] {
  let tables = tablesCache.get(v);
  if (!tables) {
    tables =
      v.type === 'master' ? masterTables(v) : v.type === 'media' ? mediaTables(v) : plainTables(v);
    tablesCache.set(v, tables);
  }
  return tables;
}

function rowsOf(t: Table): Record<string, unknown>[] {
  let rows = rowsCache.get(t);
  if (!rows) {
    rows = t.rows();
    rowsCache.set(t, rows);
  }
  return rows;
}

// --- Stats ---

/** "2 audio, 3 subtitles" from the renditions' TYPEs. */
function renditionCounts(p: MasterPlaylist): string {
  const counts = new Map<string, number>();
  for (const r of p.renditions)
    counts.set(r.type.toLowerCase(), (counts.get(r.type.toLowerCase()) ?? 0) + 1);
  return [...counts]
    .map(([t, n]) => `${formatCount(n)} ${t.replace('closed-captions', 'captions')}`)
    .join(', ');
}

const distinct = (xs: (string | null)[]) => [...new Set(xs.filter(x => x !== null && x !== ''))];

function masterStats(p: MasterPlaylist): StatRow[] {
  const sorted = variantsByBandwidth(p.variants);
  const top = sorted[0];
  const bottom = sorted.at(-1);
  const stats: StatRow[] = [{ label: 'Variants', value: formatCount(p.variants.length) }];
  if (top?.bandwidth != null) {
    stats.push({
      label: 'Highest',
      value: [top.resolution && resolutionLabel(top.resolution), formatBitrate(top.bandwidth)]
        .filter(Boolean)
        .join(' · '),
    });
  }
  if (bottom?.bandwidth != null && bottom !== top) {
    stats.push({
      label: 'Lowest',
      value: [
        bottom.resolution && resolutionLabel(bottom.resolution),
        formatBitrate(bottom.bandwidth),
      ]
        .filter(Boolean)
        .join(' · '),
    });
  }
  if (p.renditions.length > 0) stats.push({ label: 'Renditions', value: renditionCounts(p) });
  if (p.iframeStreams.length > 0) {
    stats.push({ label: 'I-frame streams', value: formatCount(p.iframeStreams.length) });
  }
  const codecs = distinct(p.variants.flatMap(v => (v.codecs ?? '').split(',').map(c => c.trim())));
  if (codecs.length > 0) stats.push({ label: 'Codecs', value: codecs.join(', ') });
  if (p.sessionKeys.length > 0) {
    stats.push({
      label: 'Session keys',
      value: p.sessionKeys.map(k => k.method + (k.uri ? ` (${k.uri})` : '')).join(', '),
    });
  }
  if (p.sessionData.length > 0) {
    stats.push({
      label: 'Session data',
      value:
        distinct(p.sessionData.map(d => d['DATA-ID'] ?? null)).join(', ') ||
        formatCount(p.sessionData.length),
    });
  }
  return stats;
}

function mediaStats(p: MediaPlaylist): StatRow[] {
  const stats: StatRow[] = [
    {
      label: 'Playlist type',
      value:
        p.endList || p.playlistType === 'VOD'
          ? 'VOD'
          : p.playlistType === 'EVENT'
            ? 'Live (event)'
            : 'Live',
    },
    { label: 'Segments', value: formatCount(p.segments.length) },
    { label: 'Total duration', value: formatClock(p.totalDuration) },
  ];
  if (p.targetDuration !== null)
    stats.push({ label: 'Target duration', value: `${p.targetDuration} s` });
  stats.push({ label: 'Media sequence', value: String(p.mediaSequence) });
  stats.push({ label: 'Discontinuities', value: formatCount(p.discontinuities) });
  const encrypted = p.segments.filter(s => s.key !== null).length;
  stats.push({
    label: 'Encryption',
    value:
      p.keys.length === 0
        ? 'none'
        : `${distinct(p.keys.map(k => k.method)).join(', ')} · ${plural(encrypted, 'segment')}`,
    ...(p.keys.length > 0 && {
      children: p.keys.map((k, i) => ({
        label: `Key ${i + 1}`,
        value: [k.method, k.uri ?? '(no URI)', k.keyFormat && `format ${k.keyFormat}`]
          .filter(Boolean)
          .join(' · '),
      })),
    }),
  });
  if (p.maps.length > 0) {
    stats.push({ label: 'Init section', value: distinct(p.maps.map(m => m.uri)).join(', ') });
  }
  const ranged = p.segments.filter(s => s.byteRange !== null).length;
  if (ranged > 0) stats.push({ label: 'Byte-range segments', value: formatCount(ranged) });
  const firstDate = p.segments.find(s => s.programDateTime !== null)?.programDateTime;
  if (firstDate) stats.push({ label: 'Program date-time', value: firstDate });
  if (p.partCount > 0) {
    stats.push({
      label: 'Partial segments',
      value:
        formatCount(p.partCount) + (p.partTarget === null ? '' : ` · target ${p.partTarget} s`),
    });
  }
  if (p.iframesOnly) stats.push({ label: 'I-frames only', value: 'yes' });
  return stats;
}

function plainStats(p: PlainPlaylist): StatRow[] {
  const known = p.tracks.filter(t => t.duration !== null);
  const remote = p.tracks.filter(t => /^[a-z][a-z0-9+.-]*:\/\//i.test(t.uri)).length;
  const groups = distinct(p.tracks.map(t => t.group));
  const stats: StatRow[] = [];
  if (p.title) stats.push({ label: 'Title', value: p.title });
  stats.push({ label: 'Tracks', value: formatCount(p.tracks.length) });
  if (known.length > 0) {
    stats.push({
      label: 'Total duration',
      value:
        formatClock(known.reduce((s, t) => s + (t.duration ?? 0), 0)) +
        (known.length < p.tracks.length
          ? ` (${formatCount(p.tracks.length - known.length)} unknown)`
          : ''),
    });
  }
  stats.push(
    { label: 'URLs', value: formatCount(remote) },
    { label: 'Paths', value: formatCount(p.tracks.length - remote) },
  );
  if (groups.length > 0) stats.push({ label: 'Groups', value: formatCount(groups.length) });
  return stats;
}

function stats(v: PlaylistValue): StatRow[] {
  const head: StatRow[] = [
    {
      label: 'Format',
      value:
        v.type === 'master'
          ? 'HLS master playlist'
          : v.type === 'media'
            ? 'HLS media playlist'
            : v.header
              ? 'Extended M3U'
              : 'M3U',
    },
  ];
  if (v.version !== null) head.push({ label: 'Version', value: String(v.version) });
  const body =
    v.type === 'master' ? masterStats(v) : v.type === 'media' ? mediaStats(v) : plainStats(v);
  const tail: StatRow[] = [];
  if (v.independentSegments) tail.push({ label: 'Independent segments', value: 'yes' });
  if (v.defines > 0) tail.push({ label: 'Variables', value: formatCount(v.defines) });
  if (v.unknownTags.length > 0) {
    tail.push({
      label: 'Other tags',
      value: distinct(v.unknownTags.map(t => t.name)).join(', '),
    });
  }
  return [...head, ...body, ...tail];
}

/** M3U playlists and HLS master/media playlists, parsed in core. */
export const playlistInterpreter: Interpreter<PlaylistValue> = {
  kind: 'playlist',
  isValue: (v): v is PlaylistValue => hasKind(v, 'playlist'),
  detect: detectPlaylist,
  parse(c) {
    const source = c.text ?? '';
    return { kind: 'playlist', source, ...parsePlaylist(source) };
  },
  label,
  summarise(v) {
    const tables = tablesOf(v).map(t => t.info);
    const first = tables[0];
    return {
      stats: stats(v),
      extent: first?.extent ?? 0,
      columns: first?.columns ?? [],
      tables,
    };
  },
  slice(v, req) {
    switch (req.type) {
      case 'rows': {
        const table = tablesOf(v)[req.table ?? 0];
        if (!table) throw new Error(`No table ${req.table ?? 0}`);
        return rowsOf(table).slice(req.from, req.to);
      }
      case 'text':
        return v.source;
      case 'lines':
        return v.source.split(/\r\n|\r|\n/).slice(req.from, req.to);
      default:
        return unsupportedSlice('playlist', req);
    }
  },
  export: v => ({ text: v.source }),
};
