import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { gunzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { archiveStats } from '../../src/core/archive/interpreter';
import { register } from '../../src/core/interpreter';
import { archiveCoreInterpreter } from '../../src/core/interpreters/archive';
import { libarchiveDetector } from '../../src/modules/libarchive/detect';
import { sevenzipDetector, sniffDisc } from '../../src/modules/sevenzip/detect';
import { createSevenZipInterpreter } from '../../src/modules/sevenzip/interpreter';
import { parseSlt, udfVolumeLabel } from '../../src/modules/sevenzip/listing';
import { createSevenZip, type SevenZip } from '../../src/modules/sevenzip/reader';
import { readIsoVolume } from '../../src/modules/sevenzip/volume';
import { bytesContent, textContent } from './helpers';

const SECTOR = 2048;
const td = new TextDecoder();

/** The gzipped fixtures from tests/fixtures/iso/make.py. */
const fixture = (name: string) =>
  new Uint8Array(
    gunzipSync(new Uint8Array(readFileSync(new URL(`../fixtures/iso/${name}`, import.meta.url)))),
  );

/** A blank image with the given standard identifiers in sectors 16, 17, … */
function image(ids: string[], at = 16, sectors = 40): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(sectors * SECTOR);
  ids.forEach((id, i) => {
    const o = (at + i) * SECTOR;
    b[o] = id === 'CD001' && i === 0 ? 1 : 0;
    b.set(
      [...id].map(c => c.charCodeAt(0)),
      o + 1,
    );
    b[o + 6] = 1;
  });
  return b;
}

/** An MBR in the system area, as isohybrid writes for USB booting. */
function withMbr(b: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const out = b.slice();
  out.set([0x33, 0xed, 0xfa, 0x8e, 0xd5, 0xbc, 0x00, 0x7c], 0);
  out[446] = 0x80; // bootable partition entry
  out[450] = 0x17;
  out[510] = 0x55;
  out[511] = 0xaa;
  return out;
}

const archive = register(archiveCoreInterpreter);

describe('disc image detection', () => {
  it.each([
    ['the ISO 9660 + Joliet fixture', fixture('iso9660.iso.gz'), { iso9660: true, udf: false }],
    ['the UDF-only fixture', fixture('udf.iso.gz'), { iso9660: false, udf: true }],
    [
      'a hybrid (MBR + ISO 9660)',
      withMbr(fixture('iso9660.iso.gz')),
      { iso9660: true, udf: false },
    ],
    ['a hybrid (MBR + UDF)', withMbr(fixture('udf.iso.gz')), { iso9660: false, udf: true }],
    [
      'a UDF bridge',
      image(['CD001', 'CD001', 'BEA01', 'NSR02', 'TEA01']),
      { iso9660: true, udf: true },
    ],
    ['UDF NSR03', image(['BEA01', 'NSR03', 'TEA01']), { iso9660: false, udf: true }],
    ['CD001 at 0x8801', image(['CD001'], 17), { iso9660: true, udf: false }],
    ['CD001 at 0x9001', image(['CD001'], 18), { iso9660: true, udf: false }],
  ])('accepts %s', (_, bytes, found) => {
    expect(sniffDisc(bytes)).toEqual(found);
    const c = bytesContent(bytes);
    expect(sevenzipDetector.detect(c)).toBe(0.8);
    // …and no other archive detector claims it, so there's one `archive` candidate
    expect(archive.detect(c)).toBe(0);
    expect(libarchiveDetector.detect(c)).toBe(0);
  });

  it.each([
    ['a blank image', image([])],
    ['too short for a descriptor', fixture('iso9660.iso.gz').slice(0, 16 * SECTOR + 100)],
    [
      'CD001 off by one',
      (() => {
        const b = image([]);
        b.set([0x43, 0x44, 0x30, 0x30, 0x31], 16 * SECTOR + 2);
        return b;
      })(),
    ],
    ['CD001 past sector 18', image(['CD001'], 19)],
    ['BEA01 without NSR', image(['BEA01', 'TEA01'])],
    ['NSR02 without BEA01', image(['NSR02', 'TEA01'])],
    ['NSR02 after the sequence ended', image(['BEA01', 'TEA01', 'NSR02'])],
    ['text', textContent('CD001 '.repeat(10_000)).bytes],
  ])('rejects %s', (_, bytes) => {
    expect(sniffDisc(bytes)).toBeNull();
    expect(sevenzipDetector.detect(bytesContent(bytes))).toBe(0);
  });
});

