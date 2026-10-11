/**
 * Legacy image files built in code for tests: TIFF (every compression we decode, written by our
 * own small encoders), EMF (with optional EMF+), WMF, PSD, TGA and PCX.
 */
import { zlibSync } from 'fflate';

// --- TIFF ---

/** Fill a width × height image's raw samples from a per-pixel function. */
export function samples(
  width: number,
  height: number,
  spp: number,
  pixel: (x: number, y: number) => number[],
): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(width * height * spp);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) out.set(pixel(x, y).slice(0, spp), (y * width + x) * spp);
  }
  return out;
}

/** Packs 0/1 values into MSB-first rows (1 = black for bilevel WhiteIsZero). */
export function packBits1(width: number, height: number, bit: (x: number, y: number) => number) {
  const row = Math.ceil(width / 8);
  const out = new Uint8Array(row * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++)
      if (bit(x, y)) out[y * row + (x >> 3)] = (out[y * row + (x >> 3)] ?? 0) | (0x80 >> (x & 7));
  }
  return out;
}

/** TIFF LZW (MSB-first codes, early change), as libtiff writes it. */
export function lzw(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  let width = 9;
  const emit = (code: number) => {
    acc = (acc << width) | code;
    bits += width;
    while (bits >= 8) {
      out.push((acc >>> (bits - 8)) & 255);
      bits -= 8;
    }
    acc &= (1 << bits) - 1;
  };
  let dict = new Map<string, number>();
  let next = 258;
  const reset = () => {
    dict = new Map();
    next = 258;
    width = 9;
  };
  emit(256);
  let w = '';
  for (const byte of data) {
    const wc = w + String.fromCharCode(byte);
    if (w === '' || dict.has(wc)) {
      w = wc;
      continue;
    }
    emit(w.length === 1 ? w.charCodeAt(0) : (dict.get(w) ?? 0));
    dict.set(wc, next++);
    if (next === 1 << width && width < 12) width++;
    if (next >= 4093) {
      emit(256);
      reset();
    }
    w = String.fromCharCode(byte);
  }
  if (w) {
    emit(w.length === 1 ? w.charCodeAt(0) : (dict.get(w) ?? 0));
    // The decoder adds an entry for this code too, which may widen the EOI code
    next++;
    if (next === 1 << width && width < 12) width++;
  }
  emit(257);
  if (bits > 0) out.push((acc << (8 - bits)) & 255);
  return new Uint8Array(out);
}

export function packBits(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const out: number[] = [];
  let i = 0;
  while (i < data.length) {
    let run = 1;
    while (i + run < data.length && run < 128 && data[i + run] === data[i]) run++;
    if (run >= 3) {
      out.push(257 - run, data[i] ?? 0);
      i += run;
      continue;
    }
    const start = i;
    while (i < data.length && i - start < 128) {
      if (i + 2 < data.length && data[i] === data[i + 1] && data[i] === data[i + 2]) break;
      i++;
    }
    out.push(i - start - 1, ...data.subarray(start, i));
  }
  return new Uint8Array(out);
}

