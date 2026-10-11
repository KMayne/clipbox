import { parseBuffer, selectCover, type IAudioMetadata } from 'music-metadata';
import type { EntryContent } from '../../core/content';
import { formatBytes } from '../../core/format';
import { hasKind } from '../../core/guards';
import { unsupportedSlice, type Interpreter } from '../../core/interpreter';
import type { StatRow } from '../../core/types';
import { parseAvi, parseMp4, type ContainerInfo, type VideoTrackInfo } from './containers';
import { sniff, type MediaContainer } from './detect';

export type MediaKind = 'audio' | 'video';

export interface MediaTags {
  title?: string;
  artist?: string;
  album?: string;
  year?: string;
  track?: string;
}

export interface MediaValue<K extends MediaKind = MediaKind> {
  kind: K;
  container: MediaContainer;
  /** Display name, e.g. "MP3", "WebM". */
  format: string;
  /** Playback MIME type: audio/* when there's no video track. */
  mime: string;
  hasVideo: boolean;
  codecs: string[];
  /** Seconds. */
  duration: number | null;
  /** Bits per second. */
  bitrate: number | null;
  sampleRate: number | null;
  channels: number | null;
  bitDepth: number | null;
  lossless: boolean | null;
  tags: MediaTags;
  cover: { bytes: Uint8Array<ArrayBuffer>; mime: string } | null;
  video: VideoTrackInfo | null;
  /** Why metadata parsing failed, if it did; the value still holds what the header showed. */
  warning: string | null;
  bytes: Uint8Array<ArrayBuffer>;
}

const FORMAT_NAMES: Record<MediaContainer, string> = {
  mp3: 'MP3',
  wav: 'WAV',
  ogg: 'Ogg',
  flac: 'FLAC',
  m4a: 'M4A',
  mp4: 'MP4',
  mov: 'MOV',
  webm: 'WebM',
  mkv: 'MKV',
  avi: 'AVI',
};

/** MIME types given to music-metadata (to pick its parser) and to the player. */
const MIMES: Record<MediaContainer, { audio: string; video: string }> = {
  mp3: { audio: 'audio/mpeg', video: 'audio/mpeg' },
  wav: { audio: 'audio/wav', video: 'audio/wav' },
  ogg: { audio: 'audio/ogg', video: 'video/ogg' },
  flac: { audio: 'audio/flac', video: 'audio/flac' },
  m4a: { audio: 'audio/mp4', video: 'video/mp4' },
  mp4: { audio: 'audio/mp4', video: 'video/mp4' },
  mov: { audio: 'audio/mp4', video: 'video/quicktime' },
  webm: { audio: 'audio/webm', video: 'video/webm' },
  mkv: { audio: 'audio/x-matroska', video: 'video/x-matroska' },
  avi: { audio: 'video/x-msvideo', video: 'video/x-msvideo' },
};

const positive = (n: number | undefined | null) =>
  n !== undefined && n !== null && Number.isFinite(n) && n > 0 ? n : null;

