/**
 * Windows Portable Executable (PE32 and PE32+) parsing: headers, sections, imports, exports,
 * resources, Authenticode and overlay. Every structure is read through the bounds-checked
 * `Reader`; each optional part is parsed in `attempt` so a damaged table only costs that table.
 */

import { parseSignedData } from './pkcs7';
import {
  align,
  attempt,
  entropy,
  FormatError,
  PACKED_ENTROPY,
  Reader,
  toHexAddress,
} from './reader';
import type {
  ExecSection,
  ExportEntry,
  IconGroup,
  ImportFunction,
  ImportGroup,
  PeInfo,
  ResourceLeaf,
  SignatureInfo,
  VersionInfo,
} from './types';

/** Caps that keep hostile files from costing unbounded time or memory. */
export const PE_LIMITS = {
  sections: 256,
  importDlls: 4096,
  thunksPerDll: 16_384,
  importsTotal: 65_536,
  exports: 65_536,
  resources: 20_000,
  iconGroups: 64,
  iconsPerGroup: 64,
};

const MACHINES: Record<number, string> = {
  0x0: 'unknown',
  0x14c: 'x86',
  0x8664: 'x64',
  0xaa64: 'ARM64',
  0xa641: 'ARM64EC',
  0xa64e: 'ARM64X',
  0x1c0: 'ARM',
  0x1c2: 'Thumb',
  0x1c4: 'ARMv7',
  0x200: 'IA-64',
  0xebc: 'EFI byte code',
  0x5032: 'RISC-V 32',
  0x5064: 'RISC-V 64',
  0x5128: 'RISC-V 128',
  0x6232: 'LoongArch 32',
  0x6264: 'LoongArch 64',
  0x166: 'MIPS',
  0x1f0: 'PowerPC',
};

const SUBSYSTEMS: Record<number, string> = {
  0: 'unknown',
  1: 'native',
  2: 'GUI',
  3: 'console',
  5: 'OS/2 console',
  7: 'POSIX console',
  8: 'Win9x driver',
  9: 'Windows CE GUI',
  10: 'EFI application',
  11: 'EFI boot service driver',
  12: 'EFI runtime driver',
  13: 'EFI ROM',
  14: 'Xbox',
  16: 'boot application',
};

const CHARACTERISTICS: [number, string][] = [
  [0x0001, 'Relocations stripped'],
  [0x0002, 'Executable image'],
  [0x0020, 'Large address aware'],
  [0x0100, '32-bit machine'],
  [0x0200, 'Debug info stripped'],
  [0x0400, 'Run from swap (removable)'],
  [0x0800, 'Run from swap (network)'],
  [0x1000, 'System file'],
  [0x2000, 'DLL'],
  [0x4000, 'Uniprocessor only'],
];

export const DLL_CHARACTERISTICS: [number, string][] = [
  [0x0020, 'High-entropy VA'],
  [0x0040, 'ASLR'],
  [0x0080, 'Force integrity'],
  [0x0100, 'DEP (NX)'],
  [0x0200, 'No isolation'],
  [0x0400, 'No SEH'],
  [0x0800, 'No bind'],
  [0x1000, 'AppContainer'],
  [0x2000, 'WDM driver'],
  [0x4000, 'Control Flow Guard'],
  [0x8000, 'Terminal-server aware'],
];

const RESOURCE_TYPES: Record<number, string> = {
  1: 'Cursor',
  2: 'Bitmap',
  3: 'Icon',
  4: 'Menu',
  5: 'Dialog',
  6: 'String table',
  7: 'Font directory',
  8: 'Font',
  9: 'Accelerators',
  10: 'Raw data',
  11: 'Message table',
  12: 'Cursor group',
  14: 'Icon group',
  16: 'Version',
  17: 'Dialog include',
  19: 'Plug and Play',
  20: 'VxD',
  21: 'Animated cursor',
  22: 'Animated icon',
  23: 'HTML',
  24: 'Manifest',
};
export const RT = {
  icon: 'Icon',
  iconGroup: 'Icon group',
  version: 'Version',
  manifest: 'Manifest',
};

