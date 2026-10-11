/** Mach-O (macOS, iOS…) parsing, including universal ("fat") binaries. */

import { parseSignedData } from './pkcs7';
import { attempt, entropy, FormatError, PACKED_ENTROPY, Reader } from './reader';
import type { ExecSection, FatInfo, FatSlice, MachoDylib, MachoInfo, SignatureInfo } from './types';

export const MACHO_LIMITS = { commands: 4096, sections: 1024, slices: 19, dylibs: 4096 };

const MH_MAGIC = 0xfeedface;
const MH_MAGIC_64 = 0xfeedfacf;
const FAT_MAGIC = 0xcafebabe;
const FAT_MAGIC_64 = 0xcafebabf;

const be32 = (b: Uint8Array, o: number) =>
  (((b[o] ?? 0) << 24) | ((b[o + 1] ?? 0) << 16) | ((b[o + 2] ?? 0) << 8) | (b[o + 3] ?? 0)) >>> 0;
const le32 = (b: Uint8Array, o: number) =>
  ((b[o] ?? 0) | ((b[o + 1] ?? 0) << 8) | ((b[o + 2] ?? 0) << 16) | ((b[o + 3] ?? 0) << 24)) >>> 0;

/** Byte order of a thin Mach-O header, or null if `b` doesn't start with one. */
function machoEndian(b: Uint8Array, at = 0): { little: boolean; bits: 32 | 64 } | null {
  if (b.length < at + 28) return null;
  const le = le32(b, at);
  if (le === MH_MAGIC || le === MH_MAGIC_64)
    return { little: true, bits: le === MH_MAGIC_64 ? 64 : 32 };
  const bev = be32(b, at);
  if (bev === MH_MAGIC || bev === MH_MAGIC_64)
    return { little: false, bits: bev === MH_MAGIC_64 ? 64 : 32 };
  return null;
}

/** A thin Mach-O with a plausible command count. */
export function isMacho(b: Uint8Array): boolean {
  const e = machoEndian(b);
  if (!e) return false;
  const ncmds = e.little ? le32(b, 16) : be32(b, 16);
  return ncmds > 0 && ncmds <= MACHO_LIMITS.commands;
}

/**
 * A universal binary: CAFEBABE is also a Java class file's magic, but there the next word is the
 * class version (45+), so a fat header needs 1–19 architectures, each inside the file.
 */
export function isFat(b: Uint8Array): boolean {
  if (b.length < 8) return false;
  const magic = be32(b, 0);
  if (magic !== FAT_MAGIC && magic !== FAT_MAGIC_64) return false;
  const n = be32(b, 4);
  if (n < 1 || n > MACHO_LIMITS.slices) return false;
  const size = magic === FAT_MAGIC_64 ? 32 : 20;
  if (8 + n * size > b.length) return false;
  const first =
    magic === FAT_MAGIC_64 ? be32(b, 8 + 12) + be32(b, 8 + 8) * 2 ** 32 : be32(b, 8 + 8);
  return first > 0 && first < b.length;
}

const CPU_ABI64 = 0x01000000;
const CPU_ABI64_32 = 0x02000000;

export function cpuName(type: number, subtype: number): string {
  const base = type & 0xffffff;
  const sub = subtype & 0xff;
  switch (base) {
    case 7:
      if (type & CPU_ABI64) return sub === 8 ? 'x86_64h' : 'x86_64';
      return 'i386';
    case 12:
      if (type & CPU_ABI64) return sub === 2 ? 'arm64e' : 'arm64';
      if (type & CPU_ABI64_32) return 'arm64_32';
      return sub === 9
        ? 'armv7'
        : sub === 11
          ? 'armv7s'
          : sub === 12
            ? 'armv7k'
            : sub === 6
              ? 'armv6'
              : 'arm';
    case 18:
      return type & CPU_ABI64 ? 'ppc64' : 'ppc';
    default:
      return `cpu ${type}`;
  }
}

