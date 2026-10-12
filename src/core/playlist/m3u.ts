/**
 * M3U and HLS (RFC 8216 plus its LL-HLS draft) playlist parser. Pure and linear: one pass over the
 * lines, no recursion. Nothing is ever fetched; key and media URIs are only recorded.
 */

/** Attribute name → value (quotes removed), as written in an HLS attribute list. */
export type Attributes = Record<string, string>;

export interface Resolution {
  width: number;
  height: number;
}

/** A `#EXT-X-STREAM-INF` (or, with `iframe`, `#EXT-X-I-FRAME-STREAM-INF`) entry. */
export interface Variant {
  uri: string;
  bandwidth: number | null;
  averageBandwidth: number | null;
  resolution: Resolution | null;
  codecs: string | null;
  frameRate: number | null;
  audio: string | null;
  video: string | null;
  subtitles: string | null;
  closedCaptions: string | null;
  hdcpLevel: string | null;
  attributes: Attributes;
  /** 1-based source line of the tag. */
  line: number;
}

/** A `#EXT-X-MEDIA` alternative rendition. */
export interface Rendition {
  type: string;
  groupId: string;
  name: string;
  language: string | null;
  default: boolean;
  autoselect: boolean;
  forced: boolean;
  channels: string | null;
  uri: string | null;
  attributes: Attributes;
  line: number;
}

/** `#EXT-X-KEY` / `#EXT-X-SESSION-KEY`: the URI is shown, never fetched. */
export interface HlsKey {
  method: string;
  uri: string | null;
  iv: string | null;
  keyFormat: string | null;
}

export interface ByteRange {
  length: number;
  /** Absent in the tag and not derivable from the previous segment: null. */
  offset: number | null;
}

/** `#EXT-X-MAP`: a media initialisation section. */
export interface MediaMap {
  uri: string;
  byteRange: ByteRange | null;
}

export interface Segment {
  /** Media sequence number. */
  sequence: number;
  uri: string;
  duration: number;
  /** Seconds from the start of the playlist. */
  start: number;
  title: string;
  byteRange: ByteRange | null;
  /** `#EXT-X-DISCONTINUITY` before this segment. */
  discontinuity: boolean;
  programDateTime: string | null;
  /** Index into `MediaPlaylist.keys` of the key in force, or null when unencrypted. */
  key: number | null;
  /** Index into `MediaPlaylist.maps` of the initialisation section in force. */
  map: number | null;
  gap: boolean;
  /** LL-HLS `#EXT-X-PART`s listed for this segment. */
  parts: number;
  line: number;
}

export interface Track {
  uri: string;
  /** Seconds; null when unknown (no `#EXTINF`, or -1). */
  duration: number | null;
  /** The `#EXTINF` display text after the comma. */
  display: string;
  artist: string | null;
  title: string;
  group: string | null;
  album: string | null;
  /** IPTV-style `key="value"` attributes in `#EXTINF` (tvg-id, tvg-logo, group-title…). */
  attributes: Attributes;
  line: number;
}

/** A tag this parser doesn't know, kept as written. */
export interface UnknownTag {
  name: string;
  text: string;
  line: number;
}

interface Common {
  /** First non-blank line was `#EXTM3U`. */
  header: boolean;
  version: number | null;
  independentSegments: boolean;
  unknownTags: UnknownTag[];
  /** `#EXT-X-DEFINE` variables (not substituted). */
  defines: number;
}

export interface MasterPlaylist extends Common {
  type: 'master';
  variants: Variant[];
  iframeStreams: Variant[];
  renditions: Rendition[];
  sessionKeys: HlsKey[];
  sessionData: Attributes[];
}

export interface MediaPlaylist extends Common {
  type: 'media';
  targetDuration: number | null;
  mediaSequence: number;
  discontinuitySequence: number;
  /** `#EXT-X-PLAYLIST-TYPE`: 'VOD', 'EVENT', or null. */
  playlistType: string | null;
  endList: boolean;
  iframesOnly: boolean;
  segments: Segment[];
  keys: HlsKey[];
  maps: MediaMap[];
  /** Every `#EXT-X-PART`, including those of a trailing segment still being written. */
  partCount: number;
  partTarget: number | null;
  /** `#EXT-X-PRELOAD-HINT`s. */
  preloadHints: number;
  dateRanges: number;
  discontinuities: number;
  totalDuration: number;
}

