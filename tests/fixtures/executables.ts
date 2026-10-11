/**
 * Hand-built program files for tests: minimal but valid PE, ELF and Mach-O images with just the
 * structures Clipbox reads. No real third-party binaries are committed.
 */
import { solidPng } from './pptx';

/** A growable little/big-endian byte buffer with patchable fields. */
class Buf {
  bytes = new Uint8Array(256);
  length = 0;
  constructor(readonly little = true) {}
  private grow(n: number) {
    if (this.length + n <= this.bytes.length) return;
    const next = new Uint8Array(Math.max(this.bytes.length * 2, this.length + n));
    next.set(this.bytes);
    this.bytes = next;
  }
  private dv() {
    return new DataView(this.bytes.buffer);
  }
  u8(v: number) {
    this.grow(1);
    this.bytes[this.length++] = v;
    return this;
  }
  u16(v: number) {
    this.grow(2);
    this.dv().setUint16(this.length, v, this.little);
    this.length += 2;
    return this;
  }
  u32(v: number) {
    this.grow(4);
    this.dv().setUint32(this.length, v >>> 0, this.little);
    this.length += 4;
    return this;
  }
  u64(v: number | bigint) {
    this.grow(8);
    this.dv().setBigUint64(this.length, BigInt(v), this.little);
    this.length += 8;
    return this;
  }
  raw(b: ArrayLike<number>) {
    this.grow(b.length);
    this.bytes.set(b, this.length);
    this.length += b.length;
    return this;
  }
  ascii(s: string, nul = true) {
    for (const c of s) this.u8(c.charCodeAt(0));
    if (nul) this.u8(0);
    return this;
  }
  utf16(s: string, nul = true) {
    for (const c of s) this.u16(c.charCodeAt(0));
    if (nul) this.u16(0);
    return this;
  }
  fixed(s: string, size: number) {
    const b = new Uint8Array(size);
    for (let i = 0; i < Math.min(s.length, size); i++) b[i] = s.charCodeAt(i);
    return this.raw(b);
  }
  zeros(n: number) {
    this.grow(n);
    this.bytes.fill(0, this.length, this.length + n);
    this.length += n;
    return this;
  }
  align(n: number) {
    while (this.length % n) this.u8(0);
    return this;
  }
  set32(at: number, v: number) {
    this.dv().setUint32(at, v >>> 0, this.little);
  }
  set16(at: number, v: number) {
    this.dv().setUint16(at, v, this.little);
  }
  set64(at: number, v: number | bigint) {
    this.dv().setBigUint64(at, BigInt(v), this.little);
  }
  out(): Uint8Array<ArrayBuffer> {
    return this.bytes.slice(0, this.length);
  }
}

const align = (n: number, to: number) => Math.ceil(n / to) * to;

/** Deterministic pseudo-random bytes (high entropy). */
export function noise(n: number, seed = 1): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(n);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < n; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out[i] = x & 0xff;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// PE

export interface PeImport {
  dll: string;
  /** Names, or numbers for imports by ordinal. */
  functions: (string | number)[];
  delay?: boolean;
}

export interface PeSpec {
  bits?: 32 | 64;
  machine?: number;
  dll?: boolean;
  subsystem?: number;
  timestamp?: number;
  /** Default: ASLR | NX | high-entropy VA (64-bit) | CFG. */
  dllCharacteristics?: number;
  imports?: PeImport[];
  exports?: { name: string; forwarder?: string }[];
  exportName?: string;
  version?: { file: [number, number, number, number]; strings: Record<string, string> };
  /** Icon group: each image is a PNG (by size) or a 32-bit DIB. */
  icons?: { width: number; height: number; png: boolean }[];
  manifest?: string;
  /** DER PKCS#7 SignedData, written to the certificate table. */
  pkcs7?: Uint8Array;
  overlay?: Uint8Array;
  dotnet?: boolean;
  reproducible?: boolean;
  pdb?: string;
  /** Extra sections, e.g. a high-entropy "UPX1". */
  extraSections?: { name: string; data: Uint8Array }[];
}

/** RT_ICON image: a 32-bit BGRA DIB with an AND mask, double height as in .ico files. */
export function dibIcon(width: number, height: number, bgra: [number, number, number, number]) {
  const b = new Buf();
  b.u32(40)
    .u32(width)
    .u32(height * 2)
    .u16(1)
    .u16(32)
    .u32(0)
    .u32(0)
    .u32(0)
    .u32(0)
    .u32(0)
    .u32(0);
  for (let i = 0; i < width * height; i++) b.raw(bgra);
  const andStride = Math.ceil(width / 32) * 4;
  b.zeros(andStride * height);
  return b.out();
}

