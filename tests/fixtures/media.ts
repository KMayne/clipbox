/** Generated audio/video fixtures: tiny, valid headers built in code rather than checked-in files. */

const enc = (s: string) => [...s].map(c => c.charCodeAt(0));

const u32be = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16be = (n: number) => [(n >>> 8) & 255, n & 255];
const u32le = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const u16le = (n: number) => [n & 255, (n >>> 8) & 255];

const bytes = (parts: number[]) => new Uint8Array(parts);

/** 16-bit PCM WAV with a sine tone. */
export function wav({ seconds = 1, rate = 8000, channels = 1, freq = 440 } = {}) {
  const frames = Math.round(seconds * rate);
  const dataSize = frames * channels * 2;
  const out = new Uint8Array(44 + dataSize);
  out.set([
    ...enc('RIFF'),
    ...u32le(36 + dataSize),
    ...enc('WAVEfmt '),
    ...u32le(16),
    ...u16le(1),
    ...u16le(channels),
    ...u32le(rate),
    ...u32le(rate * channels * 2),
    ...u16le(channels * 2),
    ...u16le(16),
    ...enc('data'),
    ...u32le(dataSize),
  ]);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < frames; i++) {
    const v = Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 0.8 * 32767);
    for (let c = 0; c < channels; c++) dv.setInt16(44 + (i * channels + c) * 2, v, true);
  }
  return out;
}