export interface PlainPlaylist extends Common {
  type: 'plain';
  title: string | null;
  tracks: Track[];
}

export type Playlist = MasterPlaylist | MediaPlaylist | PlainPlaylist;

/** Lines without endings (CRLF, LF or CR) and without a leading BOM. */
export function playlistLines(text: string): string[] {
  return text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
}

/** True when the first non-blank line is the `#EXTM3U` header. */
export function hasM3uHeader(text: string): boolean {
  const first = /^\s*(\S[^\r\n]*)/.exec(text.replace(/^\uFEFF/, ''));
  return first?.[1] !== undefined && /^#EXTM3U(\s|$)/.test(first[1].trimEnd());
}

/**
 * Parses an HLS attribute list: `NAME=value` pairs separated by commas, where a value is a quoted
 * string (which may hold commas), a number, a resolution or an enumerated word. Tolerant: stray
 * whitespace is skipped and an unterminated quote runs to the end.
 */
export function parseAttributes(list: string): Attributes {
  const attrs: Attributes = {};
  let i = 0;
  const n = list.length;
  while (i < n) {
    while (i < n && (list[i] === ',' || list[i] === ' ' || list[i] === '\t')) i++;
    const eq = list.indexOf('=', i);
    if (eq < 0) break;
    const name = list.slice(i, eq).trim();
    i = eq + 1;
    while (i < n && (list[i] === ' ' || list[i] === '\t')) i++;
    let value: string;
    if (list[i] === '"') {
      const close = list.indexOf('"', i + 1);
      const end = close < 0 ? n : close;
      value = list.slice(i + 1, end);
      i = close < 0 ? n : close + 1;
      // Skip anything between the closing quote and the next comma
      const comma = list.indexOf(',', i);
      i = comma < 0 ? n : comma + 1;
    } else {
      const comma = list.indexOf(',', i);
      const end = comma < 0 ? n : comma;
      value = list.slice(i, end).trim();
      i = comma < 0 ? n : comma + 1;
    }
    if (name) attrs[name.toUpperCase()] = value;
  }
  return attrs;
}

/**
 * IPTV-style attributes before the display text in a plain `#EXTINF`, e.g.
 * `-1 tvg-id="a" group-title="News, UK",BBC One`: returns the attributes and where the text
 * starts (after the first comma outside quotes).
 */
function parseExtinf(rest: string): { duration: number | null; attrs: Attributes; text: string } {
  let i = 0;
  const n = rest.length;
  while (i < n && rest[i] !== ',' && rest[i] !== ' ' && rest[i] !== '\t') i++;
  const parsed = Number(rest.slice(0, i));
  const duration = Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  const attrs: Attributes = {};
  let text = '';
  while (i < n) {
    const c = rest[i];
    if (c === ',') {
      text = rest.slice(i + 1);
      break;
    }
    if (c === ' ' || c === '\t') {
      i++;
      continue;
    }
    const m = /^([\w.-]+)=("([^"]*)"?|[^\s,]*)/.exec(rest.slice(i));
    if (!m?.[1]) {
      // Not an attribute: whatever follows the next comma is the text
      const comma = rest.indexOf(',', i);
      text = comma < 0 ? '' : rest.slice(comma + 1);
      break;
    }
    attrs[m[1]] = m[3] ?? m[2] ?? '';
    i += m[0].length;
  }
  return { duration, attrs, text: text.trim() };
}

