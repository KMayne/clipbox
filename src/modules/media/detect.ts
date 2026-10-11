import { createMemo, type EntryContent } from '../../core/content';
import type { Detector } from '../types';

/** Container formats recognised from their signatures. */
export type MediaContainer =
  'mp3' | 'wav' | 'ogg' | 'flac' | 'm4a' | 'mp4' | 'mov' | 'webm' | 'mkv' | 'avi';

export interface MediaSniff {
  container: MediaContainer;
  /** Best guess from the header alone; the parser can correct `video` to audio-only. */
  kind: 'audio' | 'video';
}

/** Byte at `i`, or 0 past the end. */
const u8 = (b: Uint8Array, i: number) => b[i] ?? 0;

const ascii = (b: Uint8Array, from: number, to: number) =>
  b.length >= to ? String.fromCharCode(...b.subarray(from, to)) : '';

const AUDIO_BRANDS = new Set(['M4A ', 'M4B ', 'M4P ', 'F4A ', 'F4B ']);
/** ISO-BMFF brands for still images (HEIF/AVIF) and camera raw; not media. */
const IMAGE_BRANDS = new Set([
  'heic',
  'heix',
  'hevc',
  'hevx',
  'heim',
  'heis',
  'mif1',
  'msf1',
  'avif',
  'avis',
  'crx ',
]);
const VIDEO_BRANDS = new Set([
  'isom',
  'iso2',
  'iso3',
  'iso4',
  'iso5',
  'iso6',
  'iso8',
  'mp41',
  'mp42',
  'mp71',
  'avc1',
  'qt  ',
  'M4V ',
  'M4VH',
  'M4VP',
  'mmp4',
  'dash',
  'msnv',
  'MSNV',
  'f4v ',
  'f4p ',
  '3gp4',
  '3gp5',
  '3gp6',
  '3gp7',
  '3g2a',
  '3g2b',
  '3g2c',
  'XAVC',
  'NDAS',
  'cmfc',
]);

function sniffFtyp(b: Uint8Array): MediaSniff | null {
  const size = new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(0);
  const major = ascii(b, 8, 12);
  if (AUDIO_BRANDS.has(major)) return { container: 'm4a', kind: 'audio' };
  const end = Math.min(size, b.length, 64);
  const compatible: string[] = [];
  for (let i = 16; i + 4 <= end; i += 4) compatible.push(ascii(b, i, i + 4));
  const brands = [major, ...compatible];
  if (IMAGE_BRANDS.has(major)) return null;
  if (!brands.some(x => VIDEO_BRANDS.has(x) || AUDIO_BRANDS.has(x))) return null;
  return { container: major === 'qt  ' ? 'mov' : 'mp4', kind: 'video' };
}