/** Section names used by common packers and protectors. */
const PACKER_SECTIONS =
  /^(UPX\d|\.UPX\d?|\.aspack|\.adata|\.MPRESS\d|\.petite|\.nsp\d|\.themida|\.winlice|\.vmp\d|\.enigma\d|\.packed|PEC2|PECompact2|\.perplex|\.yP|\.spack|\.ccg|\.boom|kkrunchy|\.mew|MEW|\.FSG!?|\.RLPack|\.taz)$/i;

export const isPackerSection = (name: string) => PACKER_SECTIONS.test(name);

/** MZ, with a "PE\0\0" signature where e_lfanew points. Cheap: a few byte reads. */
export function isPe(b: Uint8Array): boolean {
  if (b.length < 0x40 || b[0] !== 0x4d || b[1] !== 0x5a) return false;
  const lfanew =
    ((b[0x3c] ?? 0) | ((b[0x3d] ?? 0) << 8) | ((b[0x3e] ?? 0) << 16) | ((b[0x3f] ?? 0) << 24)) >>>
    0;
  if (lfanew < 4 || lfanew + 24 > b.length) return false;
  return b[lfanew] === 0x50 && b[lfanew + 1] === 0x45 && b[lfanew + 2] === 0 && b[lfanew + 3] === 0;
}

interface Dir {
  rva: number;
  size: number;
}

/** Data directory indexes. */
const D = { Export: 0, Import: 1, Resource: 2, Security: 4, Debug: 6, DelayImport: 13, Clr: 14 };

const flagNames = (value: number, table: [number, string][]) =>
  table.filter(([bit]) => (value & bit) !== 0).map(([, name]) => name);

const versionText = (ms: number, ls: number) =>
  `${ms >>> 16}.${ms & 0xffff}.${ls >>> 16}.${ls & 0xffff}`;

/** Delphi's linker always wrote this time (1992-06-19). */
const DELPHI_TIMESTAMP = 0x2a425e19;
const YEAR_1990 = 631_152_000;

export function timestampNote(ts: number, reproducible: boolean, now = Date.now()): string | null {
  if (reproducible) return 'reproducible build: a hash, not a time';
  if (ts === 0) return 'not set';
  if (ts === DELPHI_TIMESTAMP) return "Delphi's fixed timestamp, not the build time";
  if (ts * 1000 > now + 86_400_000) return 'in the future: probably a reproducible-build hash';
  if (ts < YEAR_1990) return 'before 1990: probably a hash, not a time';
  return null;
}

function sectionFlags(c: number): string {
  const rwx = `${c & 0x40000000 ? 'R' : '-'}${c & 0x80000000 ? 'W' : '-'}${c & 0x20000000 ? 'X' : '-'}`;
  const kinds = [
    c & 0x20 ? 'code' : '',
    c & 0x40 ? 'data' : '',
    c & 0x80 ? 'bss' : '',
    c & 0x02000000 ? 'discardable' : '',
    c & 0x10000000 ? 'shared' : '',
  ].filter(Boolean);
  return [rwx, ...kinds].join(' ');
}