function versionBlock(key: string, value: Uint8Array | string | null, children: Uint8Array[]) {
  const b = new Buf();
  b.u16(0)
    .u16(0)
    .u16(typeof value === 'string' ? 1 : 0)
    .utf16(key)
    .align(4);
  let valueLength = 0;
  if (typeof value === 'string') {
    b.utf16(value);
    valueLength = value.length + 1;
  } else if (value) {
    b.raw(value);
    valueLength = value.length;
  }
  for (const c of children) b.align(4).raw(c);
  b.set16(0, b.length);
  b.set16(2, valueLength);
  return b.out();
}

export function versionResource(
  file: [number, number, number, number],
  strings: Record<string, string>,
) {
  const fixed = new Buf();
  const [a, b, c, d] = file;
  fixed.u32(0xfeef04bd).u32(0x10000);
  fixed
    .u32((a << 16) | b)
    .u32((c << 16) | d)
    .u32((a << 16) | b)
    .u32((c << 16) | d);
  fixed.u32(0x3f).u32(0).u32(0x40004).u32(1).u32(0).u32(0).u32(0);
  const table = versionBlock(
    '040904B0',
    null,
    Object.entries(strings).map(([k, v]) => versionBlock(k, v, [])),
  );
  const translation = new Buf().u16(0x0409).u16(0x04b0).out();
  return versionBlock('VS_VERSION_INFO', fixed.out(), [
    versionBlock('StringFileInfo', null, [table]),
    versionBlock('VarFileInfo', null, [versionBlock('Translation', translation, [])]),
  ]);
}

interface ResourceSpec {
  type: number;
  id: number;
  lang: number;
  data: Uint8Array;
}

/** A resource tree (type → id → language) at RVA `base`. */
function resourceSection(resources: ResourceSpec[], base: number): Uint8Array<ArrayBuffer> {
  const types = [...new Set(resources.map(r => r.type))].sort((x, y) => x - y);
  const byType = types.map(t => ({
    type: t,
    items: resources.filter(r => r.type === t).sort((x, y) => x.id - y.id),
  }));
  const rootSize = 16 + types.length * 8;
  let at = rootSize;
  const typeDirAt = byType.map(t => {
    const p = at;
    at += 16 + t.items.length * 8;
    return p;
  });
  const langDirAt = byType.map(t =>
    t.items.map(() => {
      const p = at;
      at += 16 + 8;
      return p;
    }),
  );
  const leafAt = byType.map(t =>
    t.items.map(() => {
      const p = at;
      at += 16;
      return p;
    }),
  );
  const dataAt = byType.map(t =>
    t.items.map(item => {
      at = align(at, 8);
      const p = at;
      at += item.data.length;
      return p;
    }),
  );
  const b = new Buf();
  b.zeros(align(at, 8));
  const dir = (p: number, entries: [number, number][]) => {
    b.set16(p + 14, entries.length);
    entries.forEach(([id, target], i) => {
      b.set32(p + 16 + i * 8, id);
      b.set32(p + 16 + i * 8 + 4, target);
    });
  };
  dir(
    0,
    byType.map((t, i) => [t.type, 0x80000000 | (typeDirAt[i] ?? 0)]),
  );
  byType.forEach((t, ti) => {
    dir(
      typeDirAt[ti] ?? 0,
      t.items.map((item, ii) => [item.id, 0x80000000 | (langDirAt[ti]?.[ii] ?? 0)]),
    );
    t.items.forEach((item, ii) => {
      const leaf = leafAt[ti]?.[ii] ?? 0;
      const data = dataAt[ti]?.[ii] ?? 0;
      dir(langDirAt[ti]?.[ii] ?? 0, [[item.lang, leaf]]);
      b.set32(leaf, base + data);
      b.set32(leaf + 4, item.data.length);
      b.bytes.set(item.data, data);
    });
  });
  return b.out();
}

const SECTION_ALIGN = 0x1000;
const FILE_ALIGN = 0x200;

