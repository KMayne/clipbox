import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { gzipSync, strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { isTar, readTar } from '../../src/core/archive/tar';
import {
  checkGuard,
  ExtractionGuardError,
  FORCE_PREFIX,
  MAX_ENTRY_BYTES,
} from '../../src/core/archive/types';
import { register } from '../../src/core/interpreter';
import { detectKinds } from '../../src/core/interpreters';
import { archiveCoreInterpreter } from '../../src/core/interpreters/archive';
import { Engine } from '../../src/engine/engine';
import { libarchiveDetector } from '../../src/modules/libarchive/detect';
import { createLibarchiveInterpreter } from '../../src/modules/libarchive/interpreter';
import { createLibarchive, type Libarchive } from '../../src/modules/libarchive/reader';
import { bytesContent, textContent } from './helpers';

const archive = register(archiveCoreInterpreter);
const td = new TextDecoder();
const u8 = (b: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(b);

/** Minimal ustar writer for fixtures. */
function tar(files: { path: string; data?: string; dir?: boolean; mtime?: number }[]) {
  const blocks: Uint8Array[] = [];
  for (const f of files) {
    const data = strToU8(f.data ?? '');
    const h = new Uint8Array(512);
    const put = (s: string, at: number) => h.set(strToU8(s), at);
    const octal = (n: number, len: number) => n.toString(8).padStart(len - 1, '0');
    put(f.path, 0);
    put(octal(0o644, 8), 100);
    put(octal(0, 8), 108);
    put(octal(0, 8), 116);
    put(octal(f.dir ? 0 : data.length, 12), 124);
    put(octal(f.mtime ?? 1_700_000_000, 12), 136);
    put('        ', 148);
    h[156] = (f.dir ? '5' : '0').charCodeAt(0);
    put('ustar\u000000', 257);
    const sum = h.reduce((a, b) => a + b, 0);
    put(`${sum.toString(8).padStart(6, '0')}\u0000 `, 148);
    blocks.push(h);
    if (!f.dir) {
      const padded = new Uint8Array(Math.ceil(data.length / 512) * 512);
      padded.set(data);
      blocks.push(padded);
    }
  }
  blocks.push(new Uint8Array(1024));
  const out = new Uint8Array(blocks.reduce((n, b) => n + b.length, 0));
  let at = 0;
  for (const b of blocks) {
    out.set(b, at);
    at += b.length;
  }
  return out;
}

const sampleZip = () =>
  u8(
    zipSync({
      'data.json': strToU8('{"a":1,"b":[1,2]}'),
      'docs/notes.txt': [strToU8('hello notes'), { level: 0 }],
      'docs/': new Uint8Array(0),
      'big.txt': strToU8('x'.repeat(10_000)),
    }),
  );

describe('archive detection', () => {
  it('recognises zip, gzip and tar at 0.8', () => {
    expect(archive.detect(bytesContent(sampleZip()))).toBe(0.8);
    expect(archive.detect(bytesContent(u8(gzipSync(strToU8('hi')))))).toBe(0.8);
    expect(archive.detect(bytesContent(u8(tar([{ path: 'a.txt', data: 'a' }]))))).toBe(0.8);
  });

  it('ranks office documents lower', () => {
    const docx = u8(
      zipSync({ '[Content_Types].xml': strToU8('<Types/>'), 'word/document.xml': strToU8('<w/>') }),
    );
    expect(archive.detect(bytesContent(docx))).toBe(0.5);
  });

  it('rejects look-alikes', () => {
    expect(archive.detect(textContent('PK is not a zip'))).toBe(0);
    expect(archive.detect(bytesContent([0x50, 0x4b, 3, 4, 0, 0, 0, 0]))).toBe(0); // no central directory
    expect(
      archive.detect(bytesContent([0x1f, 0x8b, 9, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])),
    ).toBe(0);
    const badTar = tar([{ path: 'a.txt', data: 'a' }]);
    badTar[0] = 0x62; // checksum no longer matches
    expect(archive.detect(bytesContent(u8(badTar)))).toBe(0);
    expect(archive.detect(textContent('{"ustar": true}'))).toBe(0);
    expect(detectKinds(textContent('hello world')).map(k => k.kind)).not.toContain('archive');
  });

  it('libarchive detector matches its signatures only', () => {
    const d = (b: number[] | Uint8Array<ArrayBuffer>) => libarchiveDetector.detect(bytesContent(b));
    expect(d([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 4])).toBe(0.8);
    expect(d([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0])).toBe(0.8);
    expect(d([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])).toBe(0.8);
    expect(d([0x28, 0xb5, 0x2f, 0xfd, 0])).toBe(0.8);
    expect(d([0x42, 0x5a, 0x68, 0x39, 0x31, 0x41, 0x59, 0x26, 0x53, 0x59])).toBe(0.8);
    expect(libarchiveDetector.detect(textContent('BZh9 is a word'))).toBe(0);
    expect(libarchiveDetector.detect(textContent('Rar! said the lion'))).toBe(0);
    expect(d(sampleZip())).toBe(0);
  });
});

describe('zip', () => {
  it('lists entries from the central directory', async () => {
    const v = await archive.parse(bytesContent(sampleZip()), { service: async () => null });
    expect(archive.label(v)).toBe('ZIP · 3 files · 9.8 KB');
    const rows = await archive.slice(v, { type: 'rows', from: 0, to: 10 });
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'data.json', size: 17, isDir: false }),
        expect.objectContaining({ path: 'docs/notes.txt', size: 11, compressedSize: 11 }),
        expect.objectContaining({ path: 'docs/', isDir: true }),
      ]),
    );
    const s = await archive.summarise(v);
    const stat = (l: string) => s.stats.find(r => r.label === l);
    expect(stat('Files')?.value).toBe('3');
    expect(stat('Directories')?.value).toBe('1');
    expect(stat('Largest files')?.children?.[0]).toEqual({ label: 'big.txt', value: '9.8 KB' });
    expect(stat('File types')?.children).toEqual([
      { label: '.txt', value: '2 files · 9.8 KB' },
      { label: '.json', value: '1 file · 17 B' },
    ]);
    expect(archive.derivations(v).map(d => d.id)).toEqual([
      'data.json',
      'docs/notes.txt',
      'big.txt',
    ]);
  });

  it('extracts deflated and stored entries', async () => {
    const v = await archive.parse(bytesContent(sampleZip()), { service: async () => null });
    const json = await archive.derive(v, 'data.json');
    expect(json).toMatchObject({ mime: 'application/json', name: 'data.json' });
    expect(td.decode(json.bytes)).toBe('{"a":1,"b":[1,2]}');
    expect(td.decode((await archive.derive(v, 'docs/notes.txt')).bytes)).toBe('hello notes');
    expect(td.decode((await archive.derive(v, 'big.txt')).bytes)).toHaveLength(10_000);
    await expect(archive.derive(v, 'docs/')).rejects.toThrow(/no 'docs\/' derivation/);
  });

  it('opens entries beyond the "Open as" list', async () => {
    const files = Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [`f${i}.txt`, strToU8(`file ${i}`)]),
    );
    const v = await archive.parse(bytesContent(u8(zipSync(files))), { service: async () => null });
    expect(archive.derivations(v)).toHaveLength(20);
    expect(td.decode((await archive.derive(v, 'f29.txt')).bytes)).toBe('file 29');
  });
});