/** "3:42", "1:02:03"; "0:00.4" below a second so very short clips don't read as empty. */
export function formatDuration(seconds: number): string {
  if (seconds > 0 && seconds < 1) return `0:00.${Math.max(1, Math.round(seconds * 10))}`;
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export const formatBitrate = (bps: number) => `${Math.round(bps / 1000)} kbps`;

function tagsOf(meta: IAudioMetadata | null): MediaTags {
  if (!meta) return {};
  const { title, artist, album, year, track } = meta.common;
  const tags: MediaTags = {};
  if (title) tags.title = title;
  if (artist) tags.artist = artist;
  if (album) tags.album = album;
  if (year) tags.year = String(year);
  if (track.no !== null)
    tags.track = track.of !== null ? `${track.no}/${track.of}` : String(track.no);
  return tags;
}

function coverOf(meta: IAudioMetadata | null): MediaValue['cover'] {
  const pic = selectCover(meta?.common.picture);
  if (!pic) return null;
  const bytes = new Uint8Array(pic.data.byteLength);
  bytes.set(pic.data);
  const mime = pic.format.includes('/') ? pic.format : `image/${pic.format.toLowerCase()}`;
  return { bytes, mime: mime === 'image/jpg' ? 'image/jpeg' : mime };
}

function containerInfo(container: MediaContainer, bytes: Uint8Array): ContainerInfo | null {
  try {
    if (container === 'mp4' || container === 'mov' || container === 'm4a') return parseMp4(bytes);
    if (container === 'avi') return parseAvi(bytes);
  } catch {
    // Truncated or odd boxes: music-metadata's view is used alone
  }
  return null;
}

function videoFromMetadata(meta: IAudioMetadata | null): VideoTrackInfo | null {
  const track = meta?.format.trackInfo.find(t => t.video);
  const v = track?.video;
  if (!v) return null;
  const width = v.displayWidth ?? v.pixelWidth ?? 0;
  const height = v.displayHeight ?? v.pixelHeight ?? 0;
  return {
    width: v.pixelWidth ?? width,
    height: v.pixelHeight ?? height,
    frameRate: positive(v.frameRate),
    rotation: 0,
    codec: track.codecName ?? track.codecId ?? null,
  };
}

function codecsOf(meta: IAudioMetadata | null, info: ContainerInfo | null): string[] {
  const out = new Set<string>();
  if (info?.video?.codec) out.add(info.video.codec);
  for (const t of meta?.format.trackInfo ?? []) {
    const name = t.codecName ?? t.codecId;
    if (name) out.add(name.replace(/^<(.*)>$/, '$1'));
  }
  if (meta?.format.codec) out.add(meta.format.codec);
  if (info?.audio?.codec) out.add(info.audio.codec);
  return [...out];
}

export async function parseMedia<K extends MediaKind>(
  kind: K,
  c: EntryContent,
): Promise<MediaValue<K>> {
  const sniffed = sniff(c);
  if (!sniffed) throw new Error('Not an audio or video file');
  const { container } = sniffed;
  const info = containerInfo(container, c.bytes);

  let meta: IAudioMetadata | null = null;
  let warning: string | null = null;
  if (container !== 'avi') {
    try {
      meta = await parseBuffer(c.bytes, { mimeType: MIMES[container][kind], size: c.size });
    } catch (err) {
      warning = err instanceof Error ? err.message : String(err);
    }
  }

  const video = info?.video ?? videoFromMetadata(meta);
  // Unsure (no parser could tell) means video, as the header suggested
  const hasVideo =
    sniffed.kind === 'video' && (video !== null || (meta?.format.hasVideo ?? info === null));
  const f = meta?.format;
  const audioTrack = f?.trackInfo.find(t => t.audio)?.audio;
  return {
    kind,
    container,
    format: FORMAT_NAMES[container],
    mime: MIMES[container][hasVideo ? 'video' : 'audio'],
    hasVideo,
    codecs: codecsOf(meta, info),
    duration: positive(f?.duration) ?? positive(info?.duration),
    bitrate: positive(f?.bitrate),
    sampleRate:
      positive(f?.sampleRate) ??
      positive(audioTrack?.samplingFrequency) ??
      info?.audio?.sampleRate ??
      null,
    channels:
      positive(f?.numberOfChannels) ??
      positive(audioTrack?.channels) ??
      info?.audio?.channels ??
      null,
    bitDepth:
      positive(f?.bitsPerSample) ?? positive(audioTrack?.bitDepth) ?? info?.audio?.bitDepth ?? null,
    lossless: f?.lossless ?? null,
    tags: tagsOf(meta),
    cover: coverOf(meta),
    video: hasVideo ? video : null,
    warning,
    bytes: c.bytes,
  };
}

const displaySize = (v: VideoTrackInfo) =>
  v.rotation % 180 === 90 ? `${v.height}×${v.width}` : `${v.width}×${v.height}`;

export function mediaLabel(v: MediaValue): string {
  const parts = [v.format];
  if (v.kind === 'video' && !v.hasVideo) parts.push('audio only');
  if (v.video && v.video.width > 0) parts.push(displaySize(v.video));
  if (v.duration !== null) parts.push(formatDuration(v.duration));
  if (!v.video && v.bitrate !== null) parts.push(formatBitrate(v.bitrate));
  return parts.join(' · ');
}

const CHANNEL_NAMES: Record<number, string> = { 1: 'mono', 2: 'stereo' };

const TAG_LABELS: [keyof MediaTags, string][] = [
  ['title', 'Title'],
  ['artist', 'Artist'],
  ['album', 'Album'],
  ['year', 'Year'],
  ['track', 'Track'],
];

export function mediaStats(v: MediaValue): StatRow[] {
  const rows: StatRow[] = [
    { label: 'Container', value: v.format },
    { label: 'MIME', value: v.mime },
  ];
  const add = (label: string, value: string | null) => {
    if (value !== null) rows.push({ label, value });
  };
  if (v.kind === 'video' && !v.hasVideo) add('Video', 'none (audio only)');
  add('Codecs', v.codecs.length > 0 ? v.codecs.join(', ') : null);
  add('Duration', v.duration !== null ? formatDuration(v.duration) : 'unknown');
  add('Bitrate', v.bitrate !== null ? formatBitrate(v.bitrate) : null);
  if (v.video) {
    add('Dimensions', v.video.width > 0 ? `${v.video.width} × ${v.video.height}` : 'unknown');
    add('Frame rate', v.video.frameRate !== null ? `${+v.video.frameRate.toFixed(3)} fps` : null);
    add('Rotation', v.video.rotation !== 0 ? `${v.video.rotation}°` : null);
  }
  add('Sample rate', v.sampleRate !== null ? `${v.sampleRate.toLocaleString('en-GB')} Hz` : null);
  add(
    'Channels',
    v.channels !== null
      ? `${v.channels}${CHANNEL_NAMES[v.channels] ? ` (${CHANNEL_NAMES[v.channels]})` : ''}`
      : null,
  );
  add('Bit depth', v.bitDepth !== null ? `${v.bitDepth}-bit` : null);
  add('Lossless', v.lossless === null ? null : v.lossless ? 'yes' : 'no');
  const tags = TAG_LABELS.flatMap(([key, label]) => {
    const value = v.tags[key];
    return value ? [{ label, value }] : [];
  });
  if (tags.length > 0) rows.push({ label: 'Tags', value: String(tags.length), children: tags });
  add('Cover art', v.cover ? `${v.cover.mime} · ${formatBytes(v.cover.bytes.byteLength)}` : null);
  add('Metadata', v.warning);
  rows.push({ label: 'Bytes', value: formatBytes(v.bytes.byteLength) });
  return rows;
}

/** Tags as "Label: value" lines, the one text form of a media file worth copying. */
export function tagsText(tags: MediaTags): string | undefined {
  const lines = TAG_LABELS.flatMap(([key, label]) => {
    const value = tags[key];
    return value ? [`${label}: ${value}`] : [];
  });
  return lines.length > 0 ? lines.join('\n') : undefined;
}

const COVER_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
};