const synchsafe = (n: number) => [(n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127];

function id3Frame(id: string, payload: number[]) {
  return [...enc(id), ...u32be(payload.length), 0, 0, ...payload];
}

const textFrame = (id: string, text: string) => id3Frame(id, [0, ...enc(text)]);

/** MPEG-1 Layer III, 128 kbps, 44.1 kHz, no padding: 417-byte frames. */
export const MP3_FRAME_HEADER = [0xff, 0xfb, 0x90, 0x00];
export const mp3Frame = () => {
  const f = new Array<number>(417).fill(0);
  f.splice(0, 4, ...MP3_FRAME_HEADER);
  return f;
};

/** ID3v2.3 tag with title/artist/album/year/track and an optional PNG cover, then MPEG frames. */
export function mp3WithId3({ frames = 4, cover }: { frames?: number; cover?: Uint8Array } = {}) {
  const tagFrames = [
    ...textFrame('TIT2', 'Test Tone'),
    ...textFrame('TPE1', 'Clipbox'),
    ...textFrame('TALB', 'Fixtures'),
    ...textFrame('TYER', '2026'),
    ...textFrame('TRCK', '3/12'),
    ...(cover
      ? id3Frame('APIC', [0, ...enc('image/png'), 0, 3, 0, ...cover]) // type 3: front cover
      : []),
  ];
  const header = [...enc('ID3'), 3, 0, 0, ...synchsafe(tagFrames.length)];
  const audio = Array.from({ length: frames }, mp3Frame).flat();
  return bytes([...header, ...tagFrames, ...audio]);
}

// ISO-BMFF
const box = (type: string, ...payload: number[][]) => {
  const body = payload.flat();
  return [...u32be(8 + body.length), ...enc(type), ...body];
};
const fullBox = (type: string, ...payload: number[][]) => box(type, [0, 0, 0, 0], ...payload);

export const ftyp = (major: string, ...compatible: string[]) =>
  bytes(box('ftyp', enc(major), u32be(0), ...compatible.map(enc)));

/** 16.16 matrix for a clockwise rotation. */
function matrix(degrees: number) {
  const r = (degrees * Math.PI) / 180;
  const fx = (v: number) => u32be(Math.round(v * 65536) >>> 0);
  const [cos, sin] = [Math.round(Math.cos(r)), Math.round(Math.sin(r))];
  return [
    ...fx(cos),
    ...fx(sin),
    ...u32be(0),
    ...fx(-sin),
    ...fx(cos),
    ...u32be(0),
    ...u32be(0),
    ...u32be(0),
    ...u32be(0x40000000),
  ];
}

/** An MP4 with one video track: avc1 width×height, `frames` samples at `fps`, rotated. */
export function mp4({
  width = 1920,
  height = 1080,
  fps = 30,
  frames = 60,
  rotation = 0,
  handler = 'vide',
} = {}) {
  const timescale = fps * 1000;
  const duration = frames * 1000;
  const tkhd = fullBox(
    'tkhd',
    u32be(0),
    u32be(0),
    u32be(1),
    u32be(0),
    u32be(duration),
    u32be(0),
    u32be(0),
    u16be(0),
    u16be(0),
    u16be(0),
    u16be(0),
    matrix(rotation),
    u32be(width << 16),
    u32be(height << 16),
  );
  const mdhd = fullBox('mdhd', u32be(0), u32be(0), u32be(timescale), u32be(duration), u32be(0));
  const hdlr = fullBox('hdlr', u32be(0), enc(handler), u32be(0), u32be(0), u32be(0), [0]);
  const avc1 = box(
    'avc1',
    new Array<number>(6).fill(0),
    u16be(1),
    new Array<number>(16).fill(0),
    u16be(width),
    u16be(height),
    new Array<number>(50).fill(0),
  );
  const stsd = fullBox('stsd', u32be(1), avc1);
  const stts = fullBox('stts', u32be(1), u32be(frames), u32be(1000));
  const trak = box('trak', tkhd, box('mdia', mdhd, hdlr, box('minf', box('stbl', stsd, stts))));
  const mvhd = fullBox(
    'mvhd',
    u32be(0),
    u32be(0),
    u32be(1000),
    u32be((frames * 1000) / fps),
    new Array<number>(80).fill(0),
  );
  return bytes([
    ...box('ftyp', enc('isom'), u32be(512), enc('isom'), enc('avc1')),
    ...box('moov', mvhd, trak),
  ]);
}

// RIFF / AVI
const chunk = (id: string, payload: number[]) => [
  ...enc(id),
  ...u32le(payload.length),
  ...payload,
  ...(payload.length % 2 ? [0] : []),
];
const list = (type: string, ...children: number[][]) =>
  chunk('LIST', [...enc(type), ...children.flat()]);

export function avi({ width = 640, height = 480, fps = 25, frames = 50 } = {}) {
  const avih = chunk('avih', [
    ...u32le(Math.round(1e6 / fps)),
    ...u32le(0),
    ...u32le(0),
    ...u32le(0),
    ...u32le(frames),
    ...u32le(0),
    ...u32le(1),
    ...u32le(0),
    ...u32le(width),
    ...u32le(height),
    ...new Array<number>(16).fill(0),
  ]);
  const strh = chunk('strh', [
    ...enc('vidsMJPG'),
    ...u32le(0),
    ...u16le(0),
    ...u16le(0),
    ...u32le(0),
    ...u32le(1),
    ...u32le(fps),
    ...u32le(0),
    ...u32le(frames),
    ...new Array<number>(24).fill(0),
  ]);
  const strf = chunk('strf', [
    ...u32le(40),
    ...u32le(width),
    ...u32le(height),
    ...u16le(1),
    ...u16le(24),
    ...enc('MJPG'),
    ...new Array<number>(20).fill(0),
  ]);
  const body = [...enc('AVI '), ...list('hdrl', avih, list('strl', strh, strf)), ...list('movi')];
  return bytes([...enc('RIFF'), ...u32le(body.length), ...body]);
}

export const riff = (type: string) =>
  bytes([...enc('RIFF'), ...u32le(4), ...enc(type), 0, 0, 0, 0]);

// EBML / WebM
/** 8-byte EBML size vint. */
const ebmlSize = (n: number) => [0x01, 0, 0, 0, ...u32be(n)];
const el = (id: number[], ...payload: number[][]) => {
  const body = payload.flat();
  return [...id, ...ebmlSize(body.length), ...body];
};

/** WebM header plus a Tracks element with the given track types (1 video, 2 audio). */
export function webm(trackTypes: number[], { docType = 'webm', tracks = true } = {}) {
  const header = el([0x1a, 0x45, 0xdf, 0xa3], el([0x42, 0x82], enc(docType)));
  const entries = trackTypes.map((t, i) => el([0xae], el([0xd7], [i + 1]), el([0x83], [t])));
  const segment = [
    0x18,
    0x53,
    0x80,
    0x67,
    0x01,
    0xff,
    0xff,
    0xff,
    0xff,
    0xff,
    0xff,
    0xff, // unknown size
    ...el([0x15, 0x49, 0xa9, 0x66], el([0x2a, 0xd7, 0xb1], [0x0f, 0x42, 0x40])),
    ...(tracks ? el([0x16, 0x54, 0xae, 0x6b], ...entries) : []),
  ];
  return bytes([...header, ...segment]);
}

export function ogg(firstPacket: number[]) {
  const header = [...enc('OggS'), 0, 2, ...new Array<number>(20).fill(0), 1, firstPacket.length];
  return bytes([...header, ...firstPacket]);
}