// CCITT Modified Huffman codes (ITU-T T.4)
const split = (s: string) => s.split(',');
const TERM_W = split(
  '00110101,000111,0111,1000,1011,1100,1110,1111,10011,10100,00111,01000,001000,000011,110100,110101,101010,101011,0100111,0001100,0001000,0010111,0000011,0000100,0101000,0101011,0010011,0100100,0011000,00000010,00000011,00011010,00011011,00010010,00010011,00010100,00010101,00010110,00010111,00101000,00101001,00101010,00101011,00101100,00101101,00000100,00000101,00001010,00001011,01010010,01010011,01010100,01010101,00100100,00100101,01011000,01011001,01011010,01011011,01001010,01001011,00110010,00110011,00110100',
);
const TERM_B = split(
  '0000110111,010,11,10,011,0011,0010,00011,000101,000100,0000100,0000101,0000111,00000100,00000111,000011000,0000010111,0000011000,0000001000,00001100111,00001101000,00001101100,00000110111,00000101000,00000010111,00000011000,000011001010,000011001011,000011001100,000011001101,000001101000,000001101001,000001101010,000001101011,000011010010,000011010011,000011010100,000011010101,000011010110,000011010111,000001101100,000001101101,000011011010,000011011011,000001010100,000001010101,000001010110,000001010111,000001100100,000001100101,000001010010,000001010011,000000100100,000000110111,000000111000,000000100111,000000101000,000001011000,000001011001,000000101011,000000101100,000001011010,000001100110,000001100111',
);
const MAKE_W = split(
  '11011,10010,010111,0110111,00110110,00110111,01100100,01100101,01101000,01100111,011001100,011001101,011010010,011010011,011010100,011010101,011010110,011010111,011011000,011011001,011011010,011011011,010011000,010011001,010011010,011000,010011011',
);
const MAKE_B = split(
  '0000001111,000011001000,000011001001,000001011011,000000110011,000000110100,000000110101,0000001101100,0000001101101,0000001001010,0000001001011,0000001001100,0000001001101,0000001110010,0000001110011,0000001110100,0000001110101,0000001110110,0000001110111,0000001010010,0000001010011,0000001010100,0000001010101,0000001011010,0000001011011,0000001100100,0000001100101',
);

function runCode(n: number, black: boolean): string {
  let s = '';
  const make = black ? MAKE_B : MAKE_W;
  const term = black ? TERM_B : TERM_W;
  while (n >= 64) {
    const m = Math.min(1728, Math.floor(n / 64) * 64);
    s += make[m / 64 - 1];
    n -= m;
  }
  return s + term[n];
}

/** Runs of a bilevel row (bits 1 = black), starting with white. */
function runs(row: number[]): number[] {
  const out: number[] = [];
  let colour = 0;
  let n = 0;
  for (const b of row) {
    if (b === colour) n++;
    else {
      out.push(n);
      colour = b;
      n = 1;
    }
  }
  out.push(n);
  return out;
}

const bitsToBytes = (bits: string) => {
  const out = new Uint8Array(Math.ceil(bits.length / 8));
  for (let i = 0; i < bits.length; i++)
    if (bits[i] === '1') out[i >> 3] = (out[i >> 3] ?? 0) | (0x80 >> (i & 7));
  return out;
};

/** CCITT Group 3, one-dimensional: an EOL before each row, RTC at the end. */
export function g3(width: number, height: number, bit: (x: number, y: number) => number) {
  const EOL = '000000000001';
  let s = '';
  for (let y = 0; y < height; y++) {
    s += EOL;
    runs(Array.from({ length: width }, (_, x) => bit(x, y))).forEach(
      (n, i) => (s += runCode(n, i % 2 === 1)),
    );
  }
  s += EOL.repeat(6);
  return bitsToBytes(s);
}

/** CCITT Group 4 using only horizontal mode (valid, if not compact). */
export function g4(width: number, height: number, bit: (x: number, y: number) => number) {
  let s = '';
  for (let y = 0; y < height; y++) {
    const r = runs(Array.from({ length: width }, (_, x) => bit(x, y)));
    if (r.length % 2) r.push(0);
    for (let i = 0; i < r.length; i += 2)
      s += '001' + runCode(r[i] ?? 0, false) + runCode(r[i + 1] ?? 0, true);
  }
  s += '000000000001000000000001';
  return bitsToBytes(s);
}

export interface TiffPageSpec {
  width: number;
  height: number;
  /** Already compressed strip data (one strip). */
  data: Uint8Array;
  compression: number;
  photometric: number;
  bitsPerSample: number[];
  extraSamples?: number[];
  colorMap?: number[];
  dpi?: number;
  /** Extra numeric (SHORT) tags. */
  tags?: Record<number, number>;
}