export function makePe(spec: PeSpec = {}): Uint8Array<ArrayBuffer> {
  const bits = spec.bits ?? 64;
  const is64 = bits === 64;
  const imageBase = is64 ? 0x140000000n : 0x400000n;
  const optSize = is64 ? 240 : 224;
  const extra = spec.extraSections ?? [];
  const sectionCount = 3 + extra.length;
  const headerEnd = 0x40 + 4 + 20 + optSize + sectionCount * 40;
  const sizeOfHeaders = align(headerEnd, FILE_ALIGN);

  // .text: a little low-entropy "code"
  const text = new Buf();
  for (let i = 0; i < 0x100; i++)
    text.u8([0x55, 0x48, 0x89, 0xe5, 0xc3, 0x90, 0x90, 0x90][i % 8] ?? 0x90);
  const textRva = 0x1000;

  // .rdata: imports, delay imports, exports, debug directory, CLR header
  const rdataRva = 0x2000;
  const rd = new Buf();
  const rva = () => rdataRva + rd.length;
  const dirs: [number, number][] = Array.from({ length: 16 }, () => [0, 0]);
  const thunkSize = is64 ? 8 : 4;
  const writeThunks = (functions: (string | number)[], names: number[]) => {
    const at = rva();
    functions.forEach((f, i) => {
      if (typeof f === 'number') {
        if (is64) rd.u64(0x8000000000000000n | BigInt(f));
        else rd.u32(0x80000000 | f);
      } else if (is64) rd.u64(names[i] ?? 0);
      else rd.u32(names[i] ?? 0);
    });
    if (is64) rd.u64(0);
    else rd.u32(0);
    return at;
  };
  const writeHintNames = (functions: (string | number)[]) =>
    functions.map(f => {
      if (typeof f === 'number') return 0;
      rd.align(2);
      const at = rva();
      rd.u16(0).ascii(f);
      return at;
    });

  const normal = (spec.imports ?? []).filter(i => !i.delay);
  const delayed = (spec.imports ?? []).filter(i => i.delay);
  if (normal.length) {
    const descAt = rd.length;
    rd.zeros((normal.length + 1) * 20);
    dirs[1] = [rdataRva + descAt, (normal.length + 1) * 20];
    normal.forEach((imp, i) => {
      const nameRva = rva();
      rd.ascii(imp.dll);
      const hints = writeHintNames(imp.functions);
      rd.align(thunkSize);
      const ilt = writeThunks(imp.functions, hints);
      const iat = writeThunks(imp.functions, hints);
      const d = descAt + i * 20;
      rd.set32(d, ilt);
      rd.set32(d + 12, nameRva);
      rd.set32(d + 16, iat);
    });
  }
  if (delayed.length) {
    rd.align(4);
    const descAt = rd.length;
    rd.zeros((delayed.length + 1) * 32);
    dirs[13] = [rdataRva + descAt, (delayed.length + 1) * 32];
    delayed.forEach((imp, i) => {
      const nameRva = rva();
      rd.ascii(imp.dll);
      const hints = writeHintNames(imp.functions);
      rd.align(thunkSize);
      const int = writeThunks(imp.functions, hints);
      const d = descAt + i * 32;
      rd.set32(d, 1); // RVA-based
      rd.set32(d + 4, nameRva);
      rd.set32(d + 16, int);
    });
  }
  if (spec.exports?.length) {
    rd.align(4);
    const ex = spec.exports;
    const dirAt = rd.length;
    rd.zeros(40);
    const eat = rva();
    rd.zeros(ex.length * 4);
    const sorted = ex
      .map((e, i) => ({ ...e, index: i }))
      .sort((x, y) => (x.name < y.name ? -1 : 1));
    const namesAt = rva();
    rd.zeros(ex.length * 4);
    const ordsAt = rva();
    rd.zeros(ex.length * 2);
    const dllName = rva();
    rd.ascii(spec.exportName ?? 'example.dll');
    sorted.forEach((e, k) => {
      const nameRva = rva();
      rd.ascii(e.name);
      rd.set32(namesAt - rdataRva + k * 4, nameRva);
      rd.set16(ordsAt - rdataRva + k * 2, e.index);
    });
    ex.forEach((e, i) => {
      if (e.forwarder) {
        const fw = rva();
        rd.ascii(e.forwarder);
        rd.set32(eat - rdataRva + i * 4, fw);
      } else rd.set32(eat - rdataRva + i * 4, textRva + i * 16);
    });
    rd.set32(dirAt + 12, dllName);
    rd.set32(dirAt + 16, 1); // ordinal base
    rd.set32(dirAt + 20, ex.length);
    rd.set32(dirAt + 24, ex.length);
    rd.set32(dirAt + 28, eat);
    rd.set32(dirAt + 32, namesAt);
    rd.set32(dirAt + 36, ordsAt);
    dirs[0] = [rdataRva + dirAt, rd.length - dirAt];
  }
  const debugEntries: { type: number; data: Uint8Array | null }[] = [];
  if (spec.pdb) {
    const cv = new Buf().ascii('RSDS', false).zeros(16).u32(1).ascii(spec.pdb).out();
    debugEntries.push({ type: 2, data: cv });
  }
  if (spec.reproducible) debugEntries.push({ type: 16, data: null });
  let debugDirAt = -1;
  const debugDataAt: number[] = [];
  if (debugEntries.length) {
    rd.align(4);
    debugDirAt = rd.length;
    rd.zeros(debugEntries.length * 28);
    dirs[6] = [rdataRva + debugDirAt, debugEntries.length * 28];
    for (const e of debugEntries) {
      debugDataAt.push(rd.length);
      if (e.data) rd.raw(e.data);
    }
  }
  if (spec.dotnet) {
    rd.align(4);
    const cor = rd.length;
    rd.zeros(72);
    const md = rva();
    rd.u32(0x424a5342).u16(1).u16(1).u32(0).u32(12).ascii('v4.0.30319', false).zeros(2);
    rd.set32(cor, 72);
    rd.set16(cor + 4, 2);
    rd.set16(cor + 6, 5);
    rd.set32(cor + 8, md);
    rd.set32(cor + 12, 28);
    rd.set32(cor + 16, 1);
    dirs[14] = [rdataRva + cor, 72];
  }
  if (rd.length === 0) rd.zeros(16);

  // .rsrc
  const rsrcRva = align(rdataRva + rd.length, SECTION_ALIGN);
  const resources: ResourceSpec[] = [];
  if (spec.version)
    resources.push({
      type: 16,
      id: 1,
      lang: 0x409,
      data: versionResource(spec.version.file, spec.version.strings),
    });
  if (spec.icons?.length) {
    const group = new Buf().u16(0).u16(1).u16(spec.icons.length);
    spec.icons.forEach((icon, i) => {
      const data = icon.png
        ? solidPng(icon.width, icon.height, [40, 120, 220])
        : dibIcon(icon.width, icon.height, [30, 160, 60, 255]);
      resources.push({ type: 3, id: i + 1, lang: 0x409, data });
      group
        .u8(icon.width >= 256 ? 0 : icon.width)
        .u8(icon.height >= 256 ? 0 : icon.height)
        .u8(0)
        .u8(0);
      group
        .u16(1)
        .u16(32)
        .u32(data.length)
        .u16(i + 1);
    });
    resources.push({ type: 14, id: 1, lang: 0x409, data: group.out() });
  }
  if (spec.manifest)
    resources.push({ type: 24, id: 1, lang: 0x409, data: new TextEncoder().encode(spec.manifest) });
  const rsrc = resources.length ? resourceSection(resources, rsrcRva) : new Uint8Array(16);
  if (resources.length) dirs[2] = [rsrcRva, rsrc.length];

  // Section layout
  const sections: { name: string; rva: number; data: Uint8Array; chars: number }[] = [
    { name: '.text', rva: textRva, data: text.out(), chars: 0x60000020 },
    { name: '.rdata', rva: rdataRva, data: rd.out(), chars: 0x40000040 },
    { name: '.rsrc', rva: rsrcRva, data: rsrc, chars: 0x40000040 },
  ];
  let nextRva = align(rsrcRva + rsrc.length, SECTION_ALIGN);
  for (const s of extra) {
    sections.push({ name: s.name, rva: nextRva, data: s.data, chars: 0xe0000040 });
    nextRva = align(nextRva + s.data.length, SECTION_ALIGN);
  }
  let filePos = sizeOfHeaders;
  const placed = sections.map(s => {
    const raw = align(s.data.length, FILE_ALIGN);
    const p = { ...s, ptr: filePos, rawSize: raw };
    filePos += raw;
    return p;
  });
  const rdataPtr = placed[1]?.ptr ?? 0;
  debugEntries.forEach((e, i) => {
    if (!e.data) return;
    const at = debugDirAt + i * 28;
    const dataRva = rdataRva + (debugDataAt[i] ?? 0);
    const view = new DataView(placed[1]?.data.buffer ?? new ArrayBuffer(0));
    view.setUint32(at + 12, e.type, true);
    view.setUint32(at + 16, e.data.length, true);
    view.setUint32(at + 20, dataRva, true);
    view.setUint32(at + 24, rdataPtr + (debugDataAt[i] ?? 0), true);
  });
  debugEntries.forEach((e, i) => {
    if (e.data) return;
    new DataView(placed[1]?.data.buffer ?? new ArrayBuffer(0)).setUint32(
      debugDirAt + i * 28 + 12,
      e.type,
      true,
    );
  });

  // Headers
  const h = new Buf();
  h.ascii('MZ', false).zeros(0x3a).u32(0x40);
  h.ascii('PE', false).u16(0);
  h.u16(spec.machine ?? (is64 ? 0x8664 : 0x14c))
    .u16(sectionCount)
    .u32(spec.timestamp ?? 1_700_000_000)
    .u32(0)
    .u32(0);
  h.u16(optSize).u16(0x0002 | (spec.dll ? 0x2000 : 0) | (is64 ? 0x20 : 0x100));
  const opt = h.length;
  h.u16(is64 ? 0x20b : 0x10b)
    .u8(14)
    .u8(36);
  h.u32(placed[0]?.rawSize ?? 0)
    .u32(0)
    .u32(0); // code, initialised, uninitialised sizes
  h.u32(spec.dll ? 0 : textRva).u32(textRva);
  if (is64) h.u64(imageBase);
  else h.u32(rdataRva).u32(Number(imageBase));
  h.u32(SECTION_ALIGN).u32(FILE_ALIGN);
  h.u16(6).u16(0).u16(1).u16(0).u16(6).u16(0).u32(0);
  h.u32(nextRva).u32(sizeOfHeaders).u32(0);
  h.u16(spec.subsystem ?? 2);
  h.u16(spec.dllCharacteristics ?? 0x0040 | 0x0100 | 0x4000 | (is64 ? 0x20 : 0));
  if (is64) h.u64(0x100000).u64(0x1000).u64(0x100000).u64(0x1000);
  else h.u32(0x100000).u32(0x1000).u32(0x100000).u32(0x1000);
  h.u32(0).u32(16);
  const dirTable = h.length;
  for (const [a, s] of dirs) h.u32(a).u32(s);
  if (h.length - opt !== optSize) throw new Error(`optional header is ${h.length - opt} bytes`);
  for (const s of placed) {
    h.fixed(s.name, 8)
      .u32(s.data.length)
      .u32(s.rva)
      .u32(s.rawSize)
      .u32(s.ptr)
      .u32(0)
      .u32(0)
      .u16(0)
      .u16(0)
      .u32(s.chars);
  }
  h.zeros(sizeOfHeaders - h.length);
  for (const s of placed) {
    h.raw(s.data);
    h.zeros(s.rawSize - s.data.length);
  }
  if (spec.overlay) h.raw(spec.overlay);
  if (spec.pkcs7) {
    h.align(8);
    const at = h.length;
    const len = 8 + spec.pkcs7.length;
    h.u32(len).u16(0x0200).u16(2).raw(spec.pkcs7).align(8);
    h.set32(dirTable + 4 * 8, at);
    h.set32(dirTable + 4 * 8 + 4, h.length - at);
  }
  return h.out();
}

