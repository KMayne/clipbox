/** ELF (Linux, BSD, Android…) parsing: header, program headers, sections, dynamic section, notes. */

import { attempt, entropy, FormatError, PACKED_ENTROPY, Reader } from './reader';
import type { ElfInfo, ExecSection, ExportEntry } from './types';

export const ELF_LIMITS = { sections: 4096, segments: 1024, dynamic: 8192, symbols: 65_536 };

const MACHINES: Record<number, string> = {
  0: 'none',
  2: 'SPARC',
  3: 'x86',
  4: 'Motorola 68000',
  8: 'MIPS',
  20: 'PowerPC',
  21: 'PowerPC64',
  22: 'S390',
  40: 'ARM',
  42: 'SuperH',
  43: 'SPARC V9',
  50: 'IA-64',
  62: 'x86-64',
  83: 'AVR',
  183: 'AArch64',
  243: 'RISC-V',
  247: 'BPF',
  258: 'LoongArch',
};

const OS_ABIS: Record<number, string> = {
  0: 'System V',
  1: 'HP-UX',
  2: 'NetBSD',
  3: 'Linux',
  6: 'Solaris',
  7: 'AIX',
  8: 'IRIX',
  9: 'FreeBSD',
  12: 'OpenBSD',
  97: 'ARM',
  255: 'standalone',
};

/** `\x7fELF` with a valid class, data encoding and version. */
export function isElf(b: Uint8Array): boolean {
  return (
    b.length >= 52 &&
    b[0] === 0x7f &&
    b[1] === 0x45 &&
    b[2] === 0x4c &&
    b[3] === 0x46 &&
    (b[4] === 1 || b[4] === 2) &&
    (b[5] === 1 || b[5] === 2) &&
    b[6] === 1
  );
}

const PT = { load: 1, dynamic: 2, interp: 3, note: 4, gnuStack: 0x6474e551, gnuRelro: 0x6474e552 };
const SHT = { symtab: 2, strtab: 3, dynamic: 6, note: 7, nobits: 8, dynsym: 11 };
const DT = {
  null: 0,
  needed: 1,
  strtab: 5,
  soname: 14,
  rpath: 15,
  runpath: 29,
  flags1: 0x6ffffffb,
};

const hex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');

function sectionFlags(f: number): string {
  const rwx = `R${f & 1 ? 'W' : '-'}${f & 4 ? 'X' : '-'}`;
  return f & 2 ? rwx : '---';
}

