import { unzlibSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  executableFormat,
  executableLabel,
  executableLayout,
  executableStats,
  iconFile,
  largestIconPng,
  parseExecutable,
  shortVersion,
} from '../../src/core/executable/describe';
import { decodeDib, encodePng, iconToPng } from '../../src/core/executable/icon';
import { parseVersionInfo, timestampNote } from '../../src/core/executable/pe';
import { findStrings } from '../../src/core/executable/strings';
import type { ElfInfo, ExecutableValue, MachoInfo, PeInfo } from '../../src/core/executable/types';
import { detectKinds } from '../../src/core/interpreters';
import { detectMagic } from '../../src/core/magic';
import { selfSigned } from '../fixtures/certs';
import {
  dibIcon,
  javaClassHeader,
  makeElf,
  makeFat,
  makeMacho,
  makePe,
  noise,
  pemToDer,
  samplePe,
  signedData,
  versionResource,
} from '../fixtures/executables';
import { bytesContent } from './helpers';

const NOW = Date.UTC(2026, 0, 1);

function pe(bytes: Uint8Array<ArrayBuffer>): { v: ExecutableValue; info: PeInfo } {
  const v = parseExecutable(bytes, NOW);
  if (v.info?.format !== 'pe') throw new Error(`not parsed as PE: ${v.error}`);
  return { v, info: v.info };
}
function elf(bytes: Uint8Array<ArrayBuffer>): ElfInfo {
  const v = parseExecutable(bytes);
  if (v.info?.format !== 'elf') throw new Error(`not parsed as ELF: ${v.error}`);
  return v.info;
}
function macho(bytes: Uint8Array<ArrayBuffer>): MachoInfo {
  const v = parseExecutable(bytes);
  if (v.info?.format !== 'macho') throw new Error(`not parsed as Mach-O: ${v.error}`);
  return v.info;
}
const label = (bytes: Uint8Array<ArrayBuffer>) => executableLabel(parseExecutable(bytes, NOW));

/** PNG pixel data back to RGBA rows (filter type 0 only, as `encodePng` writes). */
function pngPixels(png: Uint8Array): { width: number; height: number; rgba: Uint8Array } {
  const dv = new DataView(png.buffer, png.byteOffset);
  const width = dv.getUint32(16);
  const height = dv.getUint32(20);
  const idatLen = dv.getUint32(33);
  const raw = unzlibSync(png.subarray(41, 41 + idatLen));
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    rgba.set(raw.subarray(y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1)), y * width * 4);
  }
  return { width, height, rgba };
}

describe('detection', () => {
  it('ranks executables above binary, which stays on offer', () => {
    for (const bytes of [
      samplePe(),
      makeElf(),
      makeMacho(),
      makeFat([{ cpu: 'arm64', bytes: makeMacho() }]),
    ]) {
      const kinds = detectKinds(bytesContent(bytes)).map(k => k.kind);
      expect(kinds[0]).toBe('executable');
      expect(kinds).toContain('binary');
    }
  });

  it('needs a PE signature at e_lfanew, not just MZ', () => {
    const b = samplePe();
    expect(executableFormat(b)).toBe('pe');
    const noSig = b.slice();
    noSig[0x40] = 0x58;
    expect(executableFormat(noSig)).toBeNull();
    const farLfanew = b.slice();
    new DataView(farLfanew.buffer).setUint32(0x3c, 0x7fffffff, true);
    expect(executableFormat(farLfanew)).toBeNull();
    expect(
      executableFormat(
        new TextEncoder().encode(
          'MZ is a plain text file that starts like a DOS program....................',
        ),
      ),
    ).toBeNull();
  });

  it("doesn't mistake Java class files (also CAFEBABE) for universal binaries", () => {
    expect(executableFormat(javaClassHeader())).toBeNull();
    expect(detectKinds(bytesContent(javaClassHeader())).map(k => k.kind)).not.toContain(
      'executable',
    );
  });

  it('rejects fat headers whose slices are outside the file', () => {
    const fat = makeFat([{ cpu: 'arm64', bytes: makeMacho() }]);
    expect(executableFormat(fat.slice(0, 64))).toBeNull();
  });
});