const FILE_TYPES: Record<number, string> = {
  1: 'object file',
  2: 'executable',
  3: 'fixed VM library',
  4: 'core dump',
  5: 'preloaded executable',
  6: 'dylib',
  7: 'dynamic linker',
  8: 'bundle',
  9: 'dylib stub',
  10: 'debug symbols (dSYM)',
  11: 'kernel extension',
  12: 'file set',
};

const PLATFORMS: Record<number, string> = {
  1: 'macOS',
  2: 'iOS',
  3: 'tvOS',
  4: 'watchOS',
  5: 'bridgeOS',
  6: 'Mac Catalyst',
  7: 'iOS Simulator',
  8: 'tvOS Simulator',
  9: 'watchOS Simulator',
  10: 'DriverKit',
  11: 'visionOS',
  12: 'visionOS Simulator',
};

const HEADER_FLAGS: [number, string][] = [
  [0x1, 'no undefined references'],
  [0x4, 'dyld-linked'],
  [0x80, 'two-level namespace'],
  [0x8000, 'weak symbols'],
  [0x200000, 'PIE'],
  [0x20000, 'no stack execution'],
  [0x800000, 'app-extension safe'],
  [0x2000000, 'simulator support'],
  [0x80000000, 'dylib in shared cache'],
];

/** X.Y.Z from nibble-packed xxxx.yy.zz, dropping a trailing .0. */
export function packedVersion(v: number): string {
  const s = `${v >>> 16}.${(v >>> 8) & 0xff}`;
  return v & 0xff ? `${s}.${v & 0xff}` : s;
}

const LC = {
  segment: 0x1,
  segment64: 0x19,
  loadDylib: 0xc,
  idDylib: 0xd,
  loadWeakDylib: 0x80000018,
  reexportDylib: 0x8000001f,
  lazyLoadDylib: 0x20,
  loadUpwardDylib: 0x80000023,
  uuid: 0x1b,
  rpath: 0x8000001c,
  codeSignature: 0x1d,
  encryptionInfo: 0x21,
  encryptionInfo64: 0x2c,
  versionMinMacos: 0x24,
  versionMinIos: 0x25,
  versionMinTvos: 0x2f,
  versionMinWatchos: 0x30,
  buildVersion: 0x32,
  main: 0x80000028,
};

const DYLIB_KINDS: Record<number, string> = {
  [LC.loadDylib]: 'load',
  [LC.loadWeakDylib]: 'weak',
  [LC.reexportDylib]: 'reexport',
  [LC.lazyLoadDylib]: 'lazy',
  [LC.loadUpwardDylib]: 'upward',
};

const VERSION_MIN: Record<number, string> = {
  [LC.versionMinMacos]: 'macOS',
  [LC.versionMinIos]: 'iOS',
  [LC.versionMinTvos]: 'tvOS',
  [LC.versionMinWatchos]: 'watchOS',
};

function protFlags(p: number): string {
  return `${p & 1 ? 'R' : '-'}${p & 2 ? 'W' : '-'}${p & 4 ? 'X' : '-'}`;
}