/** A TIFF with one strip per page, little- or big-endian. */
export function makeTiff(pages: TiffPageSpec[], bigEndian = false): Uint8Array<ArrayBuffer> {
  const le = !bigEndian;
  let size = 8;
  const alloc = (n: number) => {
    const at = size;
    size += n + (n % 2);
    return at;
  };
  const writes: ((dv: DataView, b: Uint8Array) => void)[] = [];
  let firstIfd = 0;
  let prevNext = -1;
  for (const p of pages) {
    const dataAt = alloc(p.data.length);
    writes.push((_, b) => b.set(p.data, dataAt));
    type Entry = [tag: number, type: number, values: number[]];
    const entries: Entry[] = [
      [256, 4, [p.width]],
      [257, 4, [p.height]],
      [258, 3, p.bitsPerSample],
      [259, 3, [p.compression]],
      [262, 3, [p.photometric]],
      [273, 4, [dataAt]],
      [277, 3, [p.bitsPerSample.length]],
      [278, 4, [p.height]],
      [279, 4, [p.data.length]],
    ];
    if (p.dpi) entries.push([282, 5, [p.dpi, 1]], [283, 5, [p.dpi, 1]], [296, 3, [2]]);
    if (p.colorMap) entries.push([320, 3, p.colorMap]);
    if (p.extraSamples) entries.push([338, 3, p.extraSamples]);
    for (const [tag, v] of Object.entries(p.tags ?? {})) entries.push([Number(tag), 3, [v]]);
    entries.sort((a, b) => a[0] - b[0]);
    const ifdAt = alloc(2 + entries.length * 12 + 4);
    // Out-of-line values
    const outOfLine = entries.map(([, type, values]) => {
      const bytes =
        type === 3 ? values.length * 2 : type === 5 ? (values.length / 2) * 8 : values.length * 4;
      return bytes > 4 ? alloc(bytes) : -1;
    });
    const link = prevNext;
    writes.push(dv => {
      if (link >= 0) dv.setUint32(link, ifdAt, le);
      dv.setUint16(ifdAt, entries.length, le);
      entries.forEach(([tag, type, values], i) => {
        const e = ifdAt + 2 + i * 12;
        const count = type === 5 ? values.length / 2 : values.length;
        dv.setUint16(e, tag, le);
        dv.setUint16(e + 2, type, le);
        dv.setUint32(e + 4, count, le);
        const ool = outOfLine[i] ?? -1;
        const at = ool >= 0 ? ool : e + 8;
        if (ool >= 0) dv.setUint32(e + 8, at, le);
        values.forEach((v, j) => {
          if (type === 3) dv.setUint16(at + j * 2, v, le);
          else dv.setUint32(at + j * 4, v, le);
        });
      });
      dv.setUint32(ifdAt + 2 + entries.length * 12, 0, le);
    });
    if (firstIfd === 0) firstIfd = ifdAt;
    prevNext = ifdAt + 2 + entries.length * 12;
  }
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  out.set(le ? [0x49, 0x49, 42, 0] : [0x4d, 0x4d, 0, 42]);
  dv.setUint32(4, firstIfd, le);
  for (const w of writes) w(dv, out);
  return out;
}

/** Deflate strips are zlib streams. */
export const deflate = (data: Uint8Array) => zlibSync(data);

/** 16-bit samples as stored by a little- or big-endian file. */
export function samples16(values: number[], bigEndian = false): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(values.length * 2);
  const dv = new DataView(out.buffer);
  values.forEach((v, i) => dv.setUint16(i * 2, v, !bigEndian));
  return out;
}

// --- Metafiles ---

class Writer {
  bytes: number[] = [];
  u8(...v: number[]) {
    for (const x of v) this.bytes.push(x & 255);
    return this;
  }
  u16(...v: number[]) {
    for (const x of v) this.u8(x, x >> 8);
    return this;
  }
  u32(...v: number[]) {
    for (const x of v) this.u8(x, x >> 8, x >> 16, x >>> 24);
    return this;
  }
  f32(...v: number[]) {
    const b = new Uint8Array(4);
    for (const x of v) {
      new DataView(b.buffer).setFloat32(0, x, true);
      this.u8(...b);
    }
    return this;
  }
  utf16(s: string, chars = s.length) {
    for (let i = 0; i < chars; i++) this.u16(s.charCodeAt(i) || 0);
    return this;
  }
  pad4() {
    while (this.bytes.length % 4) this.u8(0);
    return this;
  }
  get length() {
    return this.bytes.length;
  }
}