describe('PE', () => {
  it('reads the headers of a 64-bit GUI app', () => {
    const { info } = pe(samplePe());
    expect(info).toMatchObject({
      machine: 'x64',
      bits: 64,
      isDll: false,
      isDriver: false,
      subsystem: 'GUI',
      timestamp: 1_700_000_000,
      timestampNote: null,
      entryPoint: 0x1000,
      imageBase: '0x0000000140000000',
      pdb: 'C:\\build\\example.pdb',
      executionLevel: 'asInvoker',
      warnings: [],
    });
    expect(info.dllCharacteristics).toEqual([
      'High-entropy VA',
      'ASLR',
      'DEP (NX)',
      'Control Flow Guard',
    ]);
    expect(info.characteristics).toContain('Large address aware');
  });

  it('labels with company and version', () => {
    expect(label(samplePe())).toBe('Windows x64 GUI app · Example Corp · v1.2.3');
    expect(label(makePe({ bits: 32, dll: true }))).toBe('Windows x86 DLL');
    expect(label(makePe({ subsystem: 3 }))).toBe('Windows x64 console app');
    expect(label(makePe({ machine: 0xaa64, subsystem: 3 }))).toBe('Windows ARM64 console app');
    expect(label(makePe({ subsystem: 10 }))).toBe('Windows x64 EFI application');
  });

  it('recognises drivers', () => {
    const b = makePe({
      subsystem: 1,
      imports: [{ dll: 'ntoskrnl.exe', functions: ['IoCreateDevice'] }],
    });
    expect(pe(b).info.isDriver).toBe(true);
    expect(label(b)).toBe('Windows x64 driver');
    expect(label(makePe({ subsystem: 1, dllCharacteristics: 0x2000 }))).toBe('Windows x64 driver');
  });

  it('lists sections with entropy and flags packed ones', () => {
    const { v, info } = pe(
      samplePe({
        extraSections: [
          { name: 'UPX1', data: noise(4096) },
          { name: '.blob', data: noise(4096, 7) },
        ],
      }),
    );
    expect(info.sections.map(s => s.name)).toEqual(['.text', '.rdata', '.rsrc', 'UPX1', '.blob']);
    const [text, , , upx, blob] = info.sections;
    expect(text).toMatchObject({
      flags: 'R-X code',
      address: 0x1000,
      rawSize: 0x200,
      packed: false,
    });
    expect(text?.entropy).toBeGreaterThan(0);
    expect(text?.entropy).toBeLessThan(4);
    expect(upx?.packed).toBe(true);
    expect(blob?.entropy).toBeGreaterThan(7.2);
    expect(blob?.packed).toBe(true);
    expect(blob?.flags).toBe('RWX data');
    expect(executableLayout(v).badges.map(b => b.text)).toContain('Packed?');
  });

  it('reads imports by name and ordinal, including delay-loaded ones', () => {
    for (const bits of [32, 64] as const) {
      const { info } = pe(samplePe({ bits }));
      expect(info.imports).toEqual([
        {
          library: 'KERNEL32.dll',
          delay: false,
          weak: false,
          functions: [
            { name: 'CreateFileW', ordinal: null },
            { name: 'ExitProcess', ordinal: null },
            { name: 'GetLastError', ordinal: null },
          ],
        },
        {
          library: 'USER32.dll',
          delay: false,
          weak: false,
          functions: [
            { name: 'MessageBoxW', ordinal: null },
            { name: null, ordinal: 42 },
          ],
        },
        {
          library: 'WININET.dll',
          delay: true,
          weak: false,
          functions: [{ name: 'InternetOpenW', ordinal: null }],
        },
      ]);
    }
  });

  it('reads exports, with forwarders', () => {
    const b = makePe({
      bits: 32,
      dll: true,
      exportName: 'example.dll',
      exports: [
        { name: 'Zeta' },
        { name: 'Alpha' },
        { name: 'Heap', forwarder: 'NTDLL.RtlAllocateHeap' },
      ],
    });
    const { info } = pe(b);
    expect(info.exportName).toBe('example.dll');
    expect(info.exports).toEqual([
      { ordinal: 1, name: 'Zeta', address: 0x1000, forwarder: null },
      { ordinal: 2, name: 'Alpha', address: 0x1010, forwarder: null },
      { ordinal: 3, name: 'Heap', address: expect.any(Number), forwarder: 'NTDLL.RtlAllocateHeap' },
    ]);
  });

  it('reads the version resource', () => {
    const { info } = pe(samplePe());
    expect(info.version).toEqual({
      fileVersion: '1.2.3.0',
      productVersion: '1.2.3.0',
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
      translations: ['0409 04B0'],
    });
  });

  it('parses version info on its own and rejects other blocks', () => {
    const v = parseVersionInfo(versionResource([10, 0, 19041, 1], { ProductName: 'X' }));
    expect(v.fileVersion).toBe('10.0.19041.1');
    expect(v.strings).toEqual({ ProductName: 'X' });
    expect(() => parseVersionInfo(new Uint8Array([4, 0, 0, 0]))).toThrow('bad version block');
  });

  it('counts resources by type and finds the icon group', () => {
    const { v, info } = pe(samplePe());
    const layout = executableLayout(v);
    expect(layout.resources.map(r => [r.type, r.count])).toEqual([
      ['Icon', 2],
      ['Icon group', 1],
      ['Version', 1],
      ['Manifest', 1],
    ]);
    expect(info.iconGroups).toHaveLength(1);
    expect(info.iconGroups[0]?.images.map(i => [i.width, i.height, i.png])).toEqual([
      [16, 16, false],
      [48, 48, true],
    ]);
    expect(layout.hasIcon).toBe(true);
  });

  it('finds the overlay, excluding a trailing certificate table', async () => {
    const overlay = new TextEncoder().encode('installer payload');
    const { v, info } = pe(samplePe({ overlay }));
    expect(info.overlay?.size).toBe(overlay.length);
    expect(
      v.bytes.slice(info.overlay?.offset, (info.overlay?.offset ?? 0) + overlay.length),
    ).toEqual(overlay);

    const pkcs7 = signedData([pemToDer(await selfSigned('Example Signer', 30))]);
    const signed = pe(samplePe({ overlay, pkcs7 })).info;
    // Plus the padding that 8-byte-aligns the certificate table
    expect(signed.overlay?.size).toBe(Math.ceil(overlay.length / 8) * 8);
    expect(pe(samplePe({ overlay: undefined, pkcs7 })).info.overlay).toBeNull();
  });

  it('names the Authenticode signer without claiming it is valid', async () => {
    const pkcs7 = signedData([pemToDer(await selfSigned('Example Signer', 30))]);
    const { v, info } = pe(samplePe({ pkcs7 }));
    expect(info.signature).toMatchObject({
      type: 'authenticode',
      digest: 'SHA-256',
      error: null,
      signer: {
        subject: 'CN=Example Signer, O=Clipbox Test',
        issuer: 'CN=Example Signer, O=Clipbox Test',
        serial: '0A1B2C',
      },
    });
    expect(info.signature?.certificates).toHaveLength(1);
    const layout = executableLayout(v);
    expect(layout.signing).toEqual({
      state: 'signed',
      text: 'Signed by Example Signer (not verified)',
    });
    expect(layout.header.find(r => r.label === 'Certificate valid')?.value).toMatch(
      /^\d{4}-\d\d-\d\d to /,
    );
  });

  it('reports an unreadable signature blob without failing', () => {
    const { v, info } = pe(samplePe({ pkcs7: new Uint8Array([0x30, 0x03, 0x02, 0x01, 0x01]) }));
    expect(info.signature?.error).toBe('not PKCS#7 SignedData');
    expect(executableLayout(v).signing.text).toBe(
      'Signature present, unreadable (not PKCS#7 SignedData)',
    );
    expect(executableLayout(pe(samplePe()).v).signing).toEqual({
      state: 'unsigned',
      text: 'Not signed',
    });
  });

  it('detects .NET and its runtime version', () => {
    const { v, info } = pe(makePe({ bits: 32, dotnet: true, subsystem: 3 }));
    expect(info.dotnet).toEqual({ runtime: 'v4.0.30319', version: '2.5', flags: ['IL only'] });
    expect(executableLabel(v)).toBe('Windows x86 .NET console app');
  });

  it('flags timestamps that are really hashes', () => {
    expect(pe(makePe({ reproducible: true })).info.timestampNote).toBe(
      'reproducible build: a hash, not a time',
    );
    expect(pe(makePe({ timestamp: 0xf0000000 })).info.timestampNote).toBe(
      'in the future: probably a reproducible-build hash',
    );
    expect(timestampNote(0x2a425e19, false)).toBe("Delphi's fixed timestamp, not the build time");
    expect(timestampNote(12345, false)).toBe('before 1990: probably a hash, not a time');
    expect(timestampNote(0, false)).toBe('not set');
  });

  it('shows key stats in the sidebar', () => {
    const { v } = pe(samplePe());
    const stats = executableStats(v);
    const value = (l: string) => stats.find(s => s.label === l)?.value;
    expect(value('Product')).toBe('Example');
    expect(value('Version')).toBe('1.2.3');
    expect(value('Architecture')).toBe('x64');
    expect(value('Linker timestamp')).toBe('2023-11-14 22:13:20 UTC');
    expect(value('Signature')).toBe('Not signed');
    expect(value('Imports')).toBe('3 libraries · 6 functions');
  });
});