describe('ISO 9660 volume descriptors', () => {
  it('reads the Joliet volume label', () => {
    expect(readIsoVolume(fixture('iso9660.iso.gz'))).toEqual({
      label: 'CLIPBOX_DISC',
      joliet: true,
    });
  });

  it('falls back to the primary volume label', () => {
    const b = image(['CD001', 'CD001']);
    b.set(
      [...'MY_DISC   '].map(c => c.charCodeAt(0)),
      16 * SECTOR + 40,
    );
    b[17 * SECTOR] = 255; // terminator
    expect(readIsoVolume(b)).toEqual({ label: 'MY_DISC', joliet: false });
  });

  it('prefers a mixed-case Joliet label', () => {
    const b = image(['CD001', 'CD001', 'CD001']);
    b.set(
      [...'UBUNTU'].map(c => c.charCodeAt(0)),
      16 * SECTOR + 40,
    );
    const svd = 17 * SECTOR;
    b[svd] = 2;
    b.set([0x25, 0x2f, 0x45], svd + 88);
    [...'Ubuntu 24.04'].forEach((ch, i) => (b[svd + 40 + i * 2 + 1] = ch.charCodeAt(0)));
    b[18 * SECTOR] = 255;
    expect(readIsoVolume(b)).toEqual({ label: 'Ubuntu 24.04', joliet: true });
  });
});

const UDF_LISTING = `
7-Zip (z) 24.09 (LE) : Copyright (c) 1999-2024 Igor Pavlov : 2024-11-29
 32-bit ILP32 locale=en_US.UTF-8 Threads:1 OPEN_MAX:1024

Scanning the drive for archives:
1 file, 559104 bytes (546 KiB)

Listing archive: /in/disc.img

--
Path = /in/disc.img
Type = Udf
Physical Size = 559104
Version = 2.01
Comment =
{
Primary Volumes:
  PrimaryVolumeDescriptorNumber: 0
  VolumeId: PRIMARY_ID
Partitions:
  PartitionIndex: 0
  ImplementationId: *pycdlib
Logical Volumes:
  Id: Ubuntu 24.04 LTS amd64
  BlockSize: 2048
  File Sets:
    Id: FILESET
}

----------
Path = casper
Folder = +
Size =
Packed Size =
Modified = 2024-04-24 12:00:00.000000

Path = casper/vmlinuz
Folder = -
Size = 14928264
Packed Size = 14929920
Modified = 2024-04-24 12:00:01.000000

Path = a = b.txt
Folder = -
Size = 3
Packed Size = 2048
Modified =
`.split('\n');

describe("7-Zip's -slt listing", () => {
  it('parses the archive properties and items', () => {
    const listing = parseSlt(UDF_LISTING);
    expect(listing.archive).toMatchObject({
      Type: 'Udf',
      Version: '2.01',
      'Physical Size': '559104',
    });
    expect(listing.items).toEqual([
      { path: 'casper', isDir: true, size: 0, modified: '2024-04-24T12:00:00' },
      {
        path: 'casper/vmlinuz',
        isDir: false,
        size: 14928264,
        packedSize: 14929920,
        modified: '2024-04-24T12:00:01',
      },
      { path: 'a = b.txt', isDir: false, size: 3, packedSize: 2048 },
    ]);
    expect(udfVolumeLabel(listing.comment)).toBe('Ubuntu 24.04 LTS amd64');
  });

  it('falls back to the primary VolumeId and to Attributes', () => {
    expect(
      udfVolumeLabel(['Primary Volumes:', '  VolumeId: DISC', 'Logical Volumes:', '  Id: ']),
    ).toBe('DISC');
    const listing = parseSlt([
      '--',
      'Type = Iso',
      '----------',
      'Path = DIR',
      'Attributes = D',
      '',
      'Path = FILE.TXT',
      'Size = 5',
      'Attributes = A',
    ]);
    expect(listing.items.map(i => [i.path, i.isDir, i.size])).toEqual([
      ['DIR', true, 0],
      ['FILE.TXT', false, 5],
    ]);
  });

  it('ignores the banner and an empty listing', () => {
    expect(parseSlt(['7-Zip banner', 'Path = nope'])).toEqual({
      archive: {},
      comment: [],
      items: [],
    });
  });
});