export function parsePe(bytes: Uint8Array<ArrayBuffer>, now = Date.now()): PeInfo {
  const r = new Reader(bytes);
  const warnings: string[] = [];
  if (!isPe(bytes)) throw new FormatError('no PE signature');
  const pe = r.u32(0x3c);
  const coff = pe + 4;
  const machineId = r.u16(coff);
  const declaredSections = r.u16(coff + 2);
  const timestamp = r.u32(coff + 4);
  const sizeOpt = r.u16(coff + 16);
  const chars = r.u16(coff + 18);
  const opt = coff + 20;
  if (sizeOpt < 2) throw new FormatError('no optional header');
  const magic = r.u16(opt);
  if (magic !== 0x10b && magic !== 0x20b) {
    throw new FormatError(`unknown optional header magic 0x${magic.toString(16)}`);
  }
  const bits = magic === 0x20b ? 64 : 32;
  r.check(opt, bits === 64 ? 112 : 96, 'optional header');
  const entryPoint = r.u32(opt + 16);
  const imageBaseBig = bits === 64 ? r.u64big(opt + 24) : BigInt(r.u32(opt + 28));
  const imageBase = Number(imageBaseBig);
  const fileAlignment = r.u32(opt + 36);
  const sizeOfImage = r.u32(opt + 56);
  const sizeOfHeaders = r.u32(opt + 60);
  const checksum = r.u32(opt + 64);
  const subsystemId = r.u16(opt + 68);
  const dllChars = r.u16(opt + 70);
  const numDirs = Math.min(16, r.u32(opt + (bits === 64 ? 108 : 92)));
  const dirsAt = opt + (bits === 64 ? 112 : 96);
  const dirs: Dir[] = [];
  for (let i = 0; i < numDirs; i++) {
    const at = dirsAt + i * 8;
    if (at + 8 > opt + sizeOpt || !r.has(at, 8)) break;
    dirs.push({ rva: r.u32(at), size: r.u32(at + 4) });
  }
  const dir = (i: number): Dir | null => {
    const d = dirs[i];
    return d && d.rva !== 0 && d.size !== 0 ? d : null;
  };

  // Sections
  const sectionCount = Math.min(declaredSections, PE_LIMITS.sections);
  if (declaredSections > PE_LIMITS.sections) {
    warnings.push(`${declaredSections} sections declared; read the first ${PE_LIMITS.sections}`);
  }
  const table = opt + sizeOpt;
  const sections: ExecSection[] = [];
  const raw: { va: number; vsize: number; ptr: number; rawSize: number }[] = [];
  for (let i = 0; i < sectionCount; i++) {
    const s = table + i * 40;
    if (!r.has(s, 40)) {
      warnings.push(`section table is truncated after ${i} of ${declaredSections} sections`);
      break;
    }
    const name = r.fixedStr(s, 8);
    const vsize = r.u32(s + 8);
    const va = r.u32(s + 12);
    const rawSize = r.u32(s + 16);
    const rawPtr = r.u32(s + 20);
    const c = r.u32(s + 36);
    // The loader rounds the raw pointer down to 512 bytes
    const ptr = fileAlignment >= 0x200 ? rawPtr & ~0x1ff : rawPtr;
    raw.push({ va, vsize, ptr, rawSize });
    const data = rawSize > 0 ? r.view(ptr, rawSize) : null;
    if (rawSize > 0 && ptr + rawSize > r.length) {
      warnings.push(`section ${name || i} runs past the end of the file`);
    }
    const h = data && data.length > 0 ? entropy(data) : null;
    sections.push({
      name,
      group: null,
      address: va,
      virtualSize: vsize,
      rawOffset: rawPtr,
      rawSize,
      flags: sectionFlags(c),
      entropy: h,
      packed: isPackerSection(name) || (h !== null && h > PACKED_ENTROPY),
    });
  }

  /** File offset of an RVA, or null if it isn't backed by file data. */
  const offsetOf = (rva: number): number | null => {
    for (const s of raw) {
      const span = Math.max(s.vsize, s.rawSize);
      if (rva >= s.va && rva < s.va + span) {
        const delta = rva - s.va;
        if (delta >= s.rawSize) return null;
        const off = s.ptr + delta;
        return off < r.length ? off : null;
      }
    }
    return rva < Math.max(sizeOfHeaders, 1) && rva < r.length ? rva : null;
  };
  const at = (rva: number, what: string): number => {
    const off = offsetOf(rva);
    if (off === null) throw new FormatError(`${what} (RVA ${toHexAddress(rva)}) isn't in the file`);
    return off;
  };
  const strAt = (rva: number, max = 512) => {
    const off = offsetOf(rva);
    return off === null ? '' : r.cstr(off, max);
  };

  // Imports
  let importBudget = PE_LIMITS.importsTotal;
  const readThunks = (rva: number, rebase: number): ImportFunction[] => {
    const out: ImportFunction[] = [];
    let p = at(rva, 'import lookup table');
    const step = bits === 64 ? 8 : 4;
    for (let n = 0; n < PE_LIMITS.thunksPerDll && importBudget > 0; n++, p += step) {
      if (!r.has(p, step)) break;
      const lo = r.u32(p);
      const hi = bits === 64 ? r.u32(p + 4) : 0;
      if (lo === 0 && hi === 0) break;
      const byOrdinal = bits === 64 ? (hi & 0x80000000) !== 0 : (lo & 0x80000000) !== 0;
      importBudget--;
      if (byOrdinal) {
        out.push({ name: null, ordinal: lo & 0xffff });
      } else {
        const off = offsetOf(((lo & 0x7fffffff) - rebase) >>> 0);
        out.push({ name: off === null ? null : r.cstr(off + 2, 512) || null, ordinal: null });
      }
    }
    return out;
  };

  const imports: ImportGroup[] = [];
  const importDir = dir(D.Import);
  if (importDir) {
    attempt(warnings, 'imports', () => {
      const base = at(importDir.rva, 'import directory');
      for (let i = 0; i < PE_LIMITS.importDlls; i++) {
        const d = base + i * 20;
        if (!r.has(d, 20)) break;
        const oft = r.u32(d);
        const nameRva = r.u32(d + 12);
        const ft = r.u32(d + 16);
        if (oft === 0 && nameRva === 0 && ft === 0) break;
        const library = strAt(nameRva, 256) || `#${i}`;
        const functions =
          attempt(warnings, `imports from ${library}`, () => readThunks(oft || ft, 0)) ?? [];
        imports.push({ library, delay: false, weak: false, functions });
      }
    });
  }
  const delayDir = dir(D.DelayImport);
  if (delayDir) {
    attempt(warnings, 'delay-load imports', () => {
      const base = at(delayDir.rva, 'delay-load directory');
      for (let i = 0; i < PE_LIMITS.importDlls; i++) {
        const d = base + i * 32;
        if (!r.has(d, 32)) break;
        const attrs = r.u32(d);
        const nameRva = r.u32(d + 4);
        const intRva = r.u32(d + 16);
        if (nameRva === 0) break;
        // Version 1 descriptors (attribute bit 0 clear) hold VAs instead of RVAs
        const rebase = attrs & 1 ? 0 : imageBase;
        const library = strAt((nameRva - rebase) >>> 0, 256) || `#${i}`;
        const functions =
          attempt(warnings, `delay-load imports from ${library}`, () =>
            intRva ? readThunks((intRva - rebase) >>> 0, rebase) : [],
          ) ?? [];
        imports.push({ library, delay: true, weak: false, functions });
      }
    });
  }
  if (importBudget <= 0)
    warnings.push(`stopped after ${PE_LIMITS.importsTotal} imported functions`);

  // Exports
  const exports: ExportEntry[] = [];
  let exportName: string | null = null;
  const exportDir = dir(D.Export);
  if (exportDir) {
    attempt(warnings, 'exports', () => {
      const d = at(exportDir.rva, 'export directory');
      r.check(d, 40, 'export directory');
      exportName = strAt(r.u32(d + 12), 256) || null;
      const ordinalBase = r.u32(d + 16);
      const nFuncs = Math.min(r.u32(d + 20), PE_LIMITS.exports);
      const nNames = Math.min(r.u32(d + 24), PE_LIMITS.exports);
      if (r.u32(d + 20) > PE_LIMITS.exports) {
        warnings.push(`stopped after ${PE_LIMITS.exports} exports`);
      }
      const names = new Map<number, string>();
      if (nNames > 0) {
        const namesAt = at(r.u32(d + 32), 'export name table');
        const ordsAt = at(r.u32(d + 36), 'export ordinal table');
        for (let i = 0; i < nNames; i++) {
          if (!r.has(namesAt + i * 4, 4) || !r.has(ordsAt + i * 2, 2)) break;
          const index = r.u16(ordsAt + i * 2);
          if (!names.has(index)) names.set(index, strAt(r.u32(namesAt + i * 4), 512));
        }
      }
      const funcsAt = nFuncs > 0 ? at(r.u32(d + 28), 'export address table') : 0;
      for (let i = 0; i < nFuncs; i++) {
        if (!r.has(funcsAt + i * 4, 4)) break;
        const rva = r.u32(funcsAt + i * 4);
        if (rva === 0) continue;
        const forwards = rva >= exportDir.rva && rva < exportDir.rva + exportDir.size;
        exports.push({
          ordinal: ordinalBase + i,
          name: names.get(i) || null,
          address: rva,
          forwarder: forwards ? strAt(rva, 512) : null,
        });
      }
    });
  }

  // Resources
  const resources: ResourceLeaf[] = [];
  const resourceDir = dir(D.Resource);
  if (resourceDir) {
    attempt(warnings, 'resources', () => {
      const base = at(resourceDir.rva, 'resource directory');
      const visited = new Set<number>();
      const resName = (rel: number) => {
        const p = base + rel;
        const len = r.u16(p);
        return r.utf16(p + 2, Math.min(len, 256));
      };
      const walk = (rel: number, level: number, path: (string | number)[]) => {
        if (visited.has(rel) || level > 2) return;
        visited.add(rel);
        const d = base + rel;
        r.check(d, 16, 'resource directory');
        const count = r.u16(d + 12) + r.u16(d + 14);
        for (let i = 0; i < count; i++) {
          if (resources.length >= PE_LIMITS.resources) return;
          const e = d + 16 + i * 8;
          if (!r.has(e, 8)) return;
          const nameField = r.u32(e);
          const dataField = r.u32(e + 4);
          const key = nameField & 0x80000000 ? resName(nameField & 0x7fffffff) : nameField & 0xffff;
          if (dataField & 0x80000000) {
            if (level < 2) walk(dataField & 0x7fffffff, level + 1, [...path, key]);
            continue;
          }
          const leaf = base + dataField;
          if (!r.has(leaf, 16)) continue;
          const offset = offsetOf(r.u32(leaf));
          const size = r.u32(leaf + 4);
          if (offset === null) continue;
          const [type = 0, id = 0] = [...path, key];
          resources.push({
            type: typeof type === 'number' ? (RESOURCE_TYPES[type] ?? `#${type}`) : type,
            name: typeof id === 'number' ? `#${id}` : id,
            language: level === 2 && typeof key === 'number' ? key : 0,
            offset,
            size: Math.min(size, r.length - offset),
          });
        }
      };
      walk(0, 0, []);
      if (resources.length >= PE_LIMITS.resources) {
        warnings.push(`stopped after ${PE_LIMITS.resources} resources`);
      }
    });
  }
  const resourceBytes = (leaf: ResourceLeaf) => r.view(leaf.offset, leaf.size);

  const versionLeaf = resources.find(x => x.type === RT.version);
  const version = versionLeaf
    ? attempt(warnings, 'version info', () => parseVersionInfo(resourceBytes(versionLeaf)))
    : null;

  const iconGroups =
    attempt(warnings, 'icons', () => parseIconGroups(resources, resourceBytes)) ?? [];

  const manifestLeaf = resources.find(x => x.type === RT.manifest);
  const manifest = manifestLeaf ? decodeManifest(resourceBytes(manifestLeaf)) : null;
  const executionLevel =
    manifest && /requestedExecutionLevel[^>]*\blevel\s*=\s*["']([^"']+)["']/i.exec(manifest)?.[1];

  // Authenticode (the security directory holds a file offset, not an RVA)
  let signature: SignatureInfo | null = null;
  const security = dir(D.Security);
  if (security) signature = parseAuthenticode(r, security);

  // .NET
  let dotnet: PeInfo['dotnet'] = null;
  const clr = dir(D.Clr);
  if (clr) {
    dotnet = { runtime: null, version: '', flags: [] };
    const found = dotnet;
    attempt(warnings, '.NET header', () => {
      const c = at(clr.rva, 'CLR header');
      r.check(c, 24, 'CLR header');
      found.version = `${r.u16(c + 4)}.${r.u16(c + 6)}`;
      const flags = r.u32(c + 16);
      found.flags = flagNames(flags, [
        [0x1, 'IL only'],
        [0x2, '32-bit required'],
        [0x8, 'strong-name signed'],
        [0x10, 'native entry point'],
        [0x20000, '32-bit preferred'],
      ]);
      const md = offsetOf(r.u32(c + 8));
      if (md !== null && r.has(md, 16) && r.u32(md) === 0x424a5342) {
        found.runtime = r.cstr(md + 16, Math.min(r.u32(md + 12), 255)) || null;
      }
    });
  }

  // Debug directory: PDB path, and whether the build is reproducible
  let pdb: string | null = null;
  let reproducible = false;
  const debug = dir(D.Debug);
  if (debug) {
    attempt(warnings, 'debug directory', () => {
      const d = at(debug.rva, 'debug directory');
      const count = Math.min(Math.floor(debug.size / 28), 32);
      for (let i = 0; i < count; i++) {
        const e = d + i * 28;
        if (!r.has(e, 28)) break;
        const type = r.u32(e + 12);
        if (type === 16) reproducible = true;
        if (type === 2 && pdb === null) {
          const ptr = r.u32(e + 24);
          const size = r.u32(e + 16);
          if (size >= 24 && r.has(ptr, 24) && r.u32(ptr) === 0x53445352 /* RSDS */) {
            pdb = r.cstrUtf8(ptr + 24, Math.min(size - 24, 1024)) || null;
          }
        }
      }
    });
  }

  // Overlay: data after the last section, not counting a trailing certificate table
  let overlay: PeInfo['overlay'] = null;
  const lastEnd = Math.max(
    sizeOfHeaders,
    ...raw.filter(s => s.rawSize > 0).map(s => s.ptr + s.rawSize),
  );
  if (lastEnd < r.length) {
    let end = r.length;
    if (security && security.rva >= lastEnd && security.rva + security.size >= r.length - 8) {
      end = security.rva;
    }
    if (end > lastEnd) overlay = { offset: lastEnd, size: end - lastEnd };
  }

  const isDll = (chars & 0x2000) !== 0;
  const wdm = (dllChars & 0x2000) !== 0;
  const kernelImports = imports.some(i =>
    /^(ntoskrnl\.exe|hal\.dll|ndis\.sys|wdfldr\.sys)$/i.test(i.library),
  );
  return {
    format: 'pe',
    machine: MACHINES[machineId] ?? `machine 0x${machineId.toString(16)}`,
    bits,
    isDll,
    isDriver: wdm || (subsystemId === 1 && kernelImports),
    subsystem: SUBSYSTEMS[subsystemId] ?? `subsystem ${subsystemId}`,
    timestamp,
    timestampNote: timestampNote(timestamp, reproducible, now),
    entryPoint,
    imageBase: toHexAddress(imageBaseBig, bits === 64 ? 16 : 8),
    characteristics: flagNames(chars, CHARACTERISTICS),
    dllCharacteristics: flagNames(dllChars, DLL_CHARACTERISTICS),
    linkerVersion: `${r.u8(opt + 2)}.${String(r.u8(opt + 3)).padStart(2, '0')}`,
    osVersion: `${r.u16(opt + 40)}.${r.u16(opt + 42)}`,
    subsystemVersion: `${r.u16(opt + 48)}.${r.u16(opt + 50)}`,
    checksum,
    sizeOfImage,
    dotnet,
    pdb,
    sections,
    imports,
    exports,
    exportName,
    resources,
    version,
    iconGroups,
    manifest,
    executionLevel: executionLevel || null,
    signature,
    overlay,
    warnings,
  };
}