describe('PE robustness', () => {
  const sample = samplePe({
    exports: [{ name: 'A' }],
    dll: true,
    extraSections: [{ name: 'UPX0', data: noise(600) }],
  });

  it('survives truncation at every length', () => {
    for (let n = 0; n <= sample.length; n += 7) {
      const cut = sample.slice(0, n);
      if (!executableFormat(cut)) continue;
      const v = parseExecutable(cut, NOW);
      expect(typeof executableLabel(v)).toBe('string');
      expect(() => executableStats(v)).not.toThrow();
    }
  });

  it('labels a file whose optional header is cut off as malformed', () => {
    const v = parseExecutable(sample.slice(0, 0x40 + 24 + 40), NOW);
    expect(v.info).toBeNull();
    expect(executableLabel(v)).toMatch(
      /^Windows executable \(malformed: optional header at 0x58 runs past the end of the file\)$/,
    );
  });

  it('keeps what it can when sections are truncated', () => {
    const { info } = pe(sample.slice(0, 0x900));
    expect(info.sections.length).toBeGreaterThan(0);
    expect(info.warnings.some(w => w.includes('runs past the end of the file'))).toBe(true);
  });

  it('survives random corruption', () => {
    let seed = 99;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    for (let round = 0; round < 300; round++) {
      const b = sample.slice();
      for (let k = 0; k < 8; k++) b[rand() % b.length] = rand() & 0xff;
      if (!executableFormat(b)) continue;
      const v = parseExecutable(b, NOW);
      expect(() => executableLayout(v)).not.toThrow();
    }
  });

  it("doesn't loop on a resource directory that points at itself", () => {
    const b = samplePe();
    const rsrc = pe(b).info.sections.find(s => s.name === '.rsrc');
    if (!rsrc) throw new Error('no .rsrc');
    // Root entry 0 → subdirectory at offset 0 (the root again)
    new DataView(b.buffer).setUint32(rsrc.rawOffset + 16 + 4, 0x80000000, true);
    const { info } = pe(b);
    expect(info.resources.length).toBeLessThan(10);
  });

  it('caps absurd counts', () => {
    const b = makePe({ dll: true, exports: [{ name: 'A' }] });
    const { info } = pe(b);
    const dirRva = info.sections.find(s => s.name === '.rdata')?.rawOffset ?? 0;
    // NumberOfFunctions in the export directory (first thing in .rdata here)
    new DataView(b.buffer).setUint32(dirRva + 20, 0xffffffff, true);
    const after = pe(b).info;
    expect(after.warnings).toContain('stopped after 65536 exports');
  });
});