export function parseElf(bytes: Uint8Array<ArrayBuffer>): ElfInfo {
  if (!isElf(bytes)) throw new FormatError('not an ELF file');
  const bits = bytes[4] === 2 ? 64 : 32;
  const littleEndian = bytes[5] === 1;
  const r = new Reader(bytes, littleEndian);
  const warnings: string[] = [];
  const is64 = bits === 64;
  r.check(0, is64 ? 64 : 52, 'ELF header');
  const word = (o: number) => (is64 ? r.u64(o) : r.u32(o));

  const typeId = r.u16(16);
  const machineId = r.u16(18);
  const entryPoint = word(24);
  const phoff = word(is64 ? 32 : 28);
  const shoff = word(is64 ? 40 : 32);
  const phentsize = r.u16(is64 ? 54 : 42);
  let phnum = r.u16(is64 ? 56 : 44);
  const shentsize = r.u16(is64 ? 58 : 46);
  let shnum = r.u16(is64 ? 60 : 48);
  let shstrndx = r.u16(is64 ? 62 : 50);

  // Extended numbering: the real counts live in section 0
  if (shoff > 0 && r.has(shoff, is64 ? 64 : 40)) {
    if (shnum === 0) shnum = word(shoff + (is64 ? 32 : 20));
    if (shstrndx === 0xffff) shstrndx = r.u32(shoff + (is64 ? 40 : 24));
    if (phnum === 0xffff) phnum = r.u32(shoff + (is64 ? 44 : 28));
  }

  // Program headers
  interface Segment {
    type: number;
    flags: number;
    offset: number;
    vaddr: number;
    filesz: number;
  }
  const segments: Segment[] = [];
  if (phoff > 0 && phentsize >= (is64 ? 56 : 32)) {
    for (let i = 0; i < Math.min(phnum, ELF_LIMITS.segments); i++) {
      const p = phoff + i * phentsize;
      if (!r.has(p, is64 ? 56 : 32)) {
        warnings.push(`program headers are truncated after ${i} of ${phnum}`);
        break;
      }
      segments.push(
        is64
          ? {
              type: r.u32(p),
              flags: r.u32(p + 4),
              offset: r.u64(p + 8),
              vaddr: r.u64(p + 16),
              filesz: r.u64(p + 32),
            }
          : {
              type: r.u32(p),
              offset: r.u32(p + 4),
              vaddr: r.u32(p + 8),
              filesz: r.u32(p + 16),
              flags: r.u32(p + 24),
            },
      );
    }
  }
  const vaddrToOffset = (va: number): number | null => {
    for (const s of segments) {
      if (s.type === PT.load && va >= s.vaddr && va < s.vaddr + s.filesz)
        return s.offset + (va - s.vaddr);
    }
    return null;
  };

  // Section headers
  interface RawSection {
    name: number;
    type: number;
    flags: number;
    addr: number;
    offset: number;
    size: number;
    link: number;
    entsize: number;
  }
  const raw: RawSection[] = [];
  if (shoff > 0 && shentsize >= (is64 ? 64 : 40)) {
    if (shnum > ELF_LIMITS.sections)
      warnings.push(`${shnum} sections; read the first ${ELF_LIMITS.sections}`);
    for (let i = 0; i < Math.min(shnum, ELF_LIMITS.sections); i++) {
      const s = shoff + i * shentsize;
      if (!r.has(s, is64 ? 64 : 40)) {
        warnings.push(`section headers are truncated after ${i} of ${shnum}`);
        break;
      }
      raw.push(
        is64
          ? {
              name: r.u32(s),
              type: r.u32(s + 4),
              flags: r.u64(s + 8),
              addr: r.u64(s + 16),
              offset: r.u64(s + 24),
              size: r.u64(s + 32),
              link: r.u32(s + 40),
              entsize: r.u64(s + 56),
            }
          : {
              name: r.u32(s),
              type: r.u32(s + 4),
              flags: r.u32(s + 8),
              addr: r.u32(s + 12),
              offset: r.u32(s + 16),
              size: r.u32(s + 20),
              link: r.u32(s + 24),
              entsize: r.u32(s + 36),
            },
      );
    }
  }
  const names = raw[shstrndx];
  const sectionName = (s: RawSection) =>
    names && s.name < names.size ? r.cstr(names.offset + s.name, 256) : '';

  const sections: ExecSection[] = raw.slice(1).map(s => {
    const name = sectionName(s);
    const hasData = s.type !== SHT.nobits && s.size > 0;
    if (hasData && !r.has(s.offset, s.size))
      warnings.push(`section ${name} runs past the end of the file`);
    const h = hasData ? entropy(r.view(s.offset, s.size)) : null;
    return {
      name,
      group: null,
      address: s.addr,
      virtualSize: s.size,
      rawOffset: s.offset,
      rawSize: s.type === SHT.nobits ? 0 : s.size,
      flags: sectionFlags(s.flags),
      entropy: h,
      packed:
        name.toUpperCase().startsWith('UPX') || (h !== null && h > PACKED_ENTROPY && s.size >= 256),
    };
  });
  const sectionNames = new Set(sections.map(s => s.name));

  const interp = segments.find(s => s.type === PT.interp);
  const interpreter = interp ? r.cstr(interp.offset, Math.min(interp.filesz, 1024)) || null : null;

  // Dynamic section
  const needed: string[] = [];
  let soname: string | null = null;
  let runpath: string | null = null;
  let pieFlag = false;
  attempt(warnings, 'dynamic section', () => {
    const dynSection = raw.find(s => s.type === SHT.dynamic);
    const dynSegment = segments.find(s => s.type === PT.dynamic);
    const where = dynSection
      ? { offset: dynSection.offset, size: dynSection.size }
      : dynSegment
        ? { offset: dynSegment.offset, size: dynSegment.filesz }
        : null;
    if (!where) return;
    const entSize = is64 ? 16 : 8;
    const entries: [number, number][] = [];
    for (let i = 0; i < Math.min(Math.floor(where.size / entSize), ELF_LIMITS.dynamic); i++) {
      const e = where.offset + i * entSize;
      if (!r.has(e, entSize)) break;
      const tag = word(e);
      if (tag === DT.null) break;
      entries.push([tag, word(e + entSize / 2)]);
    }
    const linked = dynSection ? raw[dynSection.link] : undefined;
    const strtabVa = entries.find(([t]) => t === DT.strtab)?.[1];
    const strtab =
      linked?.type === SHT.strtab
        ? linked.offset
        : strtabVa !== undefined
          ? vaddrToOffset(strtabVa)
          : null;
    const str = (o: number) => (strtab === null ? `string #${o}` : r.cstr(strtab + o, 1024));
    for (const [tag, val] of entries) {
      if (tag === DT.needed) needed.push(str(val));
      else if (tag === DT.soname) soname = str(val);
      else if (tag === DT.runpath || (tag === DT.rpath && runpath === null)) runpath = str(val);
      else if (tag === DT.flags1 && val & 0x08000000) pieFlag = true;
    }
  });

  // Build ID: a GNU note of type 3, from a note section or segment
  let buildId: string | null = null;
  const notes = [
    ...raw.filter(s => s.type === SHT.note).map(s => ({ offset: s.offset, size: s.size })),
    ...segments.filter(s => s.type === PT.note).map(s => ({ offset: s.offset, size: s.filesz })),
  ];
  for (const n of notes) {
    if (buildId) break;
    attempt(warnings, 'notes', () => {
      let p = n.offset;
      const end = Math.min(r.length, n.offset + n.size);
      for (let i = 0; i < 64 && p + 12 <= end; i++) {
        const namesz = r.u32(p);
        const descsz = r.u32(p + 4);
        const type = r.u32(p + 8);
        const nameAt = p + 12;
        const descAt = nameAt + Math.ceil(namesz / 4) * 4;
        if (descAt + descsz > end) break;
        if (type === 3 && namesz === 4 && r.cstr(nameAt, 4) === 'GNU') {
          buildId = hex(r.view(descAt, Math.min(descsz, 64)));
          return;
        }
        p = descAt + Math.ceil(descsz / 4) * 4;
      }
    });
  }

  // Exported dynamic symbols: defined, global or weak functions and objects
  const exports: ExportEntry[] = [];
  attempt(warnings, 'dynamic symbols', () => {
    const dynsym = raw.find(s => s.type === SHT.dynsym);
    const strtab = dynsym ? raw[dynsym.link] : undefined;
    if (!dynsym || !strtab) return;
    const size = is64 ? 24 : 16;
    const count = Math.min(Math.floor(dynsym.size / size), ELF_LIMITS.symbols);
    for (let i = 1; i < count; i++) {
      const s = dynsym.offset + i * size;
      if (!r.has(s, size)) break;
      const nameOff = r.u32(s);
      const info = is64 ? r.u8(s + 4) : r.u8(s + 12);
      const shndx = is64 ? r.u16(s + 6) : r.u16(s + 14);
      const value = is64 ? r.u64(s + 8) : r.u32(s + 4);
      const bind = info >> 4;
      const type = info & 0xf;
      if (shndx === 0 || (bind !== 1 && bind !== 2) || (type !== 1 && type !== 2)) continue;
      exports.push({
        ordinal: null,
        name: r.cstr(strtab.offset + nameOff, 512) || null,
        address: value,
        forwarder: null,
      });
    }
  });

  const gnuStack = segments.find(s => s.type === PT.gnuStack);
  const hasInterp = interpreter !== null;
  const type =
    typeId === 1
      ? 'relocatable object'
      : typeId === 2
        ? 'executable'
        : typeId === 3
          ? hasInterp || pieFlag
            ? 'PIE executable'
            : 'shared library'
          : typeId === 4
            ? 'core dump'
            : `type ${typeId}`;
  return {
    format: 'elf',
    bits,
    littleEndian,
    machine: MACHINES[machineId] ?? `machine ${machineId}`,
    osAbi: OS_ABIS[bytes[7] ?? 0] ?? `ABI ${bytes[7] ?? 0}`,
    type,
    entryPoint,
    interpreter,
    soname,
    needed,
    runpath,
    sections,
    exports,
    stripped: raw.length > 0 && !raw.some(s => s.type === SHT.symtab),
    debugInfo: [...sectionNames].some(n => n.startsWith('.debug_') || n.startsWith('.zdebug_')),
    buildId,
    executableStack: gnuStack ? (gnuStack.flags & 1) !== 0 : null,
    relro: segments.some(s => s.type === PT.gnuRelro),
    warnings,
  };
}