function parseAuthenticode(r: Reader, security: Dir): SignatureInfo {
  const info: SignatureInfo = {
    type: 'authenticode',
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
    const end = Math.min(r.length, security.rva + security.size);
    let p = security.rva;
    for (let i = 0; i < 8 && p + 8 <= end; i++) {
      const len = r.u32(p);
      const type = r.u16(p + 6);
      if (len < 8 || p + len > end) throw new FormatError('bad certificate table entry');
      if (type === 2 /* PKCS#7 SignedData */) {
        const blob = r.view(p + 8, len - 8);
        info.blob = { offset: p + 8, size: len - 8 };
        Object.assign(info, parseSignedData(blob, p + 8));
        return info;
      }
      p += align(len, 8);
    }
    throw new FormatError('no PKCS#7 signature in the certificate table');
  } catch (e) {
    info.error = e instanceof Error ? e.message : String(e);
    return info;
  }
}

interface VersionBlock {
  key: string;
  type: number;
  /** Value range within the resource. */
  value: { at: number; size: number };
  children: VersionBlock[];
  end: number;
}

function versionBlock(r: Reader, at: number, limit: number, depth: number): VersionBlock {
  const len = r.u16(at);
  if (len < 6) throw new FormatError('bad version block');
  const end = Math.min(at + len, limit);
  const valueLength = r.u16(at + 2);
  const type = r.u16(at + 4);
  const key = r.utf16z(at + 6, 64);
  const valueAt = align(key.end, 4);
  const valueSize = Math.min(
    Math.max(0, end - valueAt),
    type === 1 ? valueLength * 2 : valueLength,
  );
  const children: VersionBlock[] = [];
  let p = align(valueAt + valueSize, 4);
  while (depth < 4 && p + 6 <= end && children.length < 256) {
    const child = versionBlock(r, p, end, depth + 1);
    children.push(child);
    p = align(child.end, 4);
  }
  return { key: key.text, type, value: { at: valueAt, size: valueSize }, children, end };
}

