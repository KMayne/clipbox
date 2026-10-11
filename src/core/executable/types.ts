/**
 * Executable (PE, ELF, Mach-O) values, and the display model the preview reads (validated with Zod,
 * since it arrives from the worker). No heavy imports: the UI loads this file too.
 */

import { z } from 'zod';

export interface ExecSection {
  name: string;
  /** Mach-O segment, or the slice of a universal binary. */
  group: string | null;
  address: number;
  virtualSize: number;
  rawOffset: number;
  rawSize: number;
  /** e.g. "R-X code". */
  flags: string;
  /** Bits per byte (0–8); null when the section has no file data. */
  entropy: number | null;
  /** High entropy or a known packer's section name. */
  packed: boolean;
}

export interface ImportFunction {
  name: string | null;
  ordinal: number | null;
}

export interface ImportGroup {
  library: string;
  /** PE delay-load imports. */
  delay: boolean;
  /** Mach-O weak or lazy dylibs. */
  weak: boolean;
  functions: ImportFunction[];
}

export interface ExportEntry {
  ordinal: number | null;
  name: string | null;
  address: number;
  /** PE forwarders, e.g. "NTDLL.RtlAllocateHeap". */
  forwarder: string | null;
}

/** A certificate's names, read straight from the DER (nothing is verified). */
export interface CertSummary {
  subject: string;
  issuer: string;
  /** ISO 8601, when readable. */
  notBefore: string | null;
  notAfter: string | null;
  serial: string;
}

export interface SignatureInfo {
  /** Authenticode (PE), or a Mach-O code signature with or without a CMS blob. */
  type: 'authenticode' | 'macho';
  /** Mach-O ad-hoc signature: no certificate at all. */
  adhoc: boolean;
  signer: CertSummary | null;
  certificates: CertSummary[];
  /** Digest algorithm of the signer, e.g. "SHA-256". */
  digest: string | null;
  /** Mach-O code signing identifier, e.g. "com.example.app". */
  identifier: string | null;
  /** Byte range of the DER-encoded PKCS#7 / CMS blob in the file. */
  blob: { offset: number; size: number } | null;
  /** Byte ranges of each certificate's DER, for extracting them as PEM. */
  certRanges: { offset: number; size: number }[];
  error: string | null;
}

export interface VersionInfo {
  /** From VS_FIXEDFILEINFO, e.g. "1.2.3.0". */
  fileVersion: string | null;
  productVersion: string | null;
  /** The first string table's entries (CompanyName, FileVersion, …), in file order. */
  strings: Record<string, string>;
  /** Language/code-page pairs, e.g. "0409 04B0". */
  translations: string[];
}

export interface IconImage {
  width: number;
  height: number;
  bitCount: number;
  /** Resource data range in the file. */
  offset: number;
  size: number;
  png: boolean;
}

export interface IconGroup {
  name: string;
  images: IconImage[];
}

export interface ResourceLeaf {
  type: string;
  name: string;
  language: number;
  offset: number;
  size: number;
}

export interface PeInfo {
  format: 'pe';
  machine: string;
  bits: 32 | 64;
  isDll: boolean;
  isDriver: boolean;
  subsystem: string;
  /** Raw TimeDateStamp. */
  timestamp: number;
  /** Why the timestamp is probably a hash (reproducible build), or null when it looks real. */
  timestampNote: string | null;
  entryPoint: number;
  imageBase: string;
  characteristics: string[];
  dllCharacteristics: string[];
  linkerVersion: string;
  osVersion: string;
  subsystemVersion: string;
  checksum: number;
  sizeOfImage: number;
  dotnet: { runtime: string | null; version: string; flags: string[] } | null;
  pdb: string | null;
  sections: ExecSection[];
  imports: ImportGroup[];
  exports: ExportEntry[];
  /** The DLL's own name from its export directory. */
  exportName: string | null;
  resources: ResourceLeaf[];
  version: VersionInfo | null;
  iconGroups: IconGroup[];
  manifest: string | null;
  executionLevel: string | null;
  signature: SignatureInfo | null;
  overlay: { offset: number; size: number } | null;
  warnings: string[];
}

