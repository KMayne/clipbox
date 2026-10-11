/** Turns parsed executables into labels, sidebar stats and the preview's display model. */

import { formatBytes, formatCount, plural } from '../format';
import type { StatRow } from '../types';
import { parseElf, isElf } from './elf';
import { buildIco, iconToPng } from './icon';
import { isFat, isMacho, parseFat, parseMacho } from './macho';
import { isPe, parsePe } from './pe';
import { displayName } from './pkcs7';
import { FormatError, PACKED_ENTROPY, toHexAddress } from './reader';
import type {
  ExecInfo,
  ExecSection,
  ExecutableLayout,
  ExecutableValue,
  ExportEntry,
  IconImage,
  ImportGroup,
  MachoInfo,
  PeInfo,
  SignatureInfo,
} from './types';

export type ExecFormat = ExecInfo['format'];

/** Cheap magic-byte check: a few reads, no parsing. */
export function executableFormat(b: Uint8Array): ExecFormat | null {
  if (isPe(b)) return 'pe';
  if (isElf(b)) return 'elf';
  if (isMacho(b)) return 'macho';
  if (isFat(b)) return 'fat';
  return null;
}

const FORMAT_WORDS: Record<ExecFormat, string> = {
  pe: 'Windows executable',
  elf: 'ELF file',
  macho: 'Mach-O file',
  fat: 'Universal binary',
};

/** Never throws for detected content: a failed parse becomes a value carrying the error. */
export function parseExecutable(bytes: Uint8Array<ArrayBuffer>, now = Date.now()): ExecutableValue {
  const format = executableFormat(bytes);
  if (!format) throw new FormatError('not an executable');
  try {
    const info =
      format === 'pe'
        ? parsePe(bytes, now)
        : format === 'elf'
          ? parseElf(bytes)
          : format === 'macho'
            ? parseMacho(bytes)
            : parseFat(bytes);
    return { kind: 'executable', bytes, info, error: null, format };
  } catch (e) {
    return {
      kind: 'executable',
      bytes,
      info: null,
      error: e instanceof Error ? e.message : String(e),
      format,
    };
  }
}

const dateText = (ts: number) =>
  `${new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 19)} UTC`;

/** "1.2.3.0" → "1.2.3"; keeps only the leading version number of strings like "1.2 (beta)". */
export function shortVersion(v: string | null | undefined): string | null {
  const s = v?.trim();
  if (!s) return null;
  const m = /^\d+(?:[.,]\s?\d+)*/.exec(s);
  if (!m) return s.length > 24 ? `${s.slice(0, 23)}…` : s;
  const parts = m[0].replace(/,\s?/g, '.').split('.');
  if (parts.length === 4 && parts[3] === '0') parts.pop();
  return parts.join('.');
}

function peTypeWord(i: PeInfo): string {
  if (i.isDriver) return 'driver';
  if (i.isDll) return 'DLL';
  if (i.subsystem.startsWith('EFI')) return i.subsystem;
  if (i.subsystem === 'GUI') return 'GUI app';
  if (i.subsystem === 'console') return 'console app';
  if (i.subsystem === 'native') return 'native app';
  return 'executable';
}

function peNames(i: PeInfo) {
  const s = i.version?.strings ?? {};
  return {
    product: s.ProductName?.trim() || null,
    company: s.CompanyName?.trim() || null,
    description: s.FileDescription?.trim() || null,
    version: shortVersion(
      s.ProductVersion || s.FileVersion || i.version?.productVersion || i.version?.fileVersion,
    ),
  };
}

const elfOs = (i: { osAbi: string; interpreter: string | null }) =>
  i.interpreter?.includes('android')
    ? 'Android'
    : i.osAbi === 'System V' || i.osAbi === 'Linux'
      ? 'Linux'
      : i.osAbi === 'standalone'
        ? ''
        : i.osAbi;

const machoPlatform = (i: MachoInfo) => i.platform ?? 'macOS';

export function executableLabel(v: ExecutableValue): string {
  const i = v.info;
  if (!i) return `${FORMAT_WORDS[v.format]} (malformed: ${v.error ?? 'unreadable'})`;
  switch (i.format) {
    case 'pe': {
      const n = peNames(i);
      const head = `Windows ${i.machine}${i.dotnet ? ' .NET' : ''} ${peTypeWord(i)}`;
      return [
        head,
        ...(n.company ? [n.company] : []),
        ...(n.version ? [`v${n.version}`] : []),
      ].join(' · ');
    }
    case 'elf':
      return [elfOs(i), i.machine, 'ELF', i.type].filter(Boolean).join(' ');
    case 'macho':
      return `${machoPlatform(i)} ${i.cpu} ${i.fileType}`;
    case 'fat': {
      const first = i.slices.find(s => s.info)?.info;
      const platform = first ? machoPlatform(first) : 'macOS';
      return `${platform} universal (${i.slices.map(s => s.cpu).join(', ')})`;
    }
  }
}

