/**
 * Hand-built package fixtures: CRX2/CRX3 headers (with a tiny protobuf writer), Android binary
 * XML, store-only tars for npm tarballs, and RPMs (lead, signature and main headers, and a newc
 * cpio payload, gzipped by default).
 */
import { gzipSync, strToU8, zipSync, type Zippable } from 'fflate';

const u8 = (b: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(b);

export function concatBytes(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** A zip of text (or byte) files, deflated. */
export const zipOf = (files: Record<string, string | Uint8Array>): Uint8Array<ArrayBuffer> => {
  const z: Zippable = {};
  for (const [k, v] of Object.entries(files)) z[k] = typeof v === 'string' ? strToU8(v) : v;
  return u8(zipSync(z));
};

// --- protobuf -------------------------------------------------------------

function varint(n: number): number[] {
  const out: number[] = [];
  let v = n;
  while (v >= 0x80) {
    out.push((v % 0x80) | 0x80);
    v = Math.floor(v / 0x80);
  }
  out.push(v);
  return out;
}

/** A length-delimited field. */
export const pbBytes = (field: number, data: Uint8Array) =>
  concatBytes([new Uint8Array([...varint(field * 8 + 2), ...varint(data.length)]), data]);
export const pbString = (field: number, s: string) => pbBytes(field, strToU8(s));
export const pbVarint = (field: number, n: number) =>
  new Uint8Array([...varint(field * 8), ...varint(n)]);

// --- CRX ------------------------------------------------------------------

/** CRX3: Cr24, version 3, header length, CrxFileHeader, zip. */
export function crx3(zip: Uint8Array, publicKey: Uint8Array, crxId: Uint8Array) {
  const proof = concatBytes([pbBytes(1, publicKey), pbBytes(2, new Uint8Array(8))]);
  const header = concatBytes([pbBytes(2, proof), pbBytes(10000, pbBytes(1, crxId))]);
  const pre = new Uint8Array(12);
  pre.set(strToU8('Cr24'));
  const dv = new DataView(pre.buffer);
  dv.setUint32(4, 3, true);
  dv.setUint32(8, header.length, true);
  return concatBytes([pre, header, zip]);
}

/** CRX2: Cr24, version 2, key and signature lengths, key, signature, zip. */
export function crx2(zip: Uint8Array, publicKey: Uint8Array) {
  const pre = new Uint8Array(16);
  pre.set(strToU8('Cr24'));
  const dv = new DataView(pre.buffer);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, publicKey.length, true);
  dv.setUint32(12, 4, true);
  return concatBytes([pre, publicKey, new Uint8Array(4), zip]);
}

// --- Android binary XML ---------------------------------------------------

export const ANDROID_NS = 'http://schemas.android.com/apk/res/android';

export interface AxmlAttr {
  name: string;
  /** android: namespace. */
  android?: boolean;
  /** Resource ID for the name (goes in the resource map). */
  id?: number;
  string?: string;
  int?: number;
  bool?: boolean;
  ref?: number;
}

export type AxmlEvent = { start: string; attrs?: AxmlAttr[] } | { end: string };

/**
 * Android binary XML from start/end events. Attribute names with IDs go first in the pool, so
 * the resource map lines up, as aapt does.
 */
export function axml(events: AxmlEvent[], utf8 = false): Uint8Array<ArrayBuffer> {
  const attrNames: { name: string; id: number }[] = [];
  for (const e of events) {
    if ('start' in e) {
      for (const a of e.attrs ?? []) {
        if (a.id !== undefined && !attrNames.some(x => x.name === a.name)) {
          attrNames.push({ name: a.name, id: a.id });
        }
      }
    }
  }
  const pool: string[] = attrNames.map(a => a.name);
  const idx = (s: string) => {
    let i = pool.indexOf(s);
    if (i < 0) i = pool.push(s) - 1;
    return i;
  };
  idx(ANDROID_NS);

  const chunks: Uint8Array[] = [];
  const chunk = (type: number, headerSize: number, body: number[]) => {
    const b = new Uint8Array(8 + body.length * 4);
    const dv = new DataView(b.buffer);
    dv.setUint16(0, type, true);
    dv.setUint16(2, headerSize, true);
    dv.setUint32(4, b.length, true);
    body.forEach((v, i) => dv.setUint32(8 + i * 4, v >>> 0, true));
    return b;
  };
  const NONE = 0xffffffff;
  const elements: Uint8Array[] = [];
  for (const e of events) {
    if ('end' in e) {
      elements.push(chunk(0x0103, 16, [0, NONE, NONE, idx(e.end)]));
      continue;
    }
    const attrs = e.attrs ?? [];
    // line, comment, then ns, name, attributeStart|attributeSize, attributeCount|idIndex, class|style
    const body = [0, NONE, NONE, idx(e.start), 20 | (20 << 16), attrs.length, 0];
    const b = chunk(0x0102, 16, [...body, ...new Array<number>(attrs.length * 5).fill(0)]);
    const dv = new DataView(b.buffer);
    attrs.forEach((a, i) => {
      const at = 16 + 20 + i * 20;
      dv.setUint32(at, a.android ? idx(ANDROID_NS) : NONE, true);
      dv.setUint32(at + 4, idx(a.name), true);
      const [type, data, raw] =
        a.string !== undefined
          ? [0x03, idx(a.string), idx(a.string)]
          : a.bool !== undefined
            ? [0x12, a.bool ? 0xffffffff : 0, NONE]
            : a.ref !== undefined
              ? [0x01, a.ref, NONE]
              : [0x10, a.int ?? 0, NONE];
      dv.setUint32(at + 8, raw, true);
      dv.setUint16(at + 12, 8, true);
      dv.setUint8(at + 15, type);
      dv.setUint32(at + 16, data >>> 0, true);
    });
    elements.push(b);
  }

  // String pool
  const encoded = pool.map(s => {
    if (utf8) {
      const bytes = strToU8(s);
      return new Uint8Array([s.length, bytes.length, ...bytes, 0]);
    }
    const b = new Uint8Array(2 + s.length * 2 + 2);
    const dv = new DataView(b.buffer);
    dv.setUint16(0, s.length, true);
    for (let i = 0; i < s.length; i++) dv.setUint16(2 + i * 2, s.charCodeAt(i), true);
    return b;
  });
  const data = concatBytes(encoded);
  const padded = new Uint8Array(Math.ceil(data.length / 4) * 4);
  padded.set(data);
  const header = 28;
  const offsets = new Uint8Array(pool.length * 4);
  let off = 0;
  encoded.forEach((e, i) => {
    new DataView(offsets.buffer).setUint32(i * 4, off, true);
    off += e.length;
  });
  const sp = new Uint8Array(header + offsets.length + padded.length);
  const sdv = new DataView(sp.buffer);
  sdv.setUint16(0, 0x0001, true);
  sdv.setUint16(2, header, true);
  sdv.setUint32(4, sp.length, true);
  sdv.setUint32(8, pool.length, true);
  sdv.setUint32(12, 0, true);
  sdv.setUint32(16, utf8 ? 0x100 : 0, true);
  sdv.setUint32(20, header + offsets.length, true);
  sdv.setUint32(24, 0, true);
  sp.set(offsets, header);
  sp.set(padded, header + offsets.length);
  chunks.push(sp);
  chunks.push(
    chunk(
      0x0180,
      8,
      attrNames.map(a => a.id),
    ),
  );
  chunks.push(...elements);

  const body = concatBytes(chunks);
  const out = new Uint8Array(8 + body.length);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, 0x0003, true);
  dv.setUint16(2, 8, true);
  dv.setUint32(4, out.length, true);
  out.set(body, 8);
  return out;
}