describe('sevenzip module (7z-wasm)', () => {
  const require = createRequire(import.meta.url);
  const wasm = readFileSync(require.resolve('7z-wasm/7zz.wasm'));
  let lib: Promise<SevenZip> | null = null;
  const load = () => (lib ??= createSevenZip(wasm));
  const typed = createSevenZipInterpreter(load);
  const sz = register(typed);
  const ctx = { service: async () => null };
  const parse = async (bytes: Uint8Array<ArrayBuffer>) => {
    const v = await sz.parse(bytesContent(bytes), ctx);
    if (!typed.isValue(v)) throw new Error('Not an archive value');
    return v;
  };

  it('lists and extracts an ISO 9660 image, with its Joliet names and volume label', async () => {
    const v = await parse(fixture('iso9660.iso.gz'));
    expect(sz.label(v)).toBe('ISO 9660 · CLIPBOX_DISC · 2 files · 61 B');
    expect(await sz.slice(v, { type: 'rows', from: 0, to: 10 })).toEqual([
      expect.objectContaining({ path: 'docs/', isDir: true }),
      expect.objectContaining({ path: 'docs/data.json', size: 32, compressedSize: null }),
      expect.objectContaining({ path: 'readme.txt', size: 29 }),
    ]);
    expect(archiveStats(v).slice(0, 3)).toEqual([
      { label: 'Format', value: 'ISO' },
      { label: 'File system', value: 'ISO 9660 with Joliet' },
      { label: 'Volume', value: 'CLIPBOX_DISC' },
    ]);
    expect(archiveStats(v).map(s => s.label)).not.toContain('Compression ratio');
    expect(td.decode((await sz.derive(v, 'docs/data.json')).bytes)).toBe(
      '{"disc": "iso9660", "ok": true}\n',
    );
    // The instance is reused, and each command cleans up after itself
    expect(td.decode((await sz.derive(v, 'readme.txt')).bytes)).toBe(
      'Hello from an ISO 9660 disc.\n',
    );
  });

  it('lists and extracts a UDF-only image, long mixed-case names included', async () => {
    const v = await parse(fixture('udf.iso.gz'));
    expect(sz.label(v)).toBe('UDF · CLIPBOX_UDF · 2 files · 66 B');
    expect(v.entries.map(e => e.path).sort()).toEqual([
      'hello.txt',
      'notes/',
      'notes/Read Me First.md',
    ]);
    const derived = await sz.derive(v, 'notes/Read Me First.md');
    expect(derived).toMatchObject({ name: 'Read Me First.md', mime: 'text/markdown' });
    expect(td.decode(derived.bytes)).toBe('# Notes\n\nUDF keeps long, mixed-case names.\n');
  });

  it('opens a hybrid image as ISO 9660, not as an MBR disk', async () => {
    const v = await parse(withMbr(fixture('iso9660.iso.gz')));
    expect(sz.label(v)).toBe('ISO 9660 · CLIPBOX_DISC · 2 files · 61 B');
  });

  it('marks a damaged image unsupported instead of failing', async () => {
    const v = await parse(image(['CD001']));
    expect(sz.label(v)).toBe('ISO · unsupported');
    // …and the next image still works
    const ok = await parse(fixture('udf.iso.gz'));
    expect(ok.entries).toHaveLength(3);
  });

  it('reports a missing file', async () => {
    const v = await parse(fixture('iso9660.iso.gz'));
    const bad = {
      ...v,
      source: {
        type: 'external' as const,
        bytes: v.source.bytes,
        names: ['docs/', 'nope.txt', 'x'],
      },
    };
    await expect(sz.derive(bad, 'docs/data.json')).rejects.toThrow(/nope\.txt/);
  });
});