function signing(sig: SignatureInfo | null): ExecutableLayout['signing'] {
  if (!sig) return { state: 'unsigned', text: 'Not signed' };
  if (sig.adhoc && !sig.signer) return { state: 'adhoc', text: 'Ad-hoc signed (no certificate)' };
  if (sig.signer) {
    return { state: 'signed', text: `Signed by ${displayName(sig.signer.subject)} (not verified)` };
  }
  return {
    state: 'signed',
    text: sig.error
      ? `Signature present, unreadable (${sig.error})`
      : 'Signature present (not verified)',
  };
}

const sigRows = (sig: SignatureInfo | null, text: string): ExecutableLayout['header'] => {
  if (!sig) return [{ label: 'Signature', value: text }];
  return [
    { label: 'Signature', value: text },
    ...(sig.identifier ? [{ label: 'Signing identifier', value: sig.identifier }] : []),
    ...(sig.signer ? [{ label: 'Signer', value: sig.signer.subject }] : []),
    ...(sig.signer ? [{ label: 'Issuer', value: sig.signer.issuer }] : []),
    ...(sig.signer?.notBefore && sig.signer.notAfter
      ? [
          {
            label: 'Certificate valid',
            value: `${sig.signer.notBefore.slice(0, 10)} to ${sig.signer.notAfter.slice(0, 10)}`,
          },
        ]
      : []),
    ...(sig.digest ? [{ label: 'Digest', value: sig.digest }] : []),
    ...(sig.certificates.length > 0
      ? [{ label: 'Certificates', value: formatCount(sig.certificates.length) }]
      : []),
  ];
};

const libraries = (n: number) => `${formatCount(n)} ${n === 1 ? 'library' : 'libraries'}`;

function sum(groups: ImportGroup[]) {
  return groups.reduce((n, g) => n + g.functions.length, 0);
}

function machoSlices(info: ExecInfo): { cpu: string; info: MachoInfo }[] {
  if (info.format === 'macho') return [{ cpu: info.cpu, info }];
  if (info.format === 'fat')
    return info.slices.flatMap(s => (s.info ? [{ cpu: s.cpu, info: s.info }] : []));
  return [];
}

function dylibGroups(slices: { info: MachoInfo }[]): ImportGroup[] {
  const seen = new Map<string, ImportGroup>();
  for (const { info } of slices) {
    for (const d of info.dylibs) {
      if (!seen.has(d.name))
        seen.set(d.name, { library: d.name, delay: false, weak: d.how !== 'load', functions: [] });
    }
  }
  return [...seen.values()];
}

/** The icon images of the first group, largest first (by area, then colour depth). */
export function iconImages(v: ExecutableValue): IconImage[] {
  const group = v.info?.format === 'pe' ? v.info.iconGroups[0] : undefined;
  return group
    ? [...group.images].sort(
        (a, b) => b.width * b.height - a.width * a.height || b.bitCount - a.bitCount,
      )
    : [];
}