/** A minimal AndroidManifest.xml in binary form. */
export function sampleAndroidManifest(utf8 = false) {
  return axml(
    [
      {
        start: 'manifest',
        attrs: [
          { name: 'versionCode', android: true, id: 0x0101021b, int: 42 },
          { name: 'versionName', android: true, id: 0x0101021c, string: '1.2.3' },
          { name: 'package', string: 'com.example.app' },
        ],
      },
      {
        start: 'uses-sdk',
        attrs: [
          { name: 'minSdkVersion', android: true, id: 0x0101020c, int: 24 },
          { name: 'targetSdkVersion', android: true, id: 0x01010270, int: 34 },
        ],
      },
      { end: 'uses-sdk' },
      {
        start: 'uses-permission',
        attrs: [
          { name: 'name', android: true, id: 0x01010003, string: 'android.permission.CAMERA' },
        ],
      },
      { end: 'uses-permission' },
      {
        start: 'uses-permission',
        attrs: [
          { name: 'name', android: true, id: 0x01010003, string: 'android.permission.INTERNET' },
        ],
      },
      { end: 'uses-permission' },
      {
        start: 'application',
        attrs: [
          { name: 'label', android: true, id: 0x01010001, ref: 0x7f0a0001 },
          { name: 'debuggable', android: true, bool: true },
        ],
      },
      {
        start: 'activity',
        attrs: [{ name: 'name', android: true, id: 0x01010003, string: '.Main' }],
      },
      { end: 'activity' },
      {
        start: 'activity',
        attrs: [{ name: 'name', android: true, id: 0x01010003, string: '.Two' }],
      },
      { end: 'activity' },
      {
        start: 'service',
        attrs: [{ name: 'name', android: true, id: 0x01010003, string: '.Sync' }],
      },
      { end: 'service' },
      { end: 'application' },
      { end: 'manifest' },
    ],
    utf8,
  );
}