/** A typical signed-looking GUI app with every resource Clipbox reads. */
export function samplePe(extra: Partial<PeSpec> = {}): Uint8Array<ArrayBuffer> {
  return makePe({
    bits: 64,
    imports: [
      { dll: 'KERNEL32.dll', functions: ['CreateFileW', 'ExitProcess', 'GetLastError'] },
      { dll: 'USER32.dll', functions: ['MessageBoxW', 42] },
      { dll: 'WININET.dll', functions: ['InternetOpenW'], delay: true },
    ],
    version: {
      file: [1, 2, 3, 0],
      strings: {
        CompanyName: 'Example Corp',
        FileDescription: 'Example tool',
        FileVersion: '1.2.3.0',
        InternalName: 'example',
        LegalCopyright: '© 2024 Example Corp',
        OriginalFilename: 'example.exe',
        ProductName: 'Example',
        ProductVersion: '1.2.3',
      },
    },
    icons: [
      { width: 16, height: 16, png: false },
      { width: 48, height: 48, png: true },
    ],
    manifest:
      '<?xml version="1.0" encoding="UTF-8"?><assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0"><trustInfo><security><requestedPrivileges><requestedExecutionLevel level="asInvoker" uiAccess="false"/></requestedPrivileges></security></trustInfo></assembly>',
    pdb: 'C:\\build\\example.pdb',
    overlay: new TextEncoder().encode('OVERLAY-DATA:hello installer payload'),
    ...extra,
  });
}