/** Parses the thin Mach-O starting at `base` (0 unless it's a slice of a universal binary). */
export function parseMacho(
  bytes: Uint8Array<ArrayBuffer>,
  base = 0,
  end = bytes.length,
): MachoInfo {
  const e = machoEndian(bytes, base);
  if (!e) throw new FormatError('not a Mach-O file');
  const r = new Reader(bytes, e.little);
  const warnings: string[] = [];
  const is64 = e.bits === 64;
  const cputype = r.i32(base + 4);
  const cpusubtype = r.i32(base + 8);
  const filetype = r.u32(base + 12);
  const ncmds = r.u32(base + 16);
  const sizeofcmds = r.u32(base + 20);
  const flags = r.u32(base + 24);
  const header = is64 ? 32 : 28;
  const cmdsEnd = Math.min(end, base + header + sizeofcmds);
  if (base + header + sizeofcmds > end) warnings.push('load commands run past the end of the file');

  const dylibs: MachoDylib[] = [];
  const rpaths: string[] = [];
  const sections: ExecSection[] = [];
  let installName: string | null = null;
  let uuid: string | null = null;
  let entryPoint: number | null = null;
  let platform: string | null = null;
  let minOs: string | null = null;
  let sdk: string | null = null;
  let encrypted: boolean | null = null;
  let signature: SignatureInfo | null = null;

  const lcStr = (cmd: number, size: number, field: number) => {
    const off = r.u32(cmd + field);
    return off < size ? r.cstrUtf8(cmd + off, Math.min(size - off, 1024)) : '';
  };

  let p = base + header;
  const count = Math.min(ncmds, MACHO_LIMITS.commands);
  for (let i = 0; i < count; i++) {
    if (p + 8 > cmdsEnd) {
      warnings.push(`load commands are truncated after ${i} of ${ncmds}`);
      break;
    }
    const cmd = r.u32(p);
    const size = r.u32(p + 4);
    if (size < 8 || p + size > cmdsEnd) {
      warnings.push(`load command ${i} has a bad size`);
      break;
    }
    const at = p;
    attempt(warnings, `load command ${i}`, () => {
      if (cmd === LC.segment || cmd === LC.segment64) {
        const seg = r.fixedStr(at + 8, 16);
        const nsects = r.u32(at + (is64 ? 64 : 48));
        const sectSize = is64 ? 80 : 68;
        let s = at + (is64 ? 72 : 56);
        for (let k = 0; k < nsects && sections.length < MACHO_LIMITS.sections; k++, s += sectSize) {
          if (s + sectSize > at + size) break;
          const name = r.fixedStr(s, 16);
          const addr = is64 ? r.u64(s + 32) : r.u32(s + 32);
          const sz = is64 ? r.u64(s + 40) : r.u32(s + 36);
          const off = r.u32(s + (is64 ? 48 : 40));
          const stype = r.u32(s + (is64 ? 64 : 56)) & 0xff;
          const zerofill = stype === 1 || stype === 0xc || stype === 0x12;
          const hasData = !zerofill && off > 0 && sz > 0;
          const h = hasData ? entropy(r.view(base + off, sz)) : null;
          const prot = r.u32(at + (is64 ? 60 : 44));
          sections.push({
            name,
            group: seg,
            address: addr,
            virtualSize: sz,
            rawOffset: hasData ? off : 0,
            rawSize: hasData ? sz : 0,
            flags: protFlags(prot),
            entropy: h,
            packed: h !== null && h > PACKED_ENTROPY && sz >= 256,
          });
        }
      } else if (cmd in DYLIB_KINDS) {
        if (dylibs.length < MACHO_LIMITS.dylibs) {
          dylibs.push({
            name: lcStr(at, size, 8),
            how: DYLIB_KINDS[cmd] ?? 'load',
            version: packedVersion(r.u32(at + 16)),
          });
        }
      } else if (cmd === LC.idDylib) {
        installName = lcStr(at, size, 8);
      } else if (cmd === LC.rpath) {
        rpaths.push(lcStr(at, size, 8));
      } else if (cmd === LC.uuid) {
        const b = r.view(at + 8, 16);
        const h = Array.from(b, x => x.toString(16).padStart(2, '0'))
          .join('')
          .toUpperCase();
        uuid = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
      } else if (cmd === LC.main) {
        entryPoint = r.u64(at + 8);
      } else if (cmd === LC.buildVersion) {
        const id = r.u32(at + 8);
        platform = PLATFORMS[id] ?? `platform ${id}`;
        minOs = packedVersion(r.u32(at + 12));
        sdk = packedVersion(r.u32(at + 16));
      } else if (cmd in VERSION_MIN) {
        platform ??= VERSION_MIN[cmd] ?? null;
        minOs ??= packedVersion(r.u32(at + 8));
        sdk ??= packedVersion(r.u32(at + 12));
      } else if (cmd === LC.encryptionInfo || cmd === LC.encryptionInfo64) {
        encrypted = (encrypted ?? false) || r.u32(at + 16) !== 0;
      } else if (cmd === LC.codeSignature) {
        signature = parseCodeSignature(r, base + r.u32(at + 8), r.u32(at + 12), end);
      }
    });
    p += size;
  }

  return {
    format: 'macho',
    bits: e.bits,
    littleEndian: e.little,
    cpu: cpuName(cputype, cpusubtype),
    fileType: FILE_TYPES[filetype] ?? `file type ${filetype}`,
    platform,
    minOs,
    sdk,
    installName,
    dylibs,
    rpaths,
    uuid,
    entryPoint,
    sections,
    signature,
    encrypted,
    flags: HEADER_FLAGS.filter(([bit]) => (flags & bit) !== 0).map(([, n]) => n),
    warnings,
  };
}