/** The largest icon image that decodes, as PNG. */
export function largestIconPng(v: ExecutableValue): Uint8Array<ArrayBuffer> {
  let lastError: unknown = new Error('This file has no icon');
  for (const img of iconImages(v)) {
    try {
      return iconToPng(v.bytes.slice(img.offset, img.offset + img.size));
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

/** The first icon group as a `.ico` file, largest image first (what viewers show by default). */
export function iconFile(v: ExecutableValue): Uint8Array<ArrayBuffer> {
  const images = iconImages(v);
  if (images.length === 0) throw new Error('This file has no icon');
  return buildIco(
    images.map(img => ({
      width: img.width,
      height: img.height,
      bitCount: img.bitCount,
      data: v.bytes.subarray(img.offset, img.offset + img.size),
    })),
  );
}

function versionRows(i: PeInfo): ExecutableLayout['versionInfo'] {
  const v = i.version;
  if (!v) return [];
  return [
    ...(v.fileVersion ? [{ label: 'File version (fixed)', value: v.fileVersion }] : []),
    ...(v.productVersion ? [{ label: 'Product version (fixed)', value: v.productVersion }] : []),
    ...Object.entries(v.strings).map(([label, value]) => ({ label, value })),
    ...(v.translations.length ? [{ label: 'Translation', value: v.translations.join(', ') }] : []),
  ];
}

const has = (list: string[], name: string) => list.includes(name);

function peLayout(i: PeInfo, title: string, fileSize: number): ExecutableLayout {
  const n = peNames(i);
  const sig = signing(i.signature);
  const security = ['ASLR', 'DEP (NX)', 'Control Flow Guard', 'High-entropy VA'];
  const present = security.filter(s => has(i.dllCharacteristics, s));
  const missing = security.filter(
    s => !has(i.dllCharacteristics, s) && !(s === 'High-entropy VA' && i.bits === 32),
  );
  const resources = new Map<string, { count: number; bytes: number }>();
  for (const r of i.resources) {
    const e = resources.get(r.type) ?? { count: 0, bytes: 0 };
    e.count++;
    e.bytes += r.size;
    resources.set(r.type, e);
  }
  const packed = i.sections.some(s => s.packed);
  return {
    title,
    formatName: i.bits === 64 ? 'PE32+ (64-bit)' : 'PE32 (32-bit)',
    ...n,
    arch: [i.machine],
    badges: [
      ...(i.dotnet ? [{ text: '.NET', tone: 'neutral' as const }] : []),
      ...present.map(s => ({ text: s.replace(' (NX)', ''), tone: 'good' as const })),
      ...(has(i.dllCharacteristics, 'ASLR') ? [] : [{ text: 'No ASLR', tone: 'warn' as const }]),
      ...(packed ? [{ text: 'Packed?', tone: 'warn' as const }] : []),
      ...(i.overlay ? [{ text: 'Overlay', tone: 'neutral' as const }] : []),
    ],
    signing: sig,
    hasIcon: i.iconGroups.length > 0,
    header: [
      { label: 'Format', value: i.bits === 64 ? 'PE32+ (64-bit)' : 'PE32 (32-bit)' },
      { label: 'Machine', value: i.machine },
      { label: 'Type', value: i.isDll ? 'DLL' : i.isDriver ? 'Driver' : 'Executable' },
      { label: 'Subsystem', value: `${i.subsystem} (${i.subsystemVersion})` },
      {
        label: 'Linker timestamp',
        value:
          i.timestamp === 0
            ? 'not set'
            : `${dateText(i.timestamp)}${i.timestampNote ? ` (${i.timestampNote})` : ''}`,
      },
      { label: 'Entry point', value: toHexAddress(i.entryPoint) },
      { label: 'Image base', value: i.imageBase },
      {
        label: 'Security',
        value: [
          present.join(', ') || 'none',
          ...(missing.length ? [`missing: ${missing.join(', ')}`] : []),
        ].join(' · '),
      },
      ...(i.dotnet
        ? [
            {
              label: '.NET',
              value: [`CLR ${i.dotnet.version}`, i.dotnet.runtime, ...i.dotnet.flags]
                .filter(Boolean)
                .join(' · '),
            },
          ]
        : []),
      ...sigRows(i.signature, sig.text),
      ...(i.executionLevel ? [{ label: 'Execution level', value: i.executionLevel }] : []),
      ...(i.overlay
        ? [
            {
              label: 'Overlay',
              value: `${formatBytes(i.overlay.size)} at ${toHexAddress(i.overlay.offset)}`,
            },
          ]
        : []),
      ...(i.exportName ? [{ label: 'Export name', value: i.exportName }] : []),
      ...(i.pdb ? [{ label: 'PDB', value: i.pdb }] : []),
      { label: 'Linker version', value: i.linkerVersion },
      { label: 'OS version', value: i.osVersion },
      { label: 'Size of image', value: formatBytes(i.sizeOfImage) },
      { label: 'Checksum', value: i.checksum ? toHexAddress(i.checksum) : 'not set' },
      { label: 'Characteristics', value: i.characteristics.join(', ') || 'none' },
      { label: 'DLL characteristics', value: i.dllCharacteristics.join(', ') || 'none' },
      { label: 'File size', value: formatBytes(fileSize) },
    ],
    sections: i.sections,
    imports: i.imports,
    exports: i.exports,
    resources: [...resources].map(([type, e]) => ({ type, ...e })),
    icons: i.iconGroups[0]?.images ?? [],
    versionInfo: versionRows(i),
    manifest: i.manifest,
    warnings: i.warnings,
  };
}

function emptyLayout(
  title: string,
): Omit<ExecutableLayout, 'formatName' | 'header' | 'arch' | 'signing'> {
  return {
    title,
    product: null,
    version: null,
    company: null,
    description: null,
    badges: [],
    hasIcon: false,
    sections: [],
    imports: [],
    exports: [],
    resources: [],
    icons: [],
    versionInfo: [],
    manifest: null,
    warnings: [],
  };
}

function machoHeader(i: MachoInfo): ExecutableLayout['header'] {
  return [
    { label: 'CPU', value: `${i.cpu} (${i.bits}-bit)` },
    { label: 'File type', value: i.fileType },
    ...(i.platform ? [{ label: 'Platform', value: i.platform }] : []),
    ...(i.minOs ? [{ label: 'Minimum OS', value: i.minOs }] : []),
    ...(i.sdk ? [{ label: 'SDK', value: i.sdk }] : []),
    ...(i.installName ? [{ label: 'Install name', value: i.installName }] : []),
    ...(i.uuid ? [{ label: 'UUID', value: i.uuid }] : []),
    ...(i.entryPoint !== null
      ? [{ label: 'Entry point', value: `${toHexAddress(i.entryPoint)} (offset)` }]
      : []),
    ...(i.encrypted !== null
      ? [{ label: 'Encrypted', value: i.encrypted ? 'yes (App Store FairPlay)' : 'no' }]
      : []),
    { label: 'Linked libraries', value: formatCount(i.dylibs.length) },
    ...(i.rpaths.length ? [{ label: 'Run paths', value: i.rpaths.join(', ') }] : []),
    { label: 'Flags', value: i.flags.join(', ') || 'none' },
  ];
}

export function executableLayout(v: ExecutableValue): ExecutableLayout {
  const title = executableLabel(v);
  const i = v.info;
  if (!i) {
    return {
      ...emptyLayout(title),
      formatName: FORMAT_WORDS[v.format],
      arch: [],
      signing: { state: 'unsigned', text: 'Unknown' },
      header: [
        { label: 'Error', value: v.error ?? 'unreadable' },
        { label: 'File size', value: formatBytes(v.bytes.byteLength) },
      ],
      warnings: [v.error ?? 'unreadable'],
    };
  }
  switch (i.format) {
    case 'pe':
      return peLayout(i, title, v.bytes.byteLength);
    case 'elf':
      return {
        ...emptyLayout(title),
        formatName: `ELF${i.bits}`,
        arch: [i.machine],
        badges: [
          ...(i.type === 'PIE executable' ? [{ text: 'PIE', tone: 'good' as const }] : []),
          ...(i.relro ? [{ text: 'RELRO', tone: 'good' as const }] : []),
          ...(i.executableStack ? [{ text: 'Executable stack', tone: 'warn' as const }] : []),
          ...(i.stripped ? [{ text: 'Stripped', tone: 'neutral' as const }] : []),
          ...(i.debugInfo ? [{ text: 'Debug info', tone: 'neutral' as const }] : []),
          ...(i.sections.some(s => s.packed) ? [{ text: 'Packed?', tone: 'warn' as const }] : []),
        ],
        signing: { state: 'unsigned', text: 'Not signed' },
        header: [
          { label: 'Class', value: `ELF${i.bits} (${i.bits}-bit)` },
          { label: 'Endianness', value: i.littleEndian ? 'little-endian' : 'big-endian' },
          { label: 'Machine', value: i.machine },
          { label: 'OS ABI', value: i.osAbi },
          { label: 'Type', value: i.type },
          { label: 'Entry point', value: toHexAddress(i.entryPoint) },
          ...(i.interpreter ? [{ label: 'Interpreter', value: i.interpreter }] : []),
          ...(i.soname ? [{ label: 'SONAME', value: i.soname }] : []),
          { label: 'Needed libraries', value: formatCount(i.needed.length) },
          ...(i.runpath ? [{ label: 'Run path', value: i.runpath }] : []),
          { label: 'Stripped', value: i.stripped ? 'yes' : 'no' },
          { label: 'Debug info', value: i.debugInfo ? 'yes' : 'no' },
          ...(i.buildId ? [{ label: 'Build ID', value: i.buildId }] : []),
          ...(i.executableStack !== null
            ? [{ label: 'Executable stack', value: i.executableStack ? 'yes' : 'no' }]
            : []),
          { label: 'RELRO', value: i.relro ? 'yes' : 'no' },
          { label: 'File size', value: formatBytes(v.bytes.byteLength) },
        ],
        sections: i.sections,
        imports: i.needed.map(library => ({ library, delay: false, weak: false, functions: [] })),
        exports: i.exports,
        warnings: i.warnings,
      };
    case 'macho':
    case 'fat': {
      const slices = machoSlices(i);
      const first = slices[0]?.info ?? null;
      const signature = slices.find(s => s.info.signature)?.info.signature ?? null;
      const sig = signing(signature);
      const fat = i.format === 'fat';
      const sections: ExecSection[] = slices.flatMap(s =>
        s.info.sections.map(x => ({
          ...x,
          group: fat ? `${s.cpu} ${x.group ?? ''}`.trim() : x.group,
        })),
      );
      const header: ExecutableLayout['header'] = fat
        ? [
            {
              label: 'Format',
              value: `Universal binary, ${plural(i.slices.length, 'architecture')}`,
            },
            ...i.slices.flatMap(s => [
              {
                label: `Slice ${s.cpu}`,
                value: s.info
                  ? `${s.info.fileType} · ${formatBytes(s.size)} at ${toHexAddress(s.offset)}`
                  : `unreadable: ${s.error ?? ''}`,
              },
            ]),
            ...(first ? machoHeader(first).filter(r => r.label !== 'CPU') : []),
          ]
        : first
          ? machoHeader(first)
          : [];
      return {
        ...emptyLayout(title),
        formatName: fat ? 'Mach-O universal' : `Mach-O ${first?.bits ?? ''}-bit`,
        arch: fat ? i.slices.map(s => s.cpu) : [first?.cpu ?? 'unknown'],
        badges: [
          ...(first?.flags.includes('PIE') ? [{ text: 'PIE', tone: 'good' as const }] : []),
          ...(first?.encrypted ? [{ text: 'Encrypted', tone: 'warn' as const }] : []),
          ...(sections.some(s => s.packed) ? [{ text: 'Packed?', tone: 'warn' as const }] : []),
        ],
        signing: sig,
        header: [
          ...header,
          ...sigRows(signature, sig.text),
          { label: 'File size', value: formatBytes(v.bytes.byteLength) },
        ],
        sections,
        imports: dylibGroups(slices),
        warnings: [
          ...i.warnings,
          ...slices.flatMap(s => s.info.warnings.map(w => `${s.cpu}: ${w}`)),
        ],
      };
    }
  }
}

/** Key facts for the sidebar's Info section. */
export function executableStats(v: ExecutableValue, layout = executableLayout(v)): StatRow[] {
  const pick = (label: string) => layout.header.find(r => r.label === label);
  const rows: StatRow[] = [];
  const add = (label: string, value: string | null | undefined) => {
    if (value) rows.push({ label, value });
  };
  add('Product', layout.product);
  add('Version', layout.version);
  add('Company', layout.company);
  add('Description', layout.description);
  add('Format', layout.formatName);
  add('Architecture', layout.arch.join(', '));
  for (const label of [
    'Type',
    'Subsystem',
    'File type',
    'Platform',
    'Minimum OS',
    'Linker timestamp',
    'Entry point',
    'Security',
    '.NET',
    'Interpreter',
    'Build ID',
    'Stripped',
    'Overlay',
  ]) {
    add(label, pick(label)?.value);
  }
  add('Signature', layout.signing.text);
  add('Sections', layout.sections.length ? formatCount(layout.sections.length) : null);
  const highest = Math.max(0, ...layout.sections.map(s => s.entropy ?? 0));
  if (layout.sections.length) {
    add(
      'Highest entropy',
      `${highest.toFixed(2)} bits/byte${highest > PACKED_ENTROPY ? ' (packed or compressed?)' : ''}`,
    );
  }
  if (layout.imports.length) {
    const fns = sum(layout.imports);
    rows.push({
      label: 'Imports',
      value: fns
        ? `${libraries(layout.imports.length)} · ${plural(fns, 'function')}`
        : libraries(layout.imports.length),
      children: layout.imports.slice(0, 200).map(g => ({
        label: g.library,
        value: !fns
          ? g.weak
            ? 'weak'
            : 'linked'
          : `${formatCount(g.functions.length)}${g.delay ? ' (delay-loaded)' : ''}`,
      })),
    });
  }
  add('Exports', layout.exports.length ? formatCount(layout.exports.length) : null);
  if (layout.resources.length) {
    add('Resources', layout.resources.map(r => `${r.type} ${r.count}`).join(', '));
  }
  if (layout.warnings.length) {
    rows.push({
      label: 'Warnings',
      value: formatCount(layout.warnings.length),
      children: layout.warnings.slice(0, 50).map((w, n) => ({ label: String(n + 1), value: w })),
    });
  }
  return rows;
}

/** Exports in a shape suited to CSV. */
export const exportRows = (exports: ExportEntry[]) =>
  exports.map(e => ({
    ordinal: e.ordinal ?? '',
    name: e.name ?? '',
    address: toHexAddress(e.address),
    forwarder: e.forwarder ?? '',
  }));
