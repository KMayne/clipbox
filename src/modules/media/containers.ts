/*
 * Light container parsers for what music-metadata doesn't report: MP4/MOV frame rate and rotation
 * (tkhd matrix, stts), and AVI, which music-metadata doesn't parse at all. Header reads only.
 */

export interface VideoTrackInfo {
  width: number;
  height: number;
  frameRate: number | null;
  /** Clockwise display rotation in degrees (0, 90, 180, 270). */
  rotation: number;
  codec: string | null;
}

export interface AudioTrackInfo {
  codec: string | null;
  sampleRate: number | null;
  channels: number | null;
  bitDepth: number | null;
}

export interface ContainerInfo {
  duration: number | null;
  video: VideoTrackInfo | null;
  audio: AudioTrackInfo | null;
}

const fourcc = (b: Uint8Array, i: number) =>
  i + 4 <= b.length ? String.fromCharCode(...b.subarray(i, i + 4)) : '';

const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

interface Box {
  type: string;
  /** Payload start and end. */
  start: number;
  end: number;
}

/** ISO-BMFF boxes directly inside [from, to). */
function boxes(b: Uint8Array, from: number, to: number): Box[] {
  const dv = view(b);
  const out: Box[] = [];
  let i = from;
  while (i + 8 <= to) {
    let size = dv.getUint32(i);
    let header = 8;
    if (size === 1 && i + 16 <= to) {
      size = Number(dv.getBigUint64(i + 8));
      header = 16;
    } else if (size === 0) {
      size = to - i;
    }
    if (size < header) break;
    out.push({ type: fourcc(b, i + 4), start: i + header, end: Math.min(i + size, to) });
    i += size;
  }
  return out;
}

const child = (b: Uint8Array, parent: Box, type: string) =>
  boxes(b, parent.start, parent.end).find(x => x.type === type);

/** Reads 16.16 fixed point. */
const fixed = (dv: DataView, i: number) => dv.getInt32(i) / 65536;

/** Rotation from a tkhd transformation matrix [a b u; c d v; x y w]. */
function matrixRotation(dv: DataView, i: number): number {
  const a = fixed(dv, i);
  const b = fixed(dv, i + 4);
  const degrees = Math.round((Math.atan2(b, a) * 180) / Math.PI);
  return (((Math.round(degrees / 90) * 90) % 360) + 360) % 360;
}

function mp4Track(b: Uint8Array, trak: Box) {
  const dv = view(b);
  const tkhd = child(b, trak, 'tkhd');
  const mdia = child(b, trak, 'mdia');
  if (!tkhd || !mdia) return null;
  const hdlr = child(b, mdia, 'hdlr');
  const handler = hdlr ? fourcc(b, hdlr.start + 8) : '';
  const mdhd = child(b, mdia, 'mdhd');
  const stbl = (() => {
    const minf = child(b, mdia, 'minf');
    return minf ? child(b, minf, 'stbl') : undefined;
  })();

  let timescale = 0;
  let duration = 0;
  if (mdhd) {
    const v1 = b[mdhd.start] === 1;
    timescale = dv.getUint32(mdhd.start + (v1 ? 20 : 12));
    duration = v1 ? Number(dv.getBigUint64(mdhd.start + 24)) : dv.getUint32(mdhd.start + 16);
  }

  // Sample entry: size(4) format(4) reserved(6) dref(2) … width(2) height(2) at +32
  const stsd = stbl ? child(b, stbl, 'stsd') : undefined;
  const entry = stsd ? stsd.start + 8 : -1;
  const codec = entry >= 0 ? fourcc(b, entry + 4) || null : null;

  let frameRate: number | null = null;
  const stts = stbl ? child(b, stbl, 'stts') : undefined;
  if (stts && timescale > 0) {
    const count = dv.getUint32(stts.start + 4);
    let samples = 0;
    let ticks = 0;
    for (let k = 0; k < count && stts.start + 16 + k * 8 <= stts.end; k++) {
      const n = dv.getUint32(stts.start + 8 + k * 8);
      samples += n;
      ticks += n * dv.getUint32(stts.start + 12 + k * 8);
    }
    if (samples > 0 && ticks > 0) frameRate = (samples * timescale) / ticks;
  }

  const v1 = b[tkhd.start] === 1;
  const matrix = tkhd.start + (v1 ? 52 : 40);
  const tkhdWidth = matrix + 44 <= tkhd.end ? Math.round(fixed(dv, matrix + 36)) : 0;
  const tkhdHeight = matrix + 44 <= tkhd.end ? Math.round(fixed(dv, matrix + 40)) : 0;
  const entryWidth = entry >= 0 && entry + 36 <= b.length ? dv.getUint16(entry + 32) : 0;
  const entryHeight = entry >= 0 && entry + 36 <= b.length ? dv.getUint16(entry + 34) : 0;

  return {
    handler,
    codec,
    duration: timescale > 0 ? duration / timescale : null,
    frameRate,
    rotation: matrix + 36 <= tkhd.end ? matrixRotation(dv, matrix) : 0,
    // The sample entry holds the coded size; tkhd the display size (pre-rotation)
    width: entryWidth || tkhdWidth,
    height: entryHeight || tkhdHeight,
  };
}