// --- tar ------------------------------------------------------------------

/** Minimal ustar writer. */
export function tarOf(files: Record<string, string>): Uint8Array<ArrayBuffer> {
  const blocks: Uint8Array[] = [];
  for (const [path, text] of Object.entries(files)) {
    const data = strToU8(text);
    const h = new Uint8Array(512);
    const put = (s: string, at: number) => h.set(strToU8(s), at);
    const octal = (n: number, len: number) => n.toString(8).padStart(len - 1, '0');
    put(path, 0);
    put(octal(0o644, 8), 100);
    put(octal(0, 8), 108);
    put(octal(0, 8), 116);
    put(octal(data.length, 12), 124);
    put(octal(1_700_000_000, 12), 136);
    put('        ', 148);
    h[156] = 0x30;
    put('ustar\u000000', 257);
    const sum = h.reduce((a, b) => a + b, 0);
    put(`${sum.toString(8).padStart(6, '0')}\u0000 `, 148);
    blocks.push(h);
    const padded = new Uint8Array(Math.ceil(data.length / 512) * 512);
    padded.set(data);
    blocks.push(padded);
  }
  blocks.push(new Uint8Array(1024));
  return concatBytes(blocks);
}

export const npmTgz = (pkg: Record<string, unknown>, extra: Record<string, string> = {}) =>
  u8(gzipSync(tarOf({ 'package/package.json': JSON.stringify(pkg), ...extra })));

// --- RPM ------------------------------------------------------------------

const INT16 = 3;
const INT32 = 4;
const STRING = 6;
const STRING_ARRAY = 8;
const I18NSTRING = 9;

export type RpmTag =
  | { tag: number; type: 'string'; value: string }
  | { tag: number; type: 'i18n'; value: string }
  | { tag: number; type: 'strings'; value: string[] }
  | { tag: number; type: 'int16'; value: number[] }
  | { tag: number; type: 'int32'; value: number[] };