/** One EMF record: type, then its body (size is filled in). */
export function emr(type: number, body: (w: Writer) => void): Uint8Array {
  const w = new Writer();
  body(w);
  w.pad4();
  const out = new Writer().u32(type, w.length + 8);
  return new Uint8Array([...out.bytes, ...w.bytes]);
}

export const colorRef = (r: number, g: number, b: number) => r | (g << 8) | (b << 16);

/** EMF records for a typical drawing in MM_TEXT pixels. */
export const emf = {
  createBrush: (ih: number, color: number, style = 0) => emr(39, w => w.u32(ih, style, color, 0)),
  createPen: (ih: number, color: number, width = 1, style = 0) =>
    emr(38, w => w.u32(ih, style, width, 0, color)),
  select: (ih: number) => emr(37, w => w.u32(ih)),
  rectangle: (l: number, t: number, r: number, b: number) => emr(43, w => w.u32(l, t, r, b)),
  ellipse: (l: number, t: number, r: number, b: number) => emr(42, w => w.u32(l, t, r, b)),
  polygon: (pts: [number, number][]) =>
    emr(3, w => {
      w.u32(0, 0, 0, 0, pts.length);
      for (const [x, y] of pts) w.u32(x, y);
    }),
  setTextColor: (c: number) => emr(24, w => w.u32(c)),
  setBkMode: (m: number) => emr(18, w => w.u32(m)),
  setTextAlign: (a: number) => emr(22, w => w.u32(a)),
  font: (ih: number, height: number, face: string, weight = 400) =>
    emr(82, w => {
      w.u32(ih, height, 0, 0, 0, weight).u8(0, 0, 0, 0, 0, 0, 0, 0).utf16(face, 32);
    }),
  text: (x: number, y: number, text: string) =>
    emr(84, w => {
      // bounds, graphics mode, scales, then EMRTEXT
      const offString = 76;
      w.u32(0, 0, 0, 0, 1).f32(1, 1);
      w.u32(x, y, text.length, offString, 0, 0, 0, 0, 0, 0);
      w.utf16(text);
    }),
  /** EMF+ records wrapped in a comment. */
  plus: (records: Uint8Array[]) =>
    emr(70, w => {
      const data = records.flatMap(r => [...r]);
      w.u32(data.length + 4, 0x2b464d45).u8(...data);
    }),
};

/** One EMF+ record. */
export function plusRecord(type: number, flags: number, body: (w: Writer) => void): Uint8Array {
  const w = new Writer();
  body(w);
  w.pad4();
  const head = new Writer().u16(type, flags).u32(w.length + 12, w.length);
  return new Uint8Array([...head.bytes, ...w.bytes]);
}

export const plus = {
  header: (dual = true) => plusRecord(0x4001, dual ? 1 : 0, w => w.u32(0xdbc01002, 1, 96, 96)),
  /** FillRects with a solid ARGB colour. */
  fillRect: (argb: number, x: number, y: number, w: number, h: number) =>
    plusRecord(0x400a, 0x8000, b => b.u32(argb, 1).f32(x, y, w, h)),
  solidBrush: (id: number, argb: number) =>
    plusRecord(0x4008, (1 << 8) | id, b => b.u32(0xdbc01002, 0, argb)),
  fillEllipse: (brushId: number, x: number, y: number, w: number, h: number) =>
    plusRecord(0x400e, 0, b => b.u32(brushId).f32(x, y, w, h)),
  eof: () => plusRecord(0x4002, 0, () => {}),
};

/**
 * An EMF whose frame is `width × height` pixels at 96 dpi (reference device 96 dpi, MM_TEXT),
 * holding `records`.
 */