describe('zip bomb guard', () => {
  it('blocks oversized or over-compressed entries unless forced', () => {
    const big = {
      path: 'big',
      size: MAX_ENTRY_BYTES + 1,
      compressedSize: MAX_ENTRY_BYTES,
      isDir: false,
    };
    const dense = { path: 'dense', size: 2_000_000, compressedSize: 1000, isDir: false };
    expect(() => checkGuard(big, false)).toThrow(ExtractionGuardError);
    expect(() => checkGuard(dense, false)).toThrow(/2000:1 compression ratio/);
    expect(() => checkGuard(dense, true)).not.toThrow();
    expect(() => checkGuard({ ...dense, compressedSize: 10_000 }, false)).not.toThrow();
  });

  it('refuses a highly compressed zip entry, then extracts it when forced', async () => {
    const zeros = new Uint8Array(5_000_000);
    const v = await archive.parse(bytesContent(u8(zipSync({ 'zeros.bin': zeros }, { level: 9 }))), {
      service: async () => null,
    });
    await expect(archive.derive(v, 'zeros.bin')).rejects.toThrow(/Extraction blocked:.*ratio/);
    const forced = await archive.derive(v, `${FORCE_PREFIX}zeros.bin`);
    expect(forced.bytes.byteLength).toBe(5_000_000);
  });

  it('stops decompressing when the output passes the cap, even if headers lie', async () => {
    const zeros = new Uint8Array(5_000_000);
    const zip = u8(zipSync({ 'z.bin': zeros }, { level: 9 }));
    // Lie in the central directory: claim 5000 bytes uncompressed
    const dv = new DataView(zip.buffer);
    let cd = zip.length - 22;
    cd = dv.getUint32(cd + 16, true);
    dv.setUint32(cd + 24, 5000, true);
    const v = await archive.parse(bytesContent(zip), { service: async () => null });
    await expect(archive.derive(v, 'z.bin')).rejects.toThrow(/decompresses to more than/);
  });

  it('does not decompress a gzip bomb up front', async () => {
    const gz = u8(gzipSync(new Uint8Array(20_000_000), { level: 9 }));
    const v = await archive.parse(bytesContent(gz), { service: async () => null });
    expect(archive.label(v)).toBe('GZIP · 1 file · 19 MB');
    expect((await archive.summarise(v)).stats.find(s => s.label === 'Note')?.value).toMatch(
      /Too large/,
    );
    await expect(archive.derive(v, 'data')).rejects.toThrow(/Extraction blocked/);
    expect((await archive.derive(v, `${FORCE_PREFIX}data`)).bytes.byteLength).toBe(20_000_000);
  });
});