const numberOrNull = (s: string | undefined): number | null => {
  if (s === undefined || s.trim() === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

function parseResolution(s: string | undefined): Resolution | null {
  const m = /^(\d+)\s*x\s*(\d+)$/i.exec(s?.trim() ?? '');
  return m?.[1] && m[2] ? { width: Number(m[1]), height: Number(m[2]) } : null;
}

/** `length[@offset]`; without an offset, the range continues the previous one for the same URI. */
function parseByteRange(
  s: string,
  previous: { uri: string; end: number } | null,
  uri: string,
): ByteRange | null {
  const m = /^\s*(\d+)(?:@(\d+))?\s*$/.exec(s);
  if (!m?.[1]) return null;
  const length = Number(m[1]);
  const offset =
    m[2] !== undefined ? Number(m[2]) : previous && previous.uri === uri ? previous.end : null;
  return { length, offset };
}

function variantOf(attrs: Attributes, uri: string, line: number): Variant {
  return {
    uri,
    bandwidth: numberOrNull(attrs.BANDWIDTH),
    averageBandwidth: numberOrNull(attrs['AVERAGE-BANDWIDTH']),
    resolution: parseResolution(attrs.RESOLUTION),
    codecs: attrs.CODECS ?? null,
    frameRate: numberOrNull(attrs['FRAME-RATE']),
    audio: attrs.AUDIO ?? null,
    video: attrs.VIDEO ?? null,
    subtitles: attrs.SUBTITLES ?? null,
    closedCaptions: attrs['CLOSED-CAPTIONS'] ?? null,
    hdcpLevel: attrs['HDCP-LEVEL'] ?? null,
    attributes: attrs,
    line,
  };
}

const keyOf = (attrs: Attributes): HlsKey => ({
  method: attrs.METHOD ?? 'NONE',
  uri: attrs.URI ?? null,
  iv: attrs.IV ?? null,
  keyFormat: attrs.KEYFORMAT ?? null,
});

const sameKey = (a: HlsKey, b: HlsKey) =>
  a.method === b.method && a.uri === b.uri && a.iv === b.iv && a.keyFormat === b.keyFormat;

/** Tags that make a playlist a master playlist. */
const MASTER_TAGS = new Set(['EXT-X-STREAM-INF', 'EXT-X-I-FRAME-STREAM-INF', 'EXT-X-MEDIA']);
/** Tags only media playlists carry. */
const MEDIA_TAGS = new Set([
  'EXT-X-TARGETDURATION',
  'EXT-X-MEDIA-SEQUENCE',
  'EXT-X-ENDLIST',
  'EXT-X-PLAYLIST-TYPE',
  'EXT-X-KEY',
  'EXT-X-MAP',
  'EXT-X-BYTERANGE',
  'EXT-X-DISCONTINUITY',
  'EXT-X-PROGRAM-DATE-TIME',
  'EXT-X-PART',
  'EXT-X-PART-INF',
]);

/** Known tags whose content this parser records only as counts or ignores. */
const KNOWN_TAGS = new Set([
  'EXTM3U',
  'EXTINF',
  'EXTGRP',
  'EXTALB',
  'EXTART',
  'EXTGENRE',
  'EXTIMG',
  'EXTBYT',
  'EXTVLCOPT',
  'PLAYLIST',
  'EXT-X-VERSION',
  'EXT-X-INDEPENDENT-SEGMENTS',
  'EXT-X-START',
  'EXT-X-DEFINE',
  'EXT-X-SESSION-KEY',
  'EXT-X-SESSION-DATA',
  'EXT-X-CONTENT-STEERING',
  'EXT-X-DISCONTINUITY-SEQUENCE',
  'EXT-X-I-FRAMES-ONLY',
  'EXT-X-GAP',
  'EXT-X-BITRATE',
  'EXT-X-DATERANGE',
  'EXT-X-SKIP',
  'EXT-X-PRELOAD-HINT',
  'EXT-X-RENDITION-REPORT',
  'EXT-X-SERVER-CONTROL',
  'EXT-X-ALLOW-CACHE',
  ...MASTER_TAGS,
  ...MEDIA_TAGS,
]);

/** `#NAME[:value]` → name and value; null for comments and blank lines. */
function splitTag(line: string): { name: string; value: string } | null {
  const m = /^#(EXT[\w-]*|PLAYLIST)(?::(.*))?$/.exec(line);
  return m?.[1] ? { name: m[1], value: m[2] ?? '' } : null;
}

/** Whether `text` looks like playlist entries: tags, comments and URL/path lines only. */
export function looksLikeEntries(text: string): boolean {
  let entries = 0;
  for (const raw of playlistLines(text)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    if (!isUriLike(line)) return false;
    entries++;
  }
  return entries > 0;
}

/** A URL (any scheme), or a path with a separator or a file extension; no prose. */
export function isUriLike(line: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(line)) return true;
  if (/^[a-z][a-z0-9+.-]*:\S+$/i.test(line) && !/^[a-z]:/i.test(line)) return true;
  // Windows drive, UNC, absolute or relative path, or a bare file name with an extension
  if (/[\\/]/.test(line) || /^[a-z]:/i.test(line)) return /\.\w{1,5}$|[\\/]$/.test(line);
  return /^[^\s]+\.\w{1,5}$/.test(line);
}

/** Classifies by its tags: master when it lists variants or renditions, media when it has HLS tags. */
function classify(lines: string[]): Playlist['type'] {
  let media = false;
  for (const line of lines) {
    const tag = splitTag(line.trim());
    if (!tag) continue;
    if (MASTER_TAGS.has(tag.name)) return 'master';
    if (MEDIA_TAGS.has(tag.name)) media = true;
  }
  return media ? 'media' : 'plain';
}

export function parsePlaylist(text: string): Playlist {
  const lines = playlistLines(text);
  const header = hasM3uHeader(text);
  const type = classify(lines);
  const common: Common = {
    header,
    version: null,
    independentSegments: false,
    unknownTags: [],
    defines: 0,
  };
  if (type === 'master') return parseMaster(lines, common);
  if (type === 'media') return parseMedia(lines, common);
  return parsePlain(lines, common);
}

/** Handles tags shared by every type; true when the tag was consumed. */
function commonTag(common: Common, name: string, value: string, raw: string, line: number) {
  switch (name) {
    case 'EXTM3U':
      return true;
    case 'EXT-X-VERSION':
      common.version = numberOrNull(value);
      return true;
    case 'EXT-X-INDEPENDENT-SEGMENTS':
      common.independentSegments = true;
      return true;
    case 'EXT-X-DEFINE':
      common.defines++;
      return true;
  }
  if (!KNOWN_TAGS.has(name)) {
    common.unknownTags.push({ name, text: raw, line });
    return true;
  }
  return false;
}

function parseMaster(lines: string[], common: Common): MasterPlaylist {
  const out: MasterPlaylist = {
    ...common,
    type: 'master',
    variants: [],
    iframeStreams: [],
    renditions: [],
    sessionKeys: [],
    sessionData: [],
  };
  let pending: { attrs: Attributes; line: number } | null = null;
  for (const [i, raw] of lines.entries()) {
    const line = raw.trim();
    if (line === '') continue;
    const tag = splitTag(line);
    if (!tag) {
      if (line.startsWith('#')) continue;
      if (pending) out.variants.push(variantOf(pending.attrs, line, pending.line));
      pending = null;
      continue;
    }
    const { name, value } = tag;
    if (commonTag(out, name, value, line, i + 1)) continue;
    switch (name) {
      case 'EXT-X-STREAM-INF':
        pending = { attrs: parseAttributes(value), line: i + 1 };
        break;
      case 'EXT-X-I-FRAME-STREAM-INF': {
        const attrs = parseAttributes(value);
        out.iframeStreams.push(variantOf(attrs, attrs.URI ?? '', i + 1));
        break;
      }
      case 'EXT-X-MEDIA': {
        const a = parseAttributes(value);
        out.renditions.push({
          type: a.TYPE ?? '',
          groupId: a['GROUP-ID'] ?? '',
          name: a.NAME ?? '',
          language: a.LANGUAGE ?? null,
          default: a.DEFAULT === 'YES',
          autoselect: a.AUTOSELECT === 'YES',
          forced: a.FORCED === 'YES',
          channels: a.CHANNELS ?? null,
          uri: a.URI ?? null,
          attributes: a,
          line: i + 1,
        });
        break;
      }
      case 'EXT-X-SESSION-KEY':
        out.sessionKeys.push(keyOf(parseAttributes(value)));
        break;
      case 'EXT-X-SESSION-DATA':
        out.sessionData.push(parseAttributes(value));
        break;
    }
  }
  return out;
}

function parseMedia(lines: string[], common: Common): MediaPlaylist {
  const out: MediaPlaylist = {
    ...common,
    type: 'media',
    targetDuration: null,
    mediaSequence: 0,
    discontinuitySequence: 0,
    playlistType: null,
    endList: false,
    iframesOnly: false,
    segments: [],
    keys: [],
    maps: [],
    partCount: 0,
    partTarget: null,
    preloadHints: 0,
    dateRanges: 0,
    discontinuities: 0,
    totalDuration: 0,
  };
  // State that applies to the next segment only
  let inf: { duration: number; title: string } | null = null;
  let rangeSpec: string | null = null;
  let discontinuity = false;
  let dateTime: string | null = null;
  let gap = false;
  let parts = 0;
  // State that applies until changed
  let key: number | null = null;
  let map: number | null = null;
  let lastRange: { uri: string; end: number } | null = null;
  for (const [i, raw] of lines.entries()) {
    const line = raw.trim();
    if (line === '') continue;
    const tag = splitTag(line);
    if (!tag) {
      if (line.startsWith('#')) continue;
      const byteRange: ByteRange | null =
        rangeSpec === null ? null : parseByteRange(rangeSpec, lastRange, line);
      lastRange =
        byteRange && byteRange.offset !== null
          ? { uri: line, end: byteRange.offset + byteRange.length }
          : null;
      const duration = inf?.duration ?? 0;
      out.segments.push({
        sequence: out.mediaSequence + out.segments.length,
        uri: line,
        duration,
        start: out.totalDuration,
        title: inf?.title ?? '',
        byteRange,
        discontinuity,
        programDateTime: dateTime,
        key,
        map,
        gap,
        parts,
        line: i + 1,
      });
      out.totalDuration += duration;
      if (discontinuity) out.discontinuities++;
      inf = null;
      rangeSpec = null;
      discontinuity = false;
      dateTime = null;
      gap = false;
      parts = 0;
      continue;
    }
    const { name, value } = tag;
    if (commonTag(out, name, value, line, i + 1)) continue;
    switch (name) {
      case 'EXTINF': {
        const comma = value.indexOf(',');
        const d = Number(comma < 0 ? value : value.slice(0, comma));
        inf = {
          duration: Number.isFinite(d) && d > 0 ? d : 0,
          title: comma < 0 ? '' : value.slice(comma + 1).trim(),
        };
        break;
      }
      case 'EXT-X-TARGETDURATION':
        out.targetDuration = numberOrNull(value);
        break;
      case 'EXT-X-MEDIA-SEQUENCE':
        out.mediaSequence = numberOrNull(value) ?? 0;
        break;
      case 'EXT-X-DISCONTINUITY-SEQUENCE':
        out.discontinuitySequence = numberOrNull(value) ?? 0;
        break;
      case 'EXT-X-PLAYLIST-TYPE':
        out.playlistType = value.trim().toUpperCase() || null;
        break;
      case 'EXT-X-ENDLIST':
        out.endList = true;
        break;
      case 'EXT-X-I-FRAMES-ONLY':
        out.iframesOnly = true;
        break;
      case 'EXT-X-BYTERANGE':
        rangeSpec = value;
        break;
      case 'EXT-X-DISCONTINUITY':
        discontinuity = true;
        break;
      case 'EXT-X-PROGRAM-DATE-TIME':
        dateTime = value.trim();
        break;
      case 'EXT-X-GAP':
        gap = true;
        break;
      case 'EXT-X-KEY': {
        const k = keyOf(parseAttributes(value));
        if (k.method.toUpperCase() === 'NONE') {
          key = null;
          break;
        }
        const found = out.keys.findIndex(o => sameKey(o, k));
        key = found >= 0 ? found : out.keys.push(k) - 1;
        break;
      }
      case 'EXT-X-MAP': {
        const a = parseAttributes(value);
        const uri = a.URI ?? '';
        const range = a.BYTERANGE === undefined ? null : parseByteRange(a.BYTERANGE, null, uri);
        out.maps.push({ uri, byteRange: range });
        map = out.maps.length - 1;
        break;
      }
      case 'EXT-X-PART':
        parts++;
        out.partCount++;
        break;
      case 'EXT-X-PART-INF':
        out.partTarget = numberOrNull(parseAttributes(value)['PART-TARGET']);
        break;
      case 'EXT-X-PRELOAD-HINT':
        out.preloadHints++;
        break;
      case 'EXT-X-DATERANGE':
        out.dateRanges++;
        break;
    }
  }
  return out;
}

/** "Artist - Title" → its parts; a display text without the separator is all title. */
export function splitArtist(display: string): { artist: string | null; title: string } {
  const at = display.indexOf(' - ');
  if (at <= 0) return { artist: null, title: display };
  return { artist: display.slice(0, at).trim(), title: display.slice(at + 3).trim() };
}

function parsePlain(lines: string[], common: Common): PlainPlaylist {
  const out: PlainPlaylist = { ...common, type: 'plain', title: null, tracks: [] };
  let inf: { duration: number | null; attrs: Attributes; text: string } | null = null;
  let group: string | null = null;
  let album: string | null = null;
  let artist: string | null = null;
  for (const [i, raw] of lines.entries()) {
    const line = raw.trim();
    if (line === '') continue;
    const tag = splitTag(line);
    if (!tag) {
      if (line.startsWith('#')) continue;
      const display = inf?.text ?? '';
      const split = splitArtist(display);
      const attrs = inf?.attrs ?? {};
      out.tracks.push({
        uri: line,
        duration: inf?.duration ?? null,
        display,
        artist: split.artist ?? attrs['tvg-name'] ?? artist,
        title: split.title,
        group: attrs['group-title'] ?? group,
        album,
        attributes: attrs,
        line: i + 1,
      });
      inf = null;
      continue;
    }
    const { name, value } = tag;
    if (commonTag(out, name, value, line, i + 1)) continue;
    switch (name) {
      case 'EXTINF':
        inf = parseExtinf(value);
        break;
      case 'EXTGRP':
        group = value.trim() || null;
        break;
      case 'EXTALB':
        album = value.trim() || null;
        break;
      case 'EXTART':
        artist = value.trim() || null;
        break;
      case 'PLAYLIST':
        out.title = value.trim() || null;
        break;
    }
  }
  return out;
}

/** "1:32:10" or "34:12" (seconds rounded). */
export function formatClock(seconds: number): string {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** "1080p" for a resolution, by its height. */
export const resolutionLabel = (r: Resolution) => `${r.height}p`;

/** Variants by bandwidth, highest first; ones without a bandwidth last, in source order. */
export function variantsByBandwidth(variants: Variant[]): Variant[] {
  return variants
    .map((v, i) => ({ v, i }))
    .sort((a, b) => (b.v.bandwidth ?? -1) - (a.v.bandwidth ?? -1) || a.i - b.i)
    .map(x => x.v);
}

/** "5.07 Mbps", "800 kbps". */
export function formatBitrate(bps: number): string {
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(bps >= 1e7 ? 1 : 2)} Mbps`;
  if (bps >= 1e3) return `${Math.round(bps / 1e3)} kbps`;
  return `${bps} bps`;
}

/**
 * Every media URI in source order: variants, I-frame streams, renditions, init sections,
 * segments and tracks (not key URIs). Duplicates are dropped.
 */
export function playlistUris(p: Playlist): string[] {
  const all: string[] = [];
  if (p.type === 'master') {
    for (const v of p.variants) all.push(v.uri);
    for (const v of p.iframeStreams) all.push(v.uri);
    for (const r of p.renditions) if (r.uri) all.push(r.uri);
  } else if (p.type === 'media') {
    for (const m of p.maps) all.push(m.uri);
    for (const s of p.segments) all.push(s.uri);
  } else {
    for (const t of p.tracks) all.push(t.uri);
  }
  return [...new Set(all.filter(u => u !== ''))];
}

/** A scheme (`https:`, `data:`, `skd:`…) or a Windows drive (`C:\`): left as it is. */
const ABSOLUTE = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Rewrites the playlist with its URI lines and `URI="…"` attributes made absolute against `base`
 * (an absolute http(s) URL). Everything else, including unknown tags, comments and line endings,
 * is kept as it is. Returns the text and how many URIs changed.
 */
export function resolvePlaylistUris(text: string, base: string): { text: string; changed: number } {
  const baseUrl = new URL(base);
  let changed = 0;
  const resolve = (uri: string): string => {
    if (uri === '' || ABSOLUTE.test(uri)) return uri;
    try {
      const abs = new URL(uri.replace(/\\/g, '/'), baseUrl).href;
      if (abs !== uri) changed++;
      return abs;
    } catch {
      return uri;
    }
  };
  // Split keeping the line endings, so CRLF files stay CRLF
  const parts = text.split(/(\r\n|\r|\n)/);
  for (let i = 0; i < parts.length; i += 2) {
    const raw = parts[i] ?? '';
    const bom = i === 0 && raw.startsWith('\uFEFF') ? '\uFEFF' : '';
    const line = raw.slice(bom.length);
    const trimmed = line.trim();
    if (trimmed === '') continue;
    if (trimmed.startsWith('#')) {
      if (!splitTag(trimmed)) continue;
      parts[i] =
        bom +
        line.replace(
          /([:,]\s*URI\s*=\s*)"([^"]*)"/g,
          (_m, pre: string, uri: string) => `${pre}"${resolve(uri)}"`,
        );
      continue;
    }
    const lead = /^\s*/.exec(line)?.[0] ?? '';
    const trail = /\s*$/.exec(line)?.[0] ?? '';
    parts[i] = bom + lead + resolve(trimmed) + trail;
  }
  return { text: parts.join(''), changed };
}