export function makeEmf(
  width: number,
  height: number,
  records: Uint8Array[],
): Uint8Array<ArrayBuffer> {
  const body = [...records, emr(14, w => w.u32(0, 16, 0))];
  const total = 108 + body.reduce((n, r) => n + r.length, 0);
  const mm = (px: number) => Math.round((px / 96) * 2540); // .01 mm
  const h = new Writer()
    .u32(1, 108)
    .u32(0, 0, width - 1, height - 1) // bounds
    .u32(0, 0, mm(width), mm(height)) // frame
    .u32(0x464d4520, 0x10000, total, body.length + 1)
    .u16(4, 0)
    .u32(0, 0, 0)
    .u32(960, 960, 254, 254) // 96 dpi reference device
    .u32(0, 0, 0, 0, 0);
  return new Uint8Array([...h.bytes.slice(0, 108), ...body.flatMap(r => [...r])]);
}

/** Red rectangle (100,100)-(300,250), blue ellipse (400,100)-(600,300), green triangle, "Hello". */
export const SAMPLE_EMF_RECORDS = [
  emf.select(0x80000008), // NULL_PEN
  emf.createBrush(1, colorRef(255, 0, 0)),
  emf.select(1),
  emf.rectangle(100, 100, 300, 250),
  emf.createBrush(2, colorRef(0, 0, 255)),
  emf.select(2),
  emf.ellipse(400, 100, 600, 300),
  emf.createBrush(3, colorRef(0, 160, 0)),
  emf.select(3),
  emf.polygon([
    [100, 500],
    [200, 350],
    [300, 500],
  ]),
  emf.font(4, -40, 'Arial', 700),
  emf.select(4),
  emf.setTextColor(colorRef(0, 0, 0)),
  emf.setBkMode(1),
  emf.setTextAlign(24),
  emf.text(400, 450, 'Hello'),
];

/** One WMF record: function, then 16-bit words. */
export function wmr(fn: number, words: number[] | ((w: Writer) => void)): Uint8Array {
  const w = new Writer();
  if (Array.isArray(words)) w.u16(...words);
  else words(w);
  if (w.length % 2) w.u8(0);
  const head = new Writer().u32((w.length + 6) / 2).u16(fn);
  return new Uint8Array([...head.bytes, ...w.bytes]);
}

export const wmf = {
  windowOrg: (x: number, y: number) => wmr(0x020b, [y, x]),
  windowExt: (x: number, y: number) => wmr(0x020c, [y, x]),
  brush: (color: number) => wmr(0x02fc, w => w.u16(0).u32(color).u16(0)),
  nullPen: () => wmr(0x02fa, w => w.u16(5, 0, 0).u32(0)),
  pen: (color: number, width: number) => wmr(0x02fa, w => w.u16(0, width, 0).u32(color)),
  select: (i: number) => wmr(0x012d, [i]),
  rectangle: (l: number, t: number, r: number, b: number) => wmr(0x041b, [b, r, t, l]),
  ellipse: (l: number, t: number, r: number, b: number) => wmr(0x0418, [b, r, t, l]),
  polygon: (pts: [number, number][]) => wmr(0x0324, [pts.length, ...pts.flat()]),
  font: (height: number, face: string) =>
    wmr(0x02fb, w => {
      w.u16(height & 0xffff, 0, 0, 0, 400).u8(0, 0, 0, 0, 0, 0, 0, 0);
      for (let i = 0; i < 32; i++) w.u8(face.charCodeAt(i) || 0);
    }),
  textColor: (c: number) => wmr(0x0209, w => w.u32(c)),
  textOut: (x: number, y: number, text: string) =>
    wmr(0x0521, w => {
      w.u16(text.length);
      for (const ch of text) w.u8(ch.charCodeAt(0));
      if (text.length % 2) w.u8(0);
      w.u16(y, x);
    }),
};

/** A placeable WMF: `units` logical units per inch, a `w × h` unit box, window set to match. */
export function makeWmf(w: number, h: number, units: number, records: Uint8Array[], objects = 8) {
  const body = [wmf.windowOrg(0, 0), wmf.windowExt(w, h), ...records, wmr(0, [])];
  const words = 9 + body.reduce((n, r) => n + r.length / 2, 0);
  const place = new Writer().u32(0x9ac6cdd7).u16(0, 0, 0, w, h, units).u32(0);
  let sum = 0;
  for (let i = 0; i < 10; i += 2) sum ^= (place.bytes[i] ?? 0) | ((place.bytes[i + 1] ?? 0) << 8);
  place.u16(sum);
  const header = new Writer().u16(1, 9, 0x300).u32(words).u16(objects).u32(0).u16(0);
  return new Uint8Array([...place.bytes, ...header.bytes, ...body.flatMap(r => [...r])]);
}