describe('tar reader', () => {
  it('reads files, directories, prefixes and mtimes', () => {
    const t = tar([
      { path: './', dir: true },
      { path: './dir', dir: true },
      { path: './dir/a.txt', data: 'alpha', mtime: 0 },
      { path: 'b.json', data: '[1]' },
    ]);
    expect(isTar(t)).toBe(true);
    const entries = readTar(t);
    expect(entries.map(e => [e.path, e.size, e.isDir])).toEqual([
      ['dir/', 0, true],
      ['dir/a.txt', 5, false],
      ['b.json', 3, false],
    ]);
    expect(entries[2]?.modified).toBe('2023-11-14T22:13:20Z');
    expect(entries[1]?.modified).toBeUndefined();
    const b = entries[2];
    expect(td.decode(t.subarray(b?.offset, (b?.offset ?? 0) + 3))).toBe('[1]');
  });

  it('honours GNU long names and pax paths', () => {
    const long = 'x'.repeat(150) + '.txt';
    const t = tar([
      { path: '././@LongLink', data: long + '\u0000' },
      { path: 'short', data: 'L' },
      { path: 'PaxHeader', data: '21 path=from-pax.txt\n' },
      { path: 'ignored', data: 'P' },
    ]);
    // Patch the type flags: 'L' for the long name, 'x' for the pax header
    const fix = (at: number, flag: string) => {
      t[at + 156] = flag.charCodeAt(0);
      t.fill(0x20, at + 148, at + 156);
      const sum = t.subarray(at, at + 512).reduce((a, b) => a + b, 0);
      t.set(strToU8(`${sum.toString(8).padStart(6, '0')}\u0000 `), at + 148);
    };
    fix(0, 'L');
    fix(2048, 'x');
    expect(readTar(t).map(e => e.path)).toEqual([long, 'from-pax.txt']);
  });
});