describe('icons', () => {
  it('decodes a 32-bit DIB with alpha', () => {
    const { width, height, rgba } = decodeDib(dibIcon(4, 3, [10, 20, 30, 200]));
    expect([width, height]).toEqual([4, 3]);
    expect([...rgba.subarray(0, 4)]).toEqual([30, 20, 10, 200]);
  });

  it('decodes a paletted DIB using its AND mask', () => {
    // 8×2, 1 bpp, palette black/red; top row (stored last) set; AND mask hides pixel 0 of the top row
    const header = new Uint8Array(40);
    const dv = new DataView(header.buffer);
    dv.setUint32(0, 40, true);
    dv.setInt32(4, 8, true);
    dv.setInt32(8, 4, true);
    dv.setUint16(12, 1, true);
    dv.setUint16(14, 1, true);
    const palette = [0, 0, 0, 0, 0, 0, 255, 0];
    const xor = [0x00, 0, 0, 0, 0xff, 0, 0, 0]; // bottom row then top row (4-byte stride)
    const and = [0, 0, 0, 0, 0x80, 0, 0, 0];
    const { rgba } = decodeDib(new Uint8Array([...header, ...palette, ...xor, ...and]));
    expect([...rgba.subarray(0, 4)]).toEqual([255, 0, 0, 0]);
    expect([...rgba.subarray(4, 8)]).toEqual([255, 0, 0, 255]);
    expect([...rgba.subarray(32, 36)]).toEqual([0, 0, 0, 255]);
  });

  it('rejects broken or hostile bitmaps', () => {
    const big = dibIcon(2, 2, [0, 0, 0, 255]);
    new DataView(big.buffer).setInt32(4, 100_000, true);
    expect(() => decodeDib(big)).toThrow('unsupported icon size');
    expect(() => decodeDib(dibIcon(16, 16, [0, 0, 0, 255]).slice(0, 100))).toThrow(
      'runs past the end',
    );
    expect(() => decodeDib(new Uint8Array(8))).toThrow();
  });

  it('round-trips pixels through the PNG encoder', () => {
    const rgba = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const png = encodePng(2, 1, rgba);
    expect(detectMagic(png)).toBe('png');
    expect(pngPixels(png)).toEqual({ width: 2, height: 1, rgba });
  });

  it('builds a .ico of the group and a PNG of the largest image', () => {
    const { v } = pe(samplePe());
    const ico = iconFile(v);
    expect(detectMagic(ico)).toBe('ico');
    const dv = new DataView(ico.buffer);
    expect(dv.getUint16(4, true)).toBe(2);
    expect([ico[6], ico[7], ico[22], ico[23]]).toEqual([48, 48, 16, 16]);
    // Each entry's data is where its offset says
    const first = dv.getUint32(6 + 12, true);
    expect([...ico.subarray(first, first + 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    const second = dv.getUint32(6 + 16 + 12, true);
    expect(dv.getUint32(second, true)).toBe(40); // BITMAPINFOHEADER

    const png = largestIconPng(v);
    expect(pngPixels(iconToPng(png)).width).toBe(48);
  });

  it('converts a DIB-only icon to PNG', () => {
    const { v } = pe(makePe({ icons: [{ width: 32, height: 32, png: false }] }));
    const { width, height, rgba } = pngPixels(largestIconPng(v));
    expect([width, height]).toEqual([32, 32]);
    expect([...rgba.subarray(0, 4)]).toEqual([60, 160, 30, 255]);
  });
});

describe('ELF', () => {
  it('reads a 64-bit little-endian PIE executable', () => {
    const info = elf(makeElf({ needed: ['libc.so.6', 'libm.so.6'], exports: ['foo'] }));
    expect(info).toMatchObject({
      bits: 64,
      littleEndian: true,
      machine: 'x86-64',
      type: 'PIE executable',
      interpreter: '/lib64/ld-linux-x86-64.so.2',
      needed: ['libc.so.6', 'libm.so.6'],
      stripped: true,
      debugInfo: false,
      buildId: 'deadbeef01020304',
      executableStack: false,
      warnings: [],
    });
    expect(info.exports.map(e => e.name)).toEqual(['foo']);
    expect(info.sections.map(s => s.name)).toContain('.text');
    expect(label(makeElf())).toBe('Linux x86-64 ELF PIE executable');
  });

  it('reads 32-bit big-endian files, shared libraries and symbols', () => {
    const info = elf(
      makeElf({
        bits: 32,
        little: false,
        machine: 8,
        interpreter: null,
        soname: 'libx.so.1',
        symtab: true,
        needed: ['libc.so.6'],
      }),
    );
    expect(info).toMatchObject({
      bits: 32,
      littleEndian: false,
      machine: 'MIPS',
      type: 'shared library',
      soname: 'libx.so.1',
      needed: ['libc.so.6'],
      stripped: false,
    });
    expect(label(makeElf({ type: 2, machine: 183 }))).toBe('Linux AArch64 ELF executable');
    expect(label(makeElf({ type: 1, interpreter: null }))).toBe(
      'Linux x86-64 ELF relocatable object',
    );
  });

  it('labels truncated files as malformed and survives every cut', () => {
    const b = makeElf({ needed: ['libc.so.6'] });
    expect(label(b.slice(0, 60))).toBe(
      'ELF file (malformed: ELF header at 0x0 runs past the end of the file)',
    );
    for (let n = 52; n < b.length; n += 5) {
      const v = parseExecutable(b.slice(0, n));
      expect(() => executableLayout(v)).not.toThrow();
    }
  });
});

describe('Mach-O', () => {
  it('reads a thin arm64 executable', () => {
    const info = macho(
      makeMacho({
        identifier: 'com.example.app',
        weakDylibs: ['/usr/lib/libz.1.dylib'],
        encrypted: false,
      }),
    );
    expect(info).toMatchObject({
      bits: 64,
      cpu: 'arm64',
      fileType: 'executable',
      platform: 'macOS',
      minOs: '11.0',
      sdk: '14.2',
      uuid: '12345678-9ABC-DEF0-0102-030405060708',
      entryPoint: 0x1000,
      encrypted: false,
      warnings: [],
    });
    expect(info.dylibs).toEqual([
      { name: '/usr/lib/libSystem.B.dylib', how: 'load', version: '1312.0' },
      { name: '/usr/lib/libz.1.dylib', how: 'weak', version: '1.0' },
    ]);
    expect(info.signature).toMatchObject({
      type: 'macho',
      adhoc: true,
      identifier: 'com.example.app',
      error: null,
    });
    expect(info.sections[0]).toMatchObject({ name: '__text', group: '__TEXT', flags: 'R-X' });
    expect(label(makeMacho())).toBe('macOS arm64 executable');
    expect(label(makeMacho({ cpu: 'x86_64', fileType: 6 }))).toBe('macOS x86_64 dylib');
  });

  it('describes signing and encryption', () => {
    const v = parseExecutable(makeMacho({ identifier: 'com.example.app', encrypted: true }));
    const layout = executableLayout(v);
    expect(layout.signing).toEqual({ state: 'adhoc', text: 'Ad-hoc signed (no certificate)' });
    expect(layout.badges.map(b => b.text)).toContain('Encrypted');
    expect(executableLayout(parseExecutable(makeMacho())).signing.state).toBe('unsigned');
  });

  it('reads universal binaries', () => {
    const fat = makeFat([
      { cpu: 'x86_64', bytes: makeMacho({ cpu: 'x86_64' }) },
      {
        cpu: 'arm64',
        bytes: makeMacho({ dylibs: ['/usr/lib/libSystem.B.dylib', '/usr/lib/libc++.1.dylib'] }),
      },
    ]);
    const v = parseExecutable(fat);
    expect(executableLabel(v)).toBe('macOS universal (x86_64, arm64)');
    const layout = executableLayout(v);
    expect(layout.arch).toEqual(['x86_64', 'arm64']);
    expect(layout.imports.map(i => i.library)).toEqual([
      '/usr/lib/libSystem.B.dylib',
      '/usr/lib/libc++.1.dylib',
    ]);
    expect(layout.sections.map(s => s.group)).toEqual(['x86_64 __TEXT', 'arm64 __TEXT']);
  });

  it('keeps going when a slice is damaged', () => {
    const fat = makeFat([
      { cpu: 'x86_64', bytes: makeMacho({ cpu: 'x86_64' }) },
      { cpu: 'arm64', bytes: makeMacho() },
    ]);
    const second = new DataView(fat.buffer).getUint32(8 + 20 + 8);
    fat.fill(0, second, second + 8);
    const v = parseExecutable(fat);
    if (v.info?.format !== 'fat') throw new Error('expected fat');
    expect(v.info.slices[1]?.error).toBe('not a Mach-O file');
    expect(executableLayout(v).header.find(r => r.label === 'Slice arm64')?.value).toBe(
      'unreadable: not a Mach-O file',
    );
  });

  it('survives every truncation', () => {
    const b = makeMacho({ identifier: 'com.example.app' });
    for (let n = 28; n < b.length; n += 3) {
      const cut = b.slice(0, n);
      if (!executableFormat(cut)) continue;
      expect(() => executableLayout(parseExecutable(cut))).not.toThrow();
    }
  });
});

describe('strings', () => {
  const enc = new TextEncoder();
  const utf16 = (s: string) => new Uint8Array([...s].flatMap(c => [c.charCodeAt(0), 0]));

  it('finds ASCII and UTF-16LE strings in file order', () => {
    const b = new Uint8Array([
      0,
      ...enc.encode('hello world'),
      0,
      1,
      2,
      ...utf16('Wide string'),
      0,
      0,
      ...enc.encode('abc'),
      0,
    ]);
    expect(
      findStrings(b, { minLength: 6, encoding: 'both', max: 100 }).strings.map(s => [
        s.text,
        s.encoding,
      ]),
    ).toEqual([
      ['hello world', 'ascii'],
      ['Wide string', 'utf16'],
    ]);
    expect(
      findStrings(b, { minLength: 3, encoding: 'ascii', max: 100 }).strings.map(s => s.text),
    ).toEqual(['hello world', 'abc']);
    expect(
      findStrings(b, { minLength: 4, encoding: 'utf16', max: 100 }).strings.map(s => s.text),
    ).toEqual(['Wide string']);
  });

  it('caps the number of results', () => {
    const b = enc.encode(Array.from({ length: 50 }, (_, i) => `string-${i}`).join('\0'));
    const r = findStrings(b, { minLength: 6, encoding: 'ascii', max: 10 });
    expect(r.strings).toHaveLength(10);
    expect(r.truncated).toBe(true);
    expect(findStrings(b, { minLength: 6, encoding: 'ascii', max: 50 }).truncated).toBe(false);
  });
});

describe('version strings', () => {
  it('shortens versions', () => {
    expect(shortVersion('1.2.3.0')).toBe('1.2.3');
    expect(shortVersion('10, 0, 1, 2')).toBe('10.0.1.2');
    expect(shortVersion('2.1 (beta)')).toBe('2.1');
    expect(shortVersion('  ')).toBeNull();
    expect(shortVersion('Release')).toBe('Release');
  });
});