// --- PSD, TGA, PCX ---

/** RGB PSD, RLE- or raw-compressed composite. */
export function makePsd(
  width: number,
  height: number,
  pixel: (x: number, y: number) => [number, number, number],
  rle = true,
): Uint8Array<ArrayBuffer> {
  const be = (n: number, bytes: number) =>
    Array.from({ length: bytes }, (_, i) => (n >>> ((bytes - 1 - i) * 8)) & 255);
  const head = [
    ...[0x38, 0x42, 0x50, 0x53],
    ...be(1, 2),
    0,
    0,
    0,
    0,
    0,
    0,
    ...be(3, 2),
    ...be(height, 4),
    ...be(width, 4),
    ...be(8, 2),
    ...be(3, 2),
    ...be(0, 4), // colour mode data
    ...be(0, 4), // resources
    ...be(0, 4), // layers
  ];
  const channels = [0, 1, 2].map(c =>
    Array.from({ length: height }, (_, y) =>
      Uint8Array.from({ length: width }, (_, x) => pixel(x, y)[c] ?? 0),
    ),
  );
  if (!rle)
    return new Uint8Array([
      ...head,
      ...be(0, 2),
      ...channels.flatMap(rows => rows.flatMap(r => [...r])),
    ]);
  const packed = channels.flatMap(rows => rows.map(r => [...packBits(r)]));
  return new Uint8Array([
    ...head,
    ...be(1, 2),
    ...packed.flatMap(r => be(r.length, 2)),
    ...packed.flat(),
  ]);
}

/** 24-bit TGA (bottom-up), raw or RLE, with a TGA 2.0 footer. */
export function makeTga(
  width: number,
  height: number,
  pixel: (x: number, y: number) => [number, number, number],
  rle = false,
): Uint8Array<ArrayBuffer> {
  const head = [
    0,
    0,
    rle ? 10 : 2,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    width & 255,
    width >> 8,
    height & 255,
    height >> 8,
    24,
    0,
  ];
  const px: number[][] = [];
  for (let y = height - 1; y >= 0; y--) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      px.push([b, g, r]);
    }
  }
  const data: number[] = [];
  if (!rle) px.forEach(p => data.push(...p));
  else {
    let i = 0;
    while (i < px.length) {
      let n = 1;
      while (i + n < px.length && n < 128 && px[i + n]?.join() === px[i]?.join()) n++;
      data.push(0x80 | (n - 1), ...(px[i] ?? []));
      i += n;
    }
  }
  const footer = [0, 0, 0, 0, 0, 0, 0, 0, ...[...'TRUEVISION-XFILE.'].map(c => c.charCodeAt(0)), 0];
  return new Uint8Array([...head, ...data, ...footer]);
}

/** 256-colour PCX with a palette (index i = colour palette[i]). */
export function makePcx(
  width: number,
  height: number,
  index: (x: number, y: number) => number,
  palette: [number, number, number][],
): Uint8Array<ArrayBuffer> {
  const bpl = width + (width % 2);
  const head = new Uint8Array(128);
  const dv = new DataView(head.buffer);
  head.set([0x0a, 5, 1, 8]);
  dv.setUint16(8, width - 1, true);
  dv.setUint16(10, height - 1, true);
  dv.setUint16(12, 300, true);
  dv.setUint16(14, 300, true);
  head[65] = 1;
  dv.setUint16(66, bpl, true);
  dv.setUint16(68, 1, true);
  const data: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < bpl; x++) {
      const v = x < width ? index(x, y) : 0;
      if (v >= 0xc0) data.push(0xc1);
      data.push(v);
    }
  }
  const pal = Array.from({ length: 256 }, (_, i) => palette[i] ?? [0, 0, 0]).flat();
  return new Uint8Array([...head, ...data, 0x0c, ...pal]);
}