describe('gzip and tgz', () => {
  it('lists a single gzip member under its original name', async () => {
    const gz = u8(gzipSync(strToU8('{"x":1}'), { filename: 'x.json', mtime: 1_700_000_000_000 }));
    const v = await archive.parse(bytesContent(gz), { service: async () => null });
    expect(archive.label(v)).toBe('GZIP · 1 file · 7 B');
    const [row] = await archive
      .slice(v, { type: 'rows', from: 0, to: 1 })
      .then(r => (Array.isArray(r) ? r : []));
    expect(row).toMatchObject({ path: 'x.json', size: 7, modified: '2023-11-14T22:13:20Z' });
    expect(td.decode((await archive.derive(v, 'x.json')).bytes)).toBe('{"x":1}');
  });

  it('falls back to the capture name without .gz', async () => {
    const v = await archive.parse(bytesContent(u8(gzipSync(strToU8('a,b\n1,2')))), {
      service: async () => null,
    });
    expect(archive.derivations(v)).toEqual([{ id: 'data', label: 'data' }]);
  });

  it('lists the tar inside a .tar.gz', async () => {
    const tgz = u8(
      gzipSync(
        tar([
          { path: 'a.txt', data: 'alpha' },
          { path: 'b/c.json', data: '{}' },
        ]),
      ),
    );
    const v = await archive.parse(bytesContent(tgz), { service: async () => null });
    expect(archive.label(v)).toBe('TAR.GZ · 2 files · 7 B');
    expect(td.decode((await archive.derive(v, 'b/c.json')).bytes)).toBe('{}');
  });
});

describe('archive derive through the engine', () => {
  it('opens a zip entry as a new capture detected as JSON', async () => {
    const engine = new Engine({ loaders: {} });
    engine.setPolicies({ langdetect: 'off', libarchive: 'off' });
    const zip = u8(
      zipSync({ 'data.json': strToU8('{"hello":"world"}'), 'notes.txt': strToU8('hi') }),
    );
    const blob = new Blob([zip], { type: 'application/zip' });
    const res = await engine.ingest({
      id: 'en-z',
      mime: 'application/zip',
      size: blob.size,
      blob,
      name: 'a.zip',
    });
    expect(res.interpretations[0]).toMatchObject({
      kind: 'archive',
      label: 'ZIP · 2 files · 19 B',
    });
    const derived = await engine.derive('en-z', 'archive', 'data.json');
    expect(derived.mime).toBe('application/json');
    const dblob = new Blob([derived.bytes], { type: derived.mime });
    const out = await engine.ingest({
      id: 'en-d',
      mime: derived.mime,
      size: dblob.size,
      blob: dblob,
      name: derived.name,
    });
    expect(out.interpretations[0]?.kind).toBe('json');
  });
});

describe('libarchive module', () => {
  const require = createRequire(import.meta.url);
  const wasm = readFileSync(
    require.resolve('libarchive.js/src/webworker/wasm-gen/libarchive.wasm'),
  );
  let lib: Promise<Libarchive> | null = null;
  const load = () => (lib ??= createLibarchive(wasm));
  const la = register(createLibarchiveInterpreter(load));
  const fixture = (name: string) =>
    bytesContent(u8(readFileSync(new URL(`../fixtures/archives/${name}`, import.meta.url))));
  const ctx = { service: async () => null };

  it('lists and extracts a tar.xz', async () => {
    const v = await la.parse(fixture('sample.tar.xz'), ctx);
    expect(la.label(v)).toBe('TAR.XZ · 2 files · 14 B');
    const rows = await la.slice(v, { type: 'rows', from: 0, to: 10 });
    expect(rows).toEqual([
      expect.objectContaining({ path: 'data.json', size: 8 }),
      expect.objectContaining({ path: 'notes.txt', size: 6 }),
    ]);
    expect(td.decode((await la.derive(v, 'data.json')).bytes)).toBe('{"a":1}\n');
  });

  it('lists a tar.bz2', async () => {
    const v = await la.parse(fixture('sample.tar.bz2'), ctx);
    expect(la.label(v)).toBe('TAR.BZ2 · 2 files · 14 B');
    expect(td.decode((await la.derive(v, 'notes.txt')).bytes)).toBe('hello\n');
  });

  it('decodes zstd and tar.zst with fzstd', async () => {
    const tzst = await la.parse(fixture('sample.tar.zst'), ctx);
    expect(la.label(tzst)).toBe('TAR.ZST · 2 files · 14 B');
    const zst = await la.parse({ ...fixture('data.json.zst'), name: 'data.json.zst' }, ctx);
    expect(la.label(zst)).toBe('ZSTD · 1 file · 8 B');
    expect(td.decode((await la.derive(zst, 'data.json')).bytes)).toBe('{"a":1}\n');
  });

  it('marks single-file xz as unsupported instead of failing', async () => {
    const v = await la.parse(fixture('data.json.xz'), ctx);
    expect(la.label(v)).toBe('XZ · unsupported');
  });
});