// ---------------------------------------------------------------------------------------------
// PKCS#7

const derLen = (n: number) =>
  n < 0x80
    ? [n]
    : n < 0x100
      ? [0x81, n]
      : n < 0x10000
        ? [0x82, n >> 8, n & 0xff]
        : [0x83, n >> 16, (n >> 8) & 0xff, n & 0xff];

export function der(tag: number, ...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(1 + derLen(len).length + len);
  out[0] = tag;
  out.set(derLen(len), 1);
  let at = 1 + derLen(len).length;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const oidBytes = (oid: string) => {
  const [a = 0, b = 0, ...rest] = oid.split('.').map(Number);
  const out = [40 * a + b];
  for (const n of rest) {
    const groups = [n & 0x7f];
    for (let v = Math.floor(n / 128); v > 0; v = Math.floor(v / 128))
      groups.unshift((v & 0x7f) | 0x80);
    out.push(...groups);
  }
  return der(0x06, new Uint8Array(out));
};

/** Top-level children of a DER element (enough to find a certificate's issuer and serial). */
function derChildren(b: Uint8Array, at: number): { start: number; body: number; end: number }[] {
  const read = (p: number) => {
    let len = b[p + 1] ?? 0;
    let body = p + 2;
    if (len & 0x80) {
      const n = len & 0x7f;
      len = 0;
      for (let i = 0; i < n; i++) len = len * 256 + (b[body + i] ?? 0);
      body += n;
    }
    return { start: p, body, end: body + len };
  };
  const parent = read(at);
  const out = [];
  for (let p = parent.body; p < parent.end;) {
    const c = read(p);
    out.push(c);
    p = c.end;
  }
  return out;
}

/** SignedData carrying `certs` (DER), signed (nominally) by the first one. */
export function signedData(certs: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const leaf = certs[0] ?? new Uint8Array();
  const tbs = derChildren(leaf, 0)[0];
  const fields = tbs ? derChildren(leaf, tbs.start) : [];
  const off = leaf[fields[0]?.start ?? 0] === 0xa0 ? 1 : 0;
  const serial = fields[off];
  const issuer = fields[off + 2];
  if (!serial || !issuer) throw new Error('bad certificate');
  const sha256 = der(0x30, oidBytes('2.16.840.1.101.3.4.2.1'), der(0x05));
  const signerInfo = der(
    0x30,
    der(0x02, new Uint8Array([1])),
    der(0x30, leaf.slice(issuer.start, issuer.end), leaf.slice(serial.start, serial.end)),
    sha256,
    der(0x30, oidBytes('1.2.840.113549.1.1.1'), der(0x05)),
    der(0x04, new Uint8Array(32)),
  );
  const content = der(
    0x30,
    der(0x02, new Uint8Array([1])),
    der(0x31, sha256),
    der(0x30, oidBytes('1.3.6.1.4.1.311.2.1.4')),
    der(0xa0, ...certs),
    der(0x31, signerInfo),
  );
  return der(0x30, oidBytes('1.2.840.113549.1.7.2'), der(0xa0, content));
}

export function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  const b64 = /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/.exec(pem)?.[1] ?? '';
  return Uint8Array.from(atob(b64.replace(/\s+/g, '')), c => c.charCodeAt(0));
}

