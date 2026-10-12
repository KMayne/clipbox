/**
 * WebAssembly values, and the display model the preview reads (validated with Zod, since it
 * arrives from the worker). No heavy imports: the UI loads this file too.
 */

import { z } from 'zod';

export type ExternalKind = 'func' | 'table' | 'memory' | 'global' | 'tag';

export interface Limits {
  min: number;
  max: number | null;
  shared: boolean;
  /** memory64 / table64: limits are 64-bit. */
  is64: boolean;
  /** Custom page sizes proposal: log2 of the page size, when given. */
  pageSizeLog2: number | null;
}

/** One entry of the type section. GC types are described, not decoded into signatures. */
export type WasmType =
  { form: 'func'; params: string[]; results: string[] } | { form: 'gc'; description: string };

export interface TableType {
  element: string;
  limits: Limits;
}

export interface GlobalType {
  type: string;
  mutable: boolean;
}

export type ImportDesc =
  | { kind: 'func'; type: number }
  | { kind: 'table'; table: TableType }
  | { kind: 'memory'; limits: Limits }
  | { kind: 'global'; global: GlobalType }
  | { kind: 'tag'; type: number };

export interface WasmImport {
  module: string;
  name: string;
  desc: ImportDesc;
}

export interface WasmExport {
  name: string;
  kind: ExternalKind;
  index: number;
}

export interface WasmGlobal extends GlobalType {
  /** The initialiser when it's a single constant, e.g. "i32.const 1024". */
  init: string | null;
}

export interface WasmSection {
  id: number;
  /** "type", "code", … or a custom section's own name. */
  name: string;
  custom: boolean;
  /** Offset of the section's id byte. */
  offset: number;
  /** Payload size in bytes (without the id and size fields). */
  size: number;
}

export interface Producer {
  name: string;
  version: string;
}

export interface Dylink {
  memorySize: number;
  memoryAlign: number;
  tableSize: number;
  tableAlign: number;
  needed: string[];
}

export interface WasmNames {
  module: string | null;
  /** Function index (imports first) → name. */
  functions: Map<number, string>;
  /** How many locals were named, over all functions. */
  locals: number;
}

export interface WasmModule {
  format: 'module';
  version: number;
  sections: WasmSection[];
  types: WasmType[];
  imports: WasmImport[];
  /** Type index of each defined function (the function section). */
  functions: number[];
  tables: TableType[];
  memories: Limits[];
  globals: WasmGlobal[];
  exports: WasmExport[];
  start: number | null;
  /** Element segments declared. */
  elements: number;
  /** Size of each function body (the code section), in order. */
  bodySizes: number[];
  /** Size of each data segment's bytes. */
  dataSizes: number[];
  /** The data count section's value, when present. */
  dataCount: number | null;
  /** Type index of each defined tag. */
  tags: number[];
  names: WasmNames;
  /** producers section: field ("language", "processed-by", "sdk") → tools. */
  producers: { field: string; values: Producer[] }[];
  /** target_features: e.g. "+bulk-memory". */
  features: string[];
  sourceMappingUrl: string | null;
  externalDebugInfo: string | null;
  dylink: Dylink | null;
  warnings: string[];
}

export interface WasmComponent {
  format: 'component';
  version: number;
  sections: WasmSection[];
  producers: { field: string; values: Producer[] }[];
  warnings: string[];
}

export type WasmInfo = WasmModule | WasmComponent;

export interface WasmValue {
  kind: 'wasm';
  bytes: Uint8Array<ArrayBuffer>;
  info: WasmInfo;
}

/** What the preview shows, besides the tables it reads with `rows`. */
export interface WasmLayout {
  title: string;
  /** "Core module, version 1" or "Component (layer 1)". */
  format: string;
  badges: string[];
  facts: { label: string; value: string }[];
  /** Sections by size, for the bars. */
  sections: { name: string; size: number; custom: boolean }[];
  size: number;
  warnings: string[];
}

export const wasmLayoutSchema: z.ZodType<WasmLayout> = z.object({
  title: z.string(),
  format: z.string(),
  badges: z.array(z.string()),
  facts: z.array(z.object({ label: z.string(), value: z.string() })),
  sections: z.array(z.object({ name: z.string(), size: z.number(), custom: z.boolean() })),
  size: z.number(),
  warnings: z.array(z.string()),
});