// MPEG audio header tables (kbps); index 0 is "free", 15 is invalid
const BITRATES: Record<string, number[]> = {
  v1l1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  v1l2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  v1l3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  v2l1: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  v2l2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const SAMPLE_RATES = [44100, 48000, 32000];

/** Length in bytes of the MPEG audio frame starting at `i`, or null if there's no valid header. */
export function mpegFrameLength(b: Uint8Array, i: number): number | null {
  if (i + 4 > b.length || u8(b, i) !== 0xff || (u8(b, i + 1) & 0xe0) !== 0xe0) return null;
  const version = (u8(b, i + 1) >> 3) & 3; // 0: 2.5, 2: 2, 3: 1
  const layer = (u8(b, i + 1) >> 1) & 3; // 1: III, 2: II, 3: I
  const bitrateIndex = u8(b, i + 2) >> 4;
  const rateIndex = (u8(b, i + 2) >> 2) & 3;
  if (
    version === 1 ||
    layer === 0 ||
    bitrateIndex === 0 ||
    bitrateIndex === 15 ||
    rateIndex === 3
  ) {
    return null;
  }
  const v1 = version === 3;
  const layerNo = 4 - layer;
  const table = v1 ? `v1l${layerNo}` : layerNo === 1 ? 'v2l1' : 'v2l2';
  const kbps = BITRATES[table]?.[bitrateIndex] ?? 0;
  const rate = (SAMPLE_RATES[rateIndex] ?? 0) / (v1 ? 1 : version === 2 ? 2 : 4);
  const padding = (u8(b, i + 2) >> 1) & 1;
  if (layerNo === 1) return (Math.floor((12 * kbps * 1000) / rate) + padding) * 4;
  const coefficient = layerNo === 3 && !v1 ? 72 : 144;
  return Math.floor((coefficient * kbps * 1000) / rate) + padding;
}

/** A frame sync at 0 whose header is valid, followed by another frame if the data is long enough. */
function isMpegAudio(b: Uint8Array): boolean {
  const len = mpegFrameLength(b, 0);
  if (len === null) return false;
  if (b.length < len + 4) return true;
  return mpegFrameLength(b, len) !== null;
}

/** ID3v2 header: "ID3", major version 2-4, revision < 0xFF, synchsafe size. */
const isId3 = (b: Uint8Array) =>
  ascii(b, 0, 3) === 'ID3' &&
  b.length >= 10 &&
  u8(b, 3) >= 2 &&
  u8(b, 3) <= 4 &&
  u8(b, 4) !== 0xff &&
  [6, 7, 8, 9].every(i => u8(b, i) < 0x80);

/** Reads an EBML variable-length integer. `keepMarker` keeps the length bit (element IDs). */
function vint(b: Uint8Array, i: number, keepMarker: boolean) {
  const first = u8(b, i);
  if (first === 0) return null;
  let length = 1;
  while (!(first & (0x80 >> (length - 1)))) length++;
  if (i + length > b.length) return null;
  let value = keepMarker ? first : first & (0xff >> length);
  let allOnes = value === 0xff >> length;
  for (let k = 1; k < length; k++) {
    value = value * 256 + u8(b, i + k);
    if (u8(b, i + k) !== 0xff) allOnes = false;
  }
  return { value, length, unknown: !keepMarker && allOnes };
}

const EBML = 0x1a45dfa3;
const DOC_TYPE = 0x4282;
const SEGMENT = 0x18538067;
const TRACKS = 0x1654ae6b;
const TRACK_ENTRY = 0xae;
const TRACK_TYPE = 0x83;
const CLUSTER = 0x1f43b675;

interface EbmlInfo {
  docType: string | null;
  /** Track types (1 video, 2 audio, …), or null if the Tracks element wasn't reached. */
  trackTypes: number[] | null;
}

/** Walks just enough of an EBML header and Segment to find the DocType and track types. */
export function readEbml(b: Uint8Array): EbmlInfo {
  const info: EbmlInfo = { docType: null, trackTypes: null };
  const walk = (from: number, to: number, depth: number): boolean => {
    let i = from;
    while (i < to) {
      const id = vint(b, i, true);
      if (!id) return false;
      const size = vint(b, i + id.length, false);
      if (!size) return false;
      const start = i + id.length + size.length;
      const end = size.unknown ? to : Math.min(start + size.value, b.length);
      switch (id.value) {
        case EBML:
        case SEGMENT:
        case TRACK_ENTRY:
          if (depth < 4 && walk(start, end, depth + 1)) return true;
          break;
        case TRACKS:
          info.trackTypes = [];
          walk(start, end, depth + 1);
          return true;
        case DOC_TYPE:
          info.docType = ascii(b, start, end).replace(/\0+$/, '');
          break;
        case TRACK_TYPE:
          info.trackTypes?.push(u8(b, start));
          break;
        case CLUSTER:
          return true; // Tracks always precede media data
      }
      if (size.unknown) return false;
      i = start + size.value;
    }
    return false;
  };
  walk(0, b.length, 0);
  return info;
}

function sniffEbml(b: Uint8Array): MediaSniff | null {
  const { docType, trackTypes } = readEbml(b);
  if (docType !== 'webm' && docType !== 'matroska') return null;
  const container = docType === 'webm' ? 'webm' : 'mkv';
  const audioOnly = trackTypes !== null && trackTypes.length > 0 && !trackTypes.includes(1);
  return { container, kind: audioOnly ? 'audio' : 'video' };
}

/** Identifies an audio or video container from its leading bytes. */
export function sniffMedia(b: Uint8Array): MediaSniff | null {
  if (b.length < 12) return null;
  const riff = ascii(b, 0, 4) === 'RIFF' ? ascii(b, 8, 12) : null;
  if (riff === 'WAVE') return { container: 'wav', kind: 'audio' };
  if (riff === 'AVI ') return { container: 'avi', kind: 'video' };
  if (riff !== null) return null;
  if (ascii(b, 0, 4) === 'fLaC') return { container: 'flac', kind: 'audio' };
  if (ascii(b, 0, 4) === 'OggS' && b[4] === 0) {
    // First packet of the first page; Theora means Ogg video
    const segments = b[26] ?? 0;
    const packet = 27 + segments;
    const theora = b[packet] === 0x80 && ascii(b, packet + 1, packet + 7) === 'theora';
    return { container: 'ogg', kind: theora ? 'video' : 'audio' };
  }
  if (ascii(b, 4, 8) === 'ftyp') return sniffFtyp(b);
  if (['moov', 'mdat'].includes(ascii(b, 4, 8))) return { container: 'mov', kind: 'video' };
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return sniffEbml(b);
  if (isId3(b) || isMpegAudio(b)) return { container: 'mp3', kind: 'audio' };
  return null;
}

export const sniff = createMemo((c: EntryContent) => sniffMedia(c.bytes));

const detectorFor = (kind: 'audio' | 'video'): Detector => ({
  kind,
  module: 'media',
  detect: c => (sniff(c)?.kind === kind ? 0.95 : 0),
});

export const audioDetector = detectorFor('audio');
export const videoDetector = detectorFor('video');