export function parseVersionInfo(bytes: Uint8Array<ArrayBuffer>): VersionInfo {
  const r = new Reader(bytes);
  const root = versionBlock(r, 0, bytes.length, 0);
  if (root.key !== 'VS_VERSION_INFO') throw new FormatError('no VS_VERSION_INFO block');
  const info: VersionInfo = {
    fileVersion: null,
    productVersion: null,
    strings: {},
    translations: [],
  };
  const f = root.value.at;
  if (root.value.size >= 52 && r.has(f, 52) && r.u32(f) === 0xfeef04bd) {
    info.fileVersion = versionText(r.u32(f + 8), r.u32(f + 12));
    info.productVersion = versionText(r.u32(f + 16), r.u32(f + 20));
  }
  // Some writers count wValueLength in bytes, some in characters: read up to a NUL or the block's end
  const text = (b: VersionBlock) =>
    r.utf16z(b.value.at, Math.floor(Math.max(0, b.end - b.value.at) / 2)).text.trim();
  for (const child of root.children) {
    if (child.key === 'StringFileInfo') {
      const table = child.children[0];
      for (const s of table?.children ?? []) {
        if (!(s.key in info.strings)) info.strings[s.key] = s.value.size > 0 ? text(s) : '';
      }
    } else if (child.key === 'VarFileInfo') {
      for (const v of child.children) {
        if (v.key !== 'Translation') continue;
        for (let i = 0; i + 4 <= v.value.size && i < 64; i += 4) {
          const hex = (n: number) => n.toString(16).toUpperCase().padStart(4, '0');
          info.translations.push(`${hex(r.u16(v.value.at + i))} ${hex(r.u16(v.value.at + i + 2))}`);
        }
      }
    }
  }
  return info;
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
export const isPngData = (b: Uint8Array) => b.length >= 8 && PNG_SIG.every((v, i) => b[i] === v);

/** Real dimensions from a PNG's IHDR or a DIB's header; null when unreadable. */
function imageSize(b: Uint8Array<ArrayBuffer>): { width: number; height: number } | null {
  const r = new Reader(b);
  if (isPngData(b)) {
    if (!r.has(16, 8)) return null;
    const be = r.withEndian(false);
    return { width: be.u32(16), height: be.u32(20) };
  }
  if (!r.has(0, 16) || r.u32(0) < 12) return null;
  return { width: Math.abs(r.i32(4)), height: Math.abs(r.i32(8)) / 2 };
}

export function parseIconGroups(
  resources: ResourceLeaf[],
  data: (leaf: ResourceLeaf) => Uint8Array<ArrayBuffer>,
): IconGroup[] {
  const icons = new Map<string, ResourceLeaf>();
  for (const leaf of resources) {
    if (leaf.type === RT.icon && !icons.has(leaf.name)) icons.set(leaf.name, leaf);
  }
  const groups: IconGroup[] = [];
  for (const leaf of resources) {
    if (leaf.type !== RT.iconGroup) continue;
    if (groups.length >= PE_LIMITS.iconGroups) break;
    const r = new Reader(data(leaf));
    if (!r.has(0, 6) || r.u16(2) !== 1) continue;
    const count = Math.min(r.u16(4), PE_LIMITS.iconsPerGroup);
    const images: IconGroup['images'] = [];
    for (let i = 0; i < count; i++) {
      const e = 6 + i * 14;
      if (!r.has(e, 14)) break;
      const icon = icons.get(`#${r.u16(e + 12)}`);
      if (!icon || icon.size === 0) continue;
      const bytes = data(icon);
      const size = imageSize(bytes);
      images.push({
        width: size?.width || r.u8(e) || 256,
        height: size?.height || r.u8(e + 1) || 256,
        bitCount: r.u16(e + 6),
        offset: icon.offset,
        size: icon.size,
        png: isPngData(bytes),
      });
    }
    if (images.length > 0) groups.push({ name: leaf.name, images });
  }
  return groups;
}

function decodeManifest(b: Uint8Array): string {
  const capped = b.subarray(0, 1 << 20);
  if (capped[0] === 0xff && capped[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(capped.subarray(2));
  }
  return new TextDecoder()
    .decode(capped)
    .replace(/^\uFEFF/, '')
    .replace(/\0+$/, '');
}