/** The embedded signature SuperBlob: identifier, ad-hoc flag and the CMS signer if any. */
function parseCodeSignature(r0: Reader, offset: number, size: number, end: number): SignatureInfo {
  const info: SignatureInfo = {
    type: 'macho',
    adhoc: false,
    signer: null,
    certificates: [],
    digest: null,
    identifier: null,
    blob: null,
    certRanges: [],
    error: null,
  };
  try {
    const r = r0.withEndian(false); // code signature blobs are always big-endian
    const limit = Math.min(end, offset + size);
    if (!r.has(offset, 12) || r.u32(offset) !== 0xfade0cc0) {
      throw new FormatError('no code signature SuperBlob');
    }
    const count = Math.min(r.u32(offset + 8), 64);
    let hasCms = false;
    for (let i = 0; i < count; i++) {
      const e = offset + 12 + i * 8;
      if (e + 8 > limit) break;
      const type = r.u32(e);
      const blob = offset + r.u32(e + 4);
      if (!r.has(blob, 8) || blob + 8 > limit) continue;
      const magic = r.u32(blob);
      const len = r.u32(blob + 4);
      if (type === 0 && magic === 0xfade0c02 && r.has(blob, 24)) {
        info.adhoc = (r.u32(blob + 12) & 0x2) !== 0;
        const ident = r.u32(blob + 20);
        if (ident < len) info.identifier = r.cstrUtf8(blob + ident, 512) || null;
      } else if (type === 0x10000 && magic === 0xfade0b01 && len > 8 && blob + len <= limit) {
        hasCms = true;
        info.blob = { offset: blob + 8, size: len - 8 };
        Object.assign(info, parseSignedData(r.view(blob + 8, len - 8), blob + 8));
      }
    }
    if (!hasCms && !info.adhoc && info.identifier === null) {
      throw new FormatError('code signature has no code directory');
    }
  } catch (e) {
    info.error = e instanceof Error ? e.message : String(e);
  }
  return info;
}

export function parseFat(bytes: Uint8Array<ArrayBuffer>): FatInfo {
  if (!isFat(bytes)) throw new FormatError('not a universal binary');
  const r = new Reader(bytes, false);
  const is64 = r.u32(0) === FAT_MAGIC_64;
  const n = r.u32(4);
  const size = is64 ? 32 : 20;
  const slices: FatSlice[] = [];
  const warnings: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = 8 + i * size;
    const cpu = cpuName(r.i32(a), r.i32(a + 4));
    const offset = is64 ? r.u64(a + 8) : r.u32(a + 8);
    const sliceSize = is64 ? r.u64(a + 16) : r.u32(a + 12);
    let info: MachoInfo | null = null;
    let error: string | null = null;
    if (!r.has(offset, sliceSize)) {
      error = 'slice runs past the end of the file';
    } else {
      try {
        info = parseMacho(bytes, offset, offset + sliceSize);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
    }
    slices.push({ cpu, offset, size: sliceSize, info, error });
  }
  return { format: 'fat', slices, warnings };
}