/** Video track details from an MP4/MOV `moov` box. */
export function parseMp4(b: Uint8Array): ContainerInfo {
  const info: ContainerInfo = { duration: null, video: null, audio: null };
  const moov = boxes(b, 0, b.length).find(x => x.type === 'moov');
  if (!moov) return info;
  const mvhd = child(b, moov, 'mvhd');
  if (mvhd) {
    const dv = view(b);
    const v1 = b[mvhd.start] === 1;
    const timescale = dv.getUint32(mvhd.start + (v1 ? 20 : 12));
    const duration = v1 ? Number(dv.getBigUint64(mvhd.start + 24)) : dv.getUint32(mvhd.start + 16);
    if (timescale > 0 && duration > 0) info.duration = duration / timescale;
  }
  for (const trak of boxes(b, moov.start, moov.end).filter(x => x.type === 'trak')) {
    const t = mp4Track(b, trak);
    if (t?.handler === 'vide' && !info.video) {
      info.video = {
        width: t.width,
        height: t.height,
        frameRate: t.frameRate,
        rotation: t.rotation,
        codec: t.codec,
      };
    } else if (t?.handler === 'soun' && !info.audio) {
      info.audio = { codec: t.codec, sampleRate: null, channels: null, bitDepth: null };
    }
  }
  return info;
}

interface Chunk {
  id: string;
  /** LIST type, for LIST chunks. */
  list: string | null;
  start: number;
  end: number;
}

function riffChunks(b: Uint8Array, from: number, to: number): Chunk[] {
  const dv = view(b);
  const out: Chunk[] = [];
  let i = from;
  while (i + 8 <= to) {
    const id = fourcc(b, i);
    const size = dv.getUint32(i + 4, true);
    const isList = id === 'LIST' || id === 'RIFF';
    out.push({
      id,
      list: isList ? fourcc(b, i + 8) : null,
      start: i + 8 + (isList ? 4 : 0),
      end: Math.min(i + 8 + size, to),
    });
    i += 8 + size + (size & 1);
  }
  return out;
}

const AVI_AUDIO_FORMATS: Record<number, string> = {
  0x0001: 'PCM',
  0x0003: 'PCM float',
  0x0055: 'MP3',
  0x00ff: 'AAC',
  0x2000: 'AC-3',
  0x0161: 'WMA',
};

/** Video and audio stream details from an AVI's `hdrl` list. */
export function parseAvi(b: Uint8Array): ContainerInfo {
  const info: ContainerInfo = { duration: null, video: null, audio: null };
  const dv = view(b);
  const hdrl = riffChunks(b, 12, b.length).find(c => c.list === 'hdrl');
  if (!hdrl) return info;
  const chunks = riffChunks(b, hdrl.start, hdrl.end);
  const avih = chunks.find(c => c.id === 'avih');
  let width = 0;
  let height = 0;
  let frameRate: number | null = null;
  if (avih && avih.start + 40 <= avih.end) {
    const microSecPerFrame = dv.getUint32(avih.start, true);
    const totalFrames = dv.getUint32(avih.start + 16, true);
    width = dv.getUint32(avih.start + 32, true);
    height = dv.getUint32(avih.start + 36, true);
    if (microSecPerFrame > 0) {
      frameRate = 1e6 / microSecPerFrame;
      if (totalFrames > 0) info.duration = (totalFrames * microSecPerFrame) / 1e6;
    }
  }
  for (const strl of chunks.filter(c => c.list === 'strl')) {
    const parts = riffChunks(b, strl.start, strl.end);
    const strh = parts.find(c => c.id === 'strh');
    const strf = parts.find(c => c.id === 'strf');
    if (!strh || strh.start + 32 > strh.end) continue;
    const type = fourcc(b, strh.start);
    if (type === 'vids' && !info.video) {
      const scale = dv.getUint32(strh.start + 20, true);
      const rate = dv.getUint32(strh.start + 24, true);
      const compression = strf && strf.start + 20 <= strf.end ? fourcc(b, strf.start + 16) : '';
      info.video = {
        width,
        height,
        frameRate: scale > 0 && rate > 0 ? rate / scale : frameRate,
        rotation: 0,
        codec: compression.replace(/\0/g, '').trim() || fourcc(b, strh.start + 4).trim() || null,
      };
    } else if (type === 'auds' && !info.audio && strf && strf.start + 16 <= strf.end) {
      const tag = dv.getUint16(strf.start, true);
      info.audio = {
        codec: AVI_AUDIO_FORMATS[tag] ?? `0x${tag.toString(16).padStart(4, '0')}`,
        channels: dv.getUint16(strf.start + 2, true),
        sampleRate: dv.getUint32(strf.start + 4, true),
        bitDepth: dv.getUint16(strf.start + 14, true) || null,
      };
    }
  }
  return info;
}