export function mediaInterpreter<K extends MediaKind>(kind: K): Interpreter<MediaValue<K>> {
  return {
    kind,
    isValue: (v): v is MediaValue<K> => hasKind(v, kind),
    detect: c => (sniff(c)?.kind === kind ? 0.95 : 0),
    parse: c => parseMedia(kind, c),
    label: mediaLabel,
    summarise: v => ({ stats: mediaStats(v), extent: v.bytes.byteLength }),
    slice(v, req) {
      if (req.type === 'media') return { bytes: v.bytes, mime: v.mime };
      if (req.type === 'image' && v.cover) return v.cover;
      if (req.type === 'bytes') return v.bytes.slice(req.from, req.to);
      return unsupportedSlice(kind, req);
    },
    export: v => {
      const text = tagsText(v.tags);
      return text === undefined ? {} : { text };
    },
    derivations: v => (v.cover ? [{ id: 'cover', label: 'Cover art' }] : []),
    derive(v) {
      const cover = v.cover;
      if (!cover) throw new Error('No cover art');
      return {
        mime: cover.mime,
        name: `cover.${COVER_EXT[cover.mime] ?? 'img'}`,
        bytes: cover.bytes,
      };
    },
  };
}

export const audioInterpreter = mediaInterpreter('audio');
export const videoInterpreter = mediaInterpreter('video');