export interface ElfInfo {
  format: 'elf';
  bits: 32 | 64;
  littleEndian: boolean;
  machine: string;
  osAbi: string;
  /** Executable, PIE executable, shared library, relocatable object, core dump… */
  type: string;
  entryPoint: number;
  interpreter: string | null;
  soname: string | null;
  needed: string[];
  runpath: string | null;
  sections: ExecSection[];
  exports: ExportEntry[];
  stripped: boolean;
  debugInfo: boolean;
  buildId: string | null;
  executableStack: boolean | null;
  relro: boolean;
  warnings: string[];
}

export interface MachoDylib {
  name: string;
  /** load, weak, reexport, lazy or upward. */
  how: string;
  version: string;
}

export interface MachoInfo {
  format: 'macho';
  bits: 32 | 64;
  littleEndian: boolean;
  cpu: string;
  fileType: string;
  platform: string | null;
  minOs: string | null;
  sdk: string | null;
  installName: string | null;
  dylibs: MachoDylib[];
  rpaths: string[];
  uuid: string | null;
  entryPoint: number | null;
  sections: ExecSection[];
  signature: SignatureInfo | null;
  /** LC_ENCRYPTION_INFO: null when absent, else whether cryptid is set. */
  encrypted: boolean | null;
  flags: string[];
  warnings: string[];
}

export interface FatSlice {
  cpu: string;
  offset: number;
  size: number;
  info: MachoInfo | null;
  error: string | null;
}

export interface FatInfo {
  format: 'fat';
  slices: FatSlice[];
  warnings: string[];
}

export type ExecInfo = PeInfo | ElfInfo | MachoInfo | FatInfo;

export interface ExecutableValue {
  kind: 'executable';
  bytes: Uint8Array<ArrayBuffer>;
  format: ExecInfo['format'];
  /** Null when the headers matched but parsing failed outright (see `error`). */
  info: ExecInfo | null;
  error: string | null;
}

/** The preview's model: the `json` slice. */
export interface ExecutableLayout {
  title: string;
  formatName: string;
  product: string | null;
  version: string | null;
  company: string | null;
  description: string | null;
  arch: string[];
  badges: { text: string; tone: 'good' | 'warn' | 'neutral' }[];
  signing: { state: 'signed' | 'unsigned' | 'adhoc'; text: string };
  hasIcon: boolean;
  header: { label: string; value: string }[];
  sections: ExecSection[];
  imports: ImportGroup[];
  exports: ExportEntry[];
  resources: { type: string; count: number; bytes: number }[];
  icons: IconImage[];
  versionInfo: { label: string; value: string }[];
  manifest: string | null;
  warnings: string[];
}

const row = z.object({ label: z.string(), value: z.string() });

export const executableLayoutSchema: z.ZodType<ExecutableLayout> = z.object({
  title: z.string(),
  formatName: z.string(),
  product: z.string().nullable(),
  version: z.string().nullable(),
  company: z.string().nullable(),
  description: z.string().nullable(),
  arch: z.array(z.string()),
  badges: z.array(z.object({ text: z.string(), tone: z.enum(['good', 'warn', 'neutral']) })),
  signing: z.object({ state: z.enum(['signed', 'unsigned', 'adhoc']), text: z.string() }),
  hasIcon: z.boolean(),
  header: z.array(row),
  sections: z.array(
    z.object({
      name: z.string(),
      group: z.string().nullable(),
      address: z.number(),
      virtualSize: z.number(),
      rawOffset: z.number(),
      rawSize: z.number(),
      flags: z.string(),
      entropy: z.number().nullable(),
      packed: z.boolean(),
    }),
  ),
  imports: z.array(
    z.object({
      library: z.string(),
      delay: z.boolean(),
      weak: z.boolean(),
      functions: z.array(z.object({ name: z.string().nullable(), ordinal: z.number().nullable() })),
    }),
  ),
  exports: z.array(
    z.object({
      ordinal: z.number().nullable(),
      name: z.string().nullable(),
      address: z.number(),
      forwarder: z.string().nullable(),
    }),
  ),
  resources: z.array(z.object({ type: z.string(), count: z.number(), bytes: z.number() })),
  icons: z.array(
    z.object({
      width: z.number(),
      height: z.number(),
      bitCount: z.number(),
      offset: z.number(),
      size: z.number(),
      png: z.boolean(),
    }),
  ),
  versionInfo: z.array(row),
  manifest: z.string().nullable(),
  warnings: z.array(z.string()),
});