// ---------------------------------------------------------------------------------------------
// ELF

export interface ElfSpec {
  bits?: 32 | 64;
  little?: boolean;
  machine?: number;
  /** 2 executable, 3 shared/PIE, 1 relocatable. */
  type?: number;
  interpreter?: string | null;
  needed?: string[];
  soname?: string;
  buildId?: Uint8Array;
  symtab?: boolean;
  exports?: string[];
}

export function makeElf(spec: ElfSpec = {}): Uint8Array<ArrayBuffer> {
  const is64 = (spec.bits ?? 64) === 64;
  const little = spec.little ?? true;
  const b = new Buf(little);
  const word = (v: number) => (is64 ? b.u64(v) : b.u32(v));
  const ehsize = is64 ? 64 : 52;
  const phentsize = is64 ? 56 : 32;
  const shentsize = is64 ? 64 : 40;
  const interp = spec.interpreter === undefined ? '/lib64/ld-linux-x86-64.so.2' : spec.interpreter;
  const phnum = (interp ? 1 : 0) + 4; // LOAD, DYNAMIC, NOTE, GNU_STACK
  const vbase = 0x400000;

  // Header placeholder
  b.zeros(ehsize + phnum * phentsize);

  const interpAt = b.length;
  if (interp) b.ascii(interp);
  b.align(4);
  const noteAt = b.length;
  const id = spec.buildId ?? new Uint8Array([0xde, 0xad, 0xbe, 0xef, 1, 2, 3, 4]);
  b.u32(4).u32(id.length).u32(3).ascii('GNU').raw(id).align(4);
  const noteEnd = b.length;
  const textAt = b.length;
  for (let i = 0; i < 64; i++) b.u8(0x90);
  // .dynstr
  const dynstrAt = b.length;
  b.u8(0);
  const strOff = new Map<string, number>();
  const addStr = (s: string) => {
    strOff.set(s, b.length - dynstrAt);
    b.ascii(s);
  };
  for (const n of spec.needed ?? []) addStr(n);
  if (spec.soname) addStr(spec.soname);
  for (const e of spec.exports ?? []) addStr(e);
  const dynstrEnd = b.length;
  b.align(8);
  // .dynsym
  const symSize = is64 ? 24 : 16;
  const dynsymAt = b.length;
  b.zeros(symSize);
  for (const e of spec.exports ?? []) {
    if (is64)
      b.u32(strOff.get(e) ?? 0)
        .u8(0x12)
        .u8(0)
        .u16(3)
        .u64(vbase + textAt)
        .u64(16);
    else
      b.u32(strOff.get(e) ?? 0)
        .u32(vbase + textAt)
        .u32(16)
        .u8(0x12)
        .u8(0)
        .u16(3);
  }
  const dynsymEnd = b.length;
  b.align(8);
  // .dynamic
  const dynamicAt = b.length;
  for (const n of spec.needed ?? []) {
    word(1);
    word(strOff.get(n) ?? 0);
  }
  if (spec.soname) {
    word(14);
    word(strOff.get(spec.soname) ?? 0);
  }
  word(5);
  word(vbase + dynstrAt);
  word(0);
  word(0);
  const dynamicEnd = b.length;
  // .symtab / .strtab
  let symtabAt = 0;
  let strtabAt = 0;
  if (spec.symtab) {
    strtabAt = b.length;
    b.u8(0).ascii('main');
    b.align(8);
    symtabAt = b.length;
    b.zeros(symSize * 2);
  }
  const symtabEnd = b.length;
  // .shstrtab
  const shstrAt = b.length;
  const names = [
    '',
    '.interp',
    '.note.gnu.build-id',
    '.text',
    '.dynstr',
    '.dynsym',
    '.dynamic',
    '.symtab',
    '.strtab',
    '.shstrtab',
  ];
  const nameOff = new Map<string, number>();
  for (const n of names) {
    nameOff.set(n, b.length - shstrAt);
    b.ascii(n);
  }
  const shstrEnd = b.length;
  b.align(8);
  const shoff = b.length;
  const sections: {
    name: string;
    type: number;
    flags: number;
    offset: number;
    size: number;
    link: number;
    entsize: number;
  }[] = [{ name: '', type: 0, flags: 0, offset: 0, size: 0, link: 0, entsize: 0 }];
  if (interp)
    sections.push({
      name: '.interp',
      type: 1,
      flags: 2,
      offset: interpAt,
      size: interp.length + 1,
      link: 0,
      entsize: 0,
    });
  sections.push({
    name: '.note.gnu.build-id',
    type: 7,
    flags: 2,
    offset: noteAt,
    size: noteEnd - noteAt,
    link: 0,
    entsize: 0,
  });
  sections.push({
    name: '.text',
    type: 1,
    flags: 6,
    offset: textAt,
    size: 64,
    link: 0,
    entsize: 0,
  });
  const dynstrIndex = sections.length;
  sections.push({
    name: '.dynstr',
    type: 3,
    flags: 2,
    offset: dynstrAt,
    size: dynstrEnd - dynstrAt,
    link: 0,
    entsize: 0,
  });
  sections.push({
    name: '.dynsym',
    type: 11,
    flags: 2,
    offset: dynsymAt,
    size: dynsymEnd - dynsymAt,
    link: dynstrIndex,
    entsize: symSize,
  });
  sections.push({
    name: '.dynamic',
    type: 6,
    flags: 3,
    offset: dynamicAt,
    size: dynamicEnd - dynamicAt,
    link: dynstrIndex,
    entsize: is64 ? 16 : 8,
  });
  if (spec.symtab) {
    sections.push({
      name: '.symtab',
      type: 2,
      flags: 0,
      offset: symtabAt,
      size: symtabEnd - symtabAt,
      link: sections.length + 1,
      entsize: symSize,
    });
    sections.push({
      name: '.strtab',
      type: 3,
      flags: 0,
      offset: strtabAt,
      size: 6,
      link: 0,
      entsize: 0,
    });
  }
  const shstrndx = sections.length;
  sections.push({
    name: '.shstrtab',
    type: 3,
    flags: 0,
    offset: shstrAt,
    size: shstrEnd - shstrAt,
    link: 0,
    entsize: 0,
  });
  for (const s of sections) {
    b.u32(nameOff.get(s.name) ?? 0).u32(s.type);
    word(s.flags);
    word(s.flags & 2 ? vbase + s.offset : 0);
    word(s.offset);
    word(s.size);
    b.u32(s.link).u32(0);
    word(1);
    word(s.entsize);
  }
  const fileEnd = b.length;

  // ELF header
  const h = new Buf(little);
  h.raw([0x7f, 0x45, 0x4c, 0x46, is64 ? 2 : 1, little ? 1 : 2, 1, 0]).zeros(8);
  h.u16(spec.type ?? 3)
    .u16(spec.machine ?? 62)
    .u32(1);
  const hw = (v: number) => (is64 ? h.u64(v) : h.u32(v));
  hw(vbase + textAt);
  hw(ehsize);
  hw(shoff);
  h.u32(0).u16(ehsize).u16(phentsize).u16(phnum).u16(shentsize).u16(sections.length).u16(shstrndx);
  // Program headers
  const ph = (type: number, flags: number, offset: number, size: number) => {
    if (is64)
      h.u32(type)
        .u32(flags)
        .u64(offset)
        .u64(vbase + offset)
        .u64(vbase + offset)
        .u64(size)
        .u64(size)
        .u64(8);
    else
      h.u32(type)
        .u32(offset)
        .u32(vbase + offset)
        .u32(vbase + offset)
        .u32(size)
        .u32(size)
        .u32(flags)
        .u32(4);
  };
  if (interp) ph(3, 4, interpAt, interp.length + 1);
  ph(1, 5, 0, fileEnd);
  ph(2, 6, dynamicAt, dynamicEnd - dynamicAt);
  ph(4, 4, noteAt, noteEnd - noteAt);
  ph(0x6474e551, 6, 0, 0);
  const out = b.out();
  out.set(h.out(), 0);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Mach-O

export interface MachoSpec {
  cpu?: 'x86_64' | 'arm64';
  /** 2 executable, 6 dylib. */
  fileType?: number;
  dylibs?: string[];
  weakDylibs?: string[];
  /** [major, minor]. */
  minOs?: [number, number];
  sdk?: [number, number];
  identifier?: string;
  encrypted?: boolean;
}

export function makeMacho(spec: MachoSpec = {}): Uint8Array<ArrayBuffer> {
  const cmds = new Buf();
  let ncmds = 0;
  const cmd = (id: number, body: Buf, strings?: string) => {
    const head = 8 + body.length;
    const tail = strings === undefined ? new Uint8Array() : new Buf().ascii(strings).out();
    const size = align(head + tail.length, 8);
    cmds
      .u32(id)
      .u32(size)
      .raw(body.out())
      .raw(tail)
      .zeros(size - head - tail.length);
    ncmds++;
  };
  // __TEXT segment with one __text section; its data offset is patched below
  const segAt = cmds.length;
  const seg = new Buf()
    .fixed('__TEXT', 16)
    .u64(0x100000000)
    .u64(0x4000)
    .u64(0)
    .u64(0)
    .u32(5)
    .u32(5)
    .u32(1)
    .u32(0);
  seg
    .fixed('__text', 16)
    .fixed('__TEXT', 16)
    .u64(0x100000000 + 0x1000)
    .u64(64)
    .u32(0)
    .u32(4)
    .u32(0)
    .u32(0)
    .u32(0x80000400)
    .u32(0)
    .u32(0)
    .u32(0);
  cmd(0x19, seg);
  const ver = (v: [number, number]) => (v[0] << 16) | (v[1] << 8);
  cmd(
    0x32,
    new Buf()
      .u32(1)
      .u32(ver(spec.minOs ?? [11, 0]))
      .u32(ver(spec.sdk ?? [14, 2]))
      .u32(0),
  );
  for (const d of spec.dylibs ?? ['/usr/lib/libSystem.B.dylib']) {
    cmd(0xc, new Buf().u32(24).u32(2).u32(0x05200000).u32(0x10000), d);
  }
  for (const d of spec.weakDylibs ?? []) {
    cmd(0x80000018, new Buf().u32(24).u32(2).u32(0x10000).u32(0x10000), d);
  }
  cmd(
    0x1b,
    new Buf().raw([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0, 1, 2, 3, 4, 5, 6, 7, 8]),
  );
  cmd(0x80000028, new Buf().u64(0x1000).u64(0));
  if (spec.encrypted !== undefined) {
    cmd(
      0x2c,
      new Buf()
        .u32(0x1000)
        .u32(64)
        .u32(spec.encrypted ? 1 : 0)
        .u32(0),
    );
  }
  const sigCmdAt = spec.identifier ? cmds.length : -1;
  if (spec.identifier) cmd(0x1d, new Buf().u32(0).u32(0));

  const header = 32;
  const textOff = align(header + cmds.length, 16);
  const sigOff = textOff + 64;
  // Patch section and segment file offsets
  cmds.set64(segAt + 48, sigOff); // filesize
  cmds.set32(segAt + 72 + 48, textOff);

  let sig = new Uint8Array();
  if (spec.identifier) {
    const be = new Buf(false);
    const cdAt = 12 + 8;
    // SuperBlob with one CodeDirectory (ad-hoc)
    be.u32(0xfade0cc0).u32(0).u32(1).u32(0).u32(cdAt);
    const ident = new Buf(false).ascii(spec.identifier).out();
    const cdLen = 44 + ident.length;
    be.u32(0xfade0c02)
      .u32(cdLen)
      .u32(0x20400)
      .u32(0x2)
      .u32(0)
      .u32(44)
      .u32(0)
      .u32(0)
      .u32(0)
      .u32(0)
      .u32(0);
    be.raw(ident);
    be.set32(4, be.length);
    sig = be.out();
    cmds.set32(sigCmdAt + 8, sigOff);
    cmds.set32(sigCmdAt + 12, sig.length);
  }

  const out = new Buf();
  out
    .u32(0xfeedfacf)
    .u32(spec.cpu === 'x86_64' ? 0x01000007 : 0x0100000c)
    .u32(spec.cpu === 'x86_64' ? 3 : 0);
  out
    .u32(spec.fileType ?? 2)
    .u32(ncmds)
    .u32(cmds.length)
    .u32(0x200085)
    .u32(0);
  out.raw(cmds.out());
  out.zeros(textOff - out.length);
  for (let i = 0; i < 64; i++) out.u8(i % 7);
  out.raw(sig);
  return out.out();
}

/** A universal binary of the given thin slices. */
export function makeFat(
  slices: { cpu: 'x86_64' | 'arm64'; bytes: Uint8Array }[],
): Uint8Array<ArrayBuffer> {
  const b = new Buf(false);
  b.u32(0xcafebabe).u32(slices.length);
  let offset = align(8 + slices.length * 20, 0x1000);
  const offsets: number[] = [];
  for (const s of slices) {
    offsets.push(offset);
    b.u32(s.cpu === 'x86_64' ? 0x01000007 : 0x0100000c)
      .u32(s.cpu === 'x86_64' ? 3 : 0)
      .u32(offset)
      .u32(s.bytes.length)
      .u32(12);
    offset = align(offset + s.bytes.length, 0x1000);
  }
  slices.forEach((s, i) => {
    b.zeros((offsets[i] ?? 0) - b.length);
    b.raw(s.bytes);
  });
  return b.out();
}

/** The start of a Java class file: CAFEBABE, minor 0, major 52 (Java 8). */
export function javaClassHeader(): Uint8Array<ArrayBuffer> {
  const b = new Buf(false);
  b.u32(0xcafebabe).u16(0).u16(52).u16(10);
  b.zeros(64);
  return b.out();
}