/** One header: magic, index entries and an aligned data store. */
export function rpmHeader(tags: RpmTag[]): Uint8Array<ArrayBuffer> {
  const store: number[] = [];
  const index: number[][] = [];
  for (const t of tags) {
    const align = t.type === 'int16' ? 2 : t.type === 'int32' ? 4 : 1;
    while (store.length % align) store.push(0);
    const offset = store.length;
    let type: number;
    let count: number;
    if (t.type === 'string' || t.type === 'i18n') {
      store.push(...strToU8(t.value), 0);
      type = t.type === 'string' ? STRING : I18NSTRING;
      count = 1;
    } else if (t.type === 'strings') {
      for (const s of t.value) store.push(...strToU8(s), 0);
      type = STRING_ARRAY;
      count = t.value.length;
    } else {
      const short = t.type === 'int16';
      const nums: number[] = t.value;
      for (const n of nums) {
        if (short) store.push((n >> 8) & 0xff, n & 0xff);
        else store.push((n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff);
      }
      type = short ? INT16 : INT32;
      count = nums.length;
    }
    index.push([t.tag, type, offset, count]);
  }
  const out = new Uint8Array(16 + index.length * 16 + store.length);
  const dv = new DataView(out.buffer);
  out.set([0x8e, 0xad, 0xe8, 0x01]);
  dv.setUint32(8, index.length);
  dv.setUint32(12, store.length);
  index.forEach((e, i) => e.forEach((v, j) => dv.setUint32(16 + i * 16 + j * 4, v)));
  out.set(store, 16 + index.length * 16);
  return out;
}

export interface RpmFile {
  path: string;
  /** Text content; directories have none. */
  data?: string;
  dir?: boolean;
  symlink?: string;
  ghost?: boolean;
}

/** A newc cpio archive of `files` (ghosts left out, as rpmbuild does). */
export function cpioOf(files: RpmFile[]): Uint8Array<ArrayBuffer> {
  const parts: Uint8Array[] = [];
  const hex = (n: number) => n.toString(16).padStart(8, '0');
  const pad = () => {
    const n = parts.reduce((s, p) => s + p.length, 0);
    if (n % 4) parts.push(new Uint8Array(4 - (n % 4)));
  };
  const entry = (name: string, mode: number, data: Uint8Array, ino: number) => {
    const fields = [ino, mode, 0, 0, 1, 1_700_000_000, data.length, 0, 0, 0, 0, name.length + 1, 0];
    parts.push(strToU8(`070701${fields.map(hex).join('')}${name}\u0000`));
    pad();
    parts.push(data);
    pad();
  };
  files.forEach((f, i) => {
    if (f.ghost) return;
    const mode = f.dir ? 0o040755 : f.symlink ? 0o120777 : 0o100644;
    entry(`.${f.path}`, mode, strToU8(f.symlink ?? f.data ?? ''), i + 1);
  });
  entry('TRAILER!!!', 0, new Uint8Array(0), 0);
  return concatBytes(parts);
}

export interface RpmSpec {
  name?: string;
  version?: string;
  release?: string;
  arch?: string;
  files: RpmFile[];
  /** Payload compressor written in the header; the payload must match. */
  compressor?: string;
  /** Compressed payload; defaults to the gzipped cpio of `files`. */
  payload?: Uint8Array;
  /** Uses OLDFILENAMES instead of BASENAMES/DIRNAMES/DIRINDEXES. */
  oldFilenames?: boolean;
  scripts?: { pre?: string; post?: string; postunProg?: string };
}

/** An RPM v3 package. */
export function rpm(spec: RpmSpec): Uint8Array<ArrayBuffer> {
  const name = spec.name ?? 'hello';
  const lead = new Uint8Array(96);
  lead.set([0xed, 0xab, 0xee, 0xdb, 3, 0, 0, 0, 0, 1]);
  lead.set(strToU8(`${name}-${spec.version ?? '1.0'}`), 10);
  lead.set([0, 1, 0, 5], 76);

  const sig = rpmHeader([{ tag: 1000, type: 'int32', value: [1234] }]);
  const sigPadded = new Uint8Array(Math.ceil(sig.length / 8) * 8);
  sigPadded.set(sig);

  const dirs: string[] = [];
  const dirIndexes: number[] = [];
  const baseNames: string[] = [];
  for (const f of spec.files) {
    const slash = f.path.lastIndexOf('/');
    const dir = f.path.slice(0, slash + 1);
    let di = dirs.indexOf(dir);
    if (di < 0) di = dirs.push(dir) - 1;
    dirIndexes.push(di);
    baseNames.push(f.path.slice(slash + 1));
  }
  const fileTags: RpmTag[] = spec.oldFilenames
    ? [{ tag: 1027, type: 'strings', value: spec.files.map(f => f.path) }]
    : [
        { tag: 1116, type: 'int32', value: dirIndexes },
        { tag: 1117, type: 'strings', value: baseNames },
        { tag: 1118, type: 'strings', value: dirs },
      ];
  const s = spec.scripts ?? {};
  const main = rpmHeader([
    { tag: 1000, type: 'string', value: name },
    { tag: 1001, type: 'string', value: spec.version ?? '1.0' },
    { tag: 1002, type: 'string', value: spec.release ?? '1.el9' },
    { tag: 1004, type: 'i18n', value: 'A friendly greeter' },
    { tag: 1006, type: 'int32', value: [1_700_000_000] },
    { tag: 1007, type: 'string', value: 'builder.example.com' },
    { tag: 1014, type: 'string', value: 'MIT' },
    { tag: 1022, type: 'string', value: spec.arch ?? 'x86_64' },
    ...(s.pre ? [{ tag: 1023, type: 'string' as const, value: s.pre }] : []),
    ...(s.post ? [{ tag: 1024, type: 'string' as const, value: s.post }] : []),
    ...(s.pre ? [{ tag: 1085, type: 'string' as const, value: '/bin/sh' }] : []),
    ...(s.postunProg ? [{ tag: 1088, type: 'string' as const, value: s.postunProg }] : []),
    {
      tag: 1028,
      type: 'int32',
      value: spec.files.map(f => (f.dir ? 4096 : strToU8(f.symlink ?? f.data ?? '').length)),
    },
    {
      tag: 1030,
      type: 'int16',
      value: spec.files.map(f => (f.dir ? 0o040755 : f.symlink ? 0o120777 : 0o100644)),
    },
    { tag: 1034, type: 'int32', value: spec.files.map(() => 1_700_000_000) },
    { tag: 1037, type: 'int32', value: spec.files.map(f => (f.ghost ? 1 << 6 : 0)) },
    { tag: 1047, type: 'strings', value: [name, `${name}(x86-64)`] },
    { tag: 1112, type: 'int32', value: [8, 8] },
    { tag: 1113, type: 'strings', value: ['1.0-1.el9', '1.0-1.el9'] },
    { tag: 1048, type: 'int32', value: [0, 8 | 4, (1 << 24) | 8 | 2] },
    { tag: 1049, type: 'strings', value: ['/bin/sh', 'glibc', 'rpmlib(CompressedFileNames)'] },
    { tag: 1050, type: 'strings', value: ['', '2.34', '3.0.4-1'] },
    ...fileTags,
    { tag: 1124, type: 'string', value: 'cpio' },
    { tag: 1125, type: 'string', value: spec.compressor ?? 'gzip' },
  ]);
  const payload = spec.payload ?? gzipSync(cpioOf(spec.files));
  return concatBytes([lead, sigPadded, main, payload]);
}

/** The RPM most tests use: a directory, two files, a symlink, a ghost and two scriptlets. */
export const sampleRpmFiles: RpmFile[] = [
  { path: '/usr/share/hello', dir: true },
  { path: '/usr/bin/hello', data: '#!/bin/sh\necho hello\n' },
  { path: '/usr/share/hello/README', data: 'Hello from the RPM payload.\n' },
  { path: '/usr/bin/hi', symlink: 'hello' },
  { path: '/var/log/hello.log', ghost: true },
];

export const sampleRpm = (extra: Partial<RpmSpec> = {}) =>
  rpm({
    files: sampleRpmFiles,
    scripts: {
      pre: 'getent group hello || groupadd hello',
      post: 'echo installed',
      postunProg: '/sbin/ldconfig',
    },
    ...extra,
  });
