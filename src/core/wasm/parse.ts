/**
 * WebAssembly binary parser (pure TS): walks a core module's sections and reads its types,
 * imports, exports, limits and the custom sections tools leave behind (names, producers, target
 * features, source maps, dylink, DWARF). Function bodies aren't decoded, only measured.
 * Component-model binaries get their top-level sections listed.
 *
 * Every vector's declared count is checked against the bytes left before anything is read, a
 * section that fails to parse becomes a warning (its neighbours are still read), and a section
 * that runs past the end of the file stops the walk.
 */
import { FormatError, WasmReader } from './reader';
import type {
  Dylink,
  ExternalKind,
  GlobalType,
  ImportDesc,
  Limits,
  Producer,
  TableType,
  WasmComponent,
  WasmInfo,
  WasmModule,
  WasmNames,
  WasmSection,
  WasmType,
} from './types';

export const WASM_MAGIC = [0x00, 0x61, 0x73, 0x6d];

export const SECTION_NAMES = [
  'custom',
  'type',
  'import',
  'function',
  'table',
  'memory',
  'global',
  'export',
  'start',
  'element',
  'code',
  'data',
  'data count',
  'tag',
];

export const COMPONENT_SECTION_NAMES = [
  'custom',
  'core module',
  'core instance',
  'core type',
  'component',
  'instance',
  'alias',
  'type',
  'canon',
  'start',
  'import',
  'export',
  'value',
];

const EXTERNAL_KINDS: ExternalKind[] = ['func', 'table', 'memory', 'global', 'tag'];

const hex = (n: number) => `0x${n.toString(16)}`;

/** True for `\0asm` followed by a core module (1) or component (layer 1) version. */
export function isWasm(b: Uint8Array): boolean {
  if (b.length < 8 || !WASM_MAGIC.every((v, i) => b[i] === v)) return false;
  const layer = (b[6] ?? 0) | ((b[7] ?? 0) << 8);
  const version = (b[4] ?? 0) | ((b[5] ?? 0) << 8);
  return (layer === 0 && version === 1) || layer === 1;
}

// Types

const NUMERIC: Record<number, string> = {
  0x7f: 'i32',
  0x7e: 'i64',
  0x7d: 'f32',
  0x7c: 'f64',
  0x7b: 'v128',
};

/** Abstract heap types, by their one-byte encoding. */
const HEAP: Record<number, string> = {
  0x70: 'func',
  0x6f: 'extern',
  0x6e: 'any',
  0x6d: 'eq',
  0x6c: 'i31',
  0x6b: 'struct',
  0x6a: 'array',
  0x69: 'exn',
  0x68: 'cont',
  0x71: 'none',
  0x72: 'noextern',
  0x73: 'nofunc',
  0x74: 'noexn',
  0x75: 'nocont',
};

function heapType(r: WasmReader): string {
  const at = r.pos;
  const v = r.s33('heap type');
  if (v >= 0) return `${v}`;
  const name = HEAP[v + 0x80];
  if (name === undefined) throw new FormatError(`Unknown heap type at ${hex(at)}`);
  return name;
}

export function valType(r: WasmReader): string {
  const at = r.pos;
  const b = r.u8('value type');
  const num = NUMERIC[b];
  if (num) return num;
  const heap = HEAP[b];
  if (heap) return `${heap}ref`;
  if (b === 0x63) return `(ref null ${heapType(r)})`;
  if (b === 0x64) return `(ref ${heapType(r)})`;
  throw new FormatError(`Unknown value type ${hex(b)} at ${hex(at)}`);
}

function storageType(r: WasmReader): string {
  const b = r.bytes[r.pos];
  if (b === 0x78 || b === 0x77) {
    r.pos++;
    return b === 0x78 ? 'i8' : 'i16';
  }
  return valType(r);
}

function valTypes(r: WasmReader, what: string): string[] {
  const n = r.count(what);
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(valType(r));
  return out;
}

function fieldType(r: WasmReader): string {
  const t = storageType(r);
  const mut = r.u8('mutability');
  return mut === 1 ? `mut ${t}` : t;
}

/** A composite type (func, struct, array, cont) after its form byte. */
function compositeType(r: WasmReader, form: number): WasmType {
  switch (form) {
    case 0x60:
      return { form: 'func', params: valTypes(r, 'parameter'), results: valTypes(r, 'result') };
    case 0x5f: {
      const n = r.count('struct field', 2);
      for (let i = 0; i < n; i++) fieldType(r);
      return { form: 'gc', description: `struct (${n} field${n === 1 ? '' : 's'})` };
    }
    case 0x5e:
      return { form: 'gc', description: `array of ${fieldType(r)}` };
    case 0x5d:
      return { form: 'gc', description: `continuation of type ${r.u32('type index')}` };
    default:
      throw new FormatError(`Unknown type form ${hex(form)} at ${hex(r.pos - 1)}`);
  }
}

/** A subtype (`sub`, `sub final`, or a bare composite type), appended to `out`. */
function subType(r: WasmReader, out: WasmType[]): void {
  const form = r.u8('type form');
  if (form === 0x50 || form === 0x4f) {
    const supers = r.count('supertype');
    for (let i = 0; i < supers; i++) r.u32('supertype');
    const t = compositeType(r, r.u8('type form'));
    // Function subtypes keep their signature; others note that they're GC types
    out.push(t.form === 'func' ? t : { form: 'gc', description: `GC type: ${t.description}` });
    return;
  }
  const t = compositeType(r, form);
  out.push(t.form === 'func' ? t : { form: 'gc', description: `GC type: ${t.description}` });
}

function typeSection(r: WasmReader, m: WasmModule): void {
  const n = r.count('type');
  for (let i = 0; i < n; i++) {
    if (r.bytes[r.pos] === 0x4e) {
      r.pos++;
      const members = r.count('recursive type group');
      for (let j = 0; j < members; j++) subType(r, m.types);
    } else {
      subType(r, m.types);
    }
  }
}

export function limits(r: WasmReader): Limits {
  const at = r.pos;
  const flags = r.u8('limits flags');
  if (flags & ~0x0f) throw new FormatError(`Unknown limits flags ${hex(flags)} at ${hex(at)}`);
  const is64 = (flags & 0x04) !== 0;
  const read = () => (is64 ? r.u64('limit') : r.u32('limit'));
  const min = read();
  const max = flags & 0x01 ? read() : null;
  const pageSizeLog2 = flags & 0x08 ? r.u32('page size') : null;
  return { min, max, shared: (flags & 0x02) !== 0, is64, pageSizeLog2 };
}

function tableType(r: WasmReader): TableType {
  const element = valType(r);
  return { element, limits: limits(r) };
}

function globalType(r: WasmReader): GlobalType {
  const type = valType(r);
  const mut = r.u8('mutability');
  if (mut > 3) throw new FormatError(`Bad global mutability ${mut} at ${hex(r.pos - 1)}`);
  return { type, mutable: (mut & 1) === 1 };
}

/**
 * Reads a constant expression up to its `end`; returns it as text when it's one instruction
 * (e.g. "i32.const 1024"), else "expression". Fails on instructions outside constant expressions.
 */
export function constExpr(r: WasmReader): string {
  const parts: string[] = [];
  for (;;) {
    const at = r.pos;
    const op = r.u8('instruction');
    switch (op) {
      case 0x0b:
        return parts.length === 1 && parts[0] !== undefined ? parts[0] : 'expression';
      case 0x41:
        parts.push(`i32.const ${r.s32()}`);
        break;
      case 0x42:
        parts.push(`i64.const ${r.s64()}`);
        break;
      case 0x43: {
        const b = r.take(4, 'f32');
        parts.push(`f32.const ${new DataView(b.buffer, b.byteOffset, 4).getFloat32(0, true)}`);
        break;
      }
      case 0x44: {
        const b = r.take(8, 'f64');
        parts.push(`f64.const ${new DataView(b.buffer, b.byteOffset, 8).getFloat64(0, true)}`);
        break;
      }
      case 0x23:
        parts.push(`global.get ${r.u32()}`);
        break;
      case 0xd0:
        parts.push(`ref.null ${heapType(r)}`);
        break;
      case 0xd2:
        parts.push(`ref.func ${r.u32()}`);
        break;
      // Extended constant expressions
      case 0x6a:
      case 0x6b:
      case 0x6c:
      case 0x7c:
      case 0x7d:
      case 0x7e:
        parts.push('arithmetic');
        break;
      case 0xfd: {
        const sub = r.u32();
        if (sub !== 12) throw new FormatError(`Non-constant SIMD instruction at ${hex(at)}`);
        r.skip(16, 'v128');
        parts.push('v128.const');
        break;
      }
      case 0xfb: {
        // GC allocation in constant expressions
        const sub = r.u32();
        if (sub === 0 || sub === 1 || sub === 6 || sub === 7) r.u32();
        else if (sub === 8) {
          r.u32();
          r.u32();
        } else if (sub < 26 || sub > 28) {
          throw new FormatError(`Non-constant GC instruction at ${hex(at)}`);
        }
        parts.push('gc');
        break;
      }
      default:
        throw new FormatError(`Unexpected instruction ${hex(op)} in a constant at ${hex(at)}`);
    }
  }
}

function importSection(r: WasmReader, m: WasmModule): void {
  const n = r.count('import', 4);
  for (let i = 0; i < n; i++) {
    const module = r.name('module name');
    const name = r.name('import name');
    const at = r.pos;
    const kind = r.u8('import kind');
    let desc: ImportDesc;
    switch (kind) {
      case 0:
        desc = { kind: 'func', type: r.u32('type index') };
        break;
      case 1:
        desc = { kind: 'table', table: tableType(r) };
        break;
      case 2:
        desc = { kind: 'memory', limits: limits(r) };
        break;
      case 3:
        desc = { kind: 'global', global: globalType(r) };
        break;
      case 4:
        r.u8('tag attribute');
        desc = { kind: 'tag', type: r.u32('type index') };
        break;
      default:
        throw new FormatError(`Unknown import kind ${kind} at ${hex(at)}`);
    }
    m.imports.push({ module, name, desc });
  }
}

function tableSection(r: WasmReader, m: WasmModule): void {
  const n = r.count('table', 2);
  for (let i = 0; i < n; i++) {
    if (r.bytes[r.pos] === 0x40) {
      // A table with an initialiser: 0x40 0x00 tabletype expr
      r.skip(2);
      m.tables.push(tableType(r));
      constExpr(r);
    } else {
      m.tables.push(tableType(r));
    }
  }
}

function globalSection(r: WasmReader, m: WasmModule): void {
  const n = r.count('global', 3);
  for (let i = 0; i < n; i++) {
    const type = globalType(r);
    const init = constExpr(r);
    m.globals.push({ ...type, init: init === 'expression' ? null : init });
  }
}

function exportSection(r: WasmReader, m: WasmModule): void {
  const n = r.count('export', 3);
  for (let i = 0; i < n; i++) {
    const name = r.name('export name');
    const at = r.pos;
    const k = r.u8('export kind');
    const kind = EXTERNAL_KINDS[k];
    if (!kind) throw new FormatError(`Unknown export kind ${k} at ${hex(at)}`);
    m.exports.push({ name, kind, index: r.u32('export index') });
  }
}

function codeSection(r: WasmReader, m: WasmModule): void {
  const n = r.count('function body');
  for (let i = 0; i < n; i++) {
    const size = r.u32('body size');
    r.skip(size, `function body ${i}`);
    m.bodySizes.push(size);
  }
}

function dataSection(r: WasmReader, m: WasmModule): void {
  const n = r.count('data segment', 2);
  for (let i = 0; i < n; i++) {
    const at = r.pos;
    const flags = r.u32('data flags');
    if (flags === 2) r.u32('memory index');
    if (flags === 0 || flags === 2) constExpr(r);
    else if (flags !== 1)
      throw new FormatError(`Unknown data segment flags ${flags} at ${hex(at)}`);
    const size = r.u32('data size');
    r.skip(size, `data segment ${i}`);
    m.dataSizes.push(size);
  }
}

// Custom sections

function nameMap(r: WasmReader, onEntry: (index: number, name: string) => void): void {
  const n = r.count('name', 2);
  for (let i = 0; i < n; i++) onEntry(r.u32('index'), r.name());
}

/** The name section; subsections that are cut short keep the names read so far. */
function nameSection(r: WasmReader, names: WasmNames, warnings: string[]): void {
  while (!r.done) {
    const id = r.u8('name subsection id');
    const declared = r.u32('name subsection size');
    const size = Math.min(declared, r.remaining);
    if (declared > size) warnings.push('name section: the last subsection is cut short');
    const sub = r.sub(size);
    try {
      if (id === 0) names.module = sub.name('module name');
      else if (id === 1) nameMap(sub, (i, name) => names.functions.set(i, name));
      else if (id === 2) {
        const n = sub.count('function', 2);
        for (let i = 0; i < n; i++) {
          sub.u32('function index');
          nameMap(sub, () => names.locals++);
        }
      }
    } catch (e) {
      warnings.push(`name section: ${message(e)}`);
    }
  }
}

function producersSection(r: WasmReader): { field: string; values: Producer[] }[] {
  const out: { field: string; values: Producer[] }[] = [];
  const n = r.count('producer field', 2);
  for (let i = 0; i < n; i++) {
    const field = r.name('field name');
    const values: Producer[] = [];
    out.push({ field, values });
    const count = r.count('producer', 2);
    for (let j = 0; j < count; j++) values.push({ name: r.name(), version: r.name('version') });
  }
  return out;
}

function targetFeatures(r: WasmReader): string[] {
  const out: string[] = [];
  const n = r.count('feature', 2);
  for (let i = 0; i < n; i++) {
    const prefix = String.fromCharCode(r.u8('feature prefix'));
    out.push(`${prefix}${r.name('feature')}`);
  }
  return out;
}

function dylinkMemInfo(r: WasmReader, d: Dylink): void {
  d.memorySize = r.u32();
  d.memoryAlign = r.u32();
  d.tableSize = r.u32();
  d.tableAlign = r.u32();
}

function dylinkNeeded(r: WasmReader, d: Dylink): void {
  const n = r.count('needed library');
  for (let i = 0; i < n; i++) d.needed.push(r.name('library'));
}

function dylinkSection(r: WasmReader, legacy: boolean): Dylink {
  const d: Dylink = { memorySize: 0, memoryAlign: 0, tableSize: 0, tableAlign: 0, needed: [] };
  if (legacy) {
    dylinkMemInfo(r, d);
    dylinkNeeded(r, d);
    return d;
  }
  while (!r.done) {
    const type = r.u8('dylink subsection');
    const sub = r.sub(r.u32('dylink subsection size'));
    if (type === 1) dylinkMemInfo(sub, d);
    else if (type === 2) dylinkNeeded(sub, d);
  }
  return d;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Reads one custom section's payload (after its name) into `m`. */
function customSection(name: string, r: WasmReader, m: WasmModule): void {
  switch (name) {
    case 'name':
      nameSection(r, m.names, m.warnings);
      break;
    case 'producers':
      for (const p of producersSection(r)) m.producers.push(p);
      break;
    case 'target_features':
      for (const f of targetFeatures(r)) m.features.push(f);
      break;
    case 'sourceMappingURL':
      m.sourceMappingUrl = r.name('URL');
      break;
    case 'external_debug_info':
      m.externalDebugInfo = r.name('URL');
      break;
    case 'dylink.0':
    case 'dylink':
      m.dylink = dylinkSection(r, name === 'dylink');
      break;
  }
}

function moduleSection(id: number, r: WasmReader, m: WasmModule): void {
  switch (id) {
    case 1:
      return typeSection(r, m);
    case 2:
      return importSection(r, m);
    case 3: {
      const n = r.count('function');
      for (let i = 0; i < n; i++) m.functions.push(r.u32('type index'));
      return;
    }
    case 4:
      return tableSection(r, m);
    case 5: {
      const n = r.count('memory', 2);
      for (let i = 0; i < n; i++) m.memories.push(limits(r));
      return;
    }
    case 6:
      return globalSection(r, m);
    case 7:
      return exportSection(r, m);
    case 8:
      m.start = r.u32('start function');
      return;
    case 9:
      m.elements = r.count('element segment', 2);
      r.pos = r.end; // segments aren't decoded
      return;
    case 10:
      return codeSection(r, m);
    case 11:
      return dataSection(r, m);
    case 12:
      m.dataCount = r.u32('data count');
      return;
    case 13: {
      const n = r.count('tag', 2);
      for (let i = 0; i < n; i++) {
        r.u8('tag attribute');
        m.tags.push(r.u32('type index'));
      }
      return;
    }
    default:
      r.pos = r.end; // unknown: already noted
  }
}

interface RawSection {
  section: WasmSection;
  payload: WasmReader;
  /** The section runs past the end of the file; `payload` holds what's there. */
  truncated: boolean;
}

/**
 * The top-level sections, read until the end or the first one that runs past it (recorded as a
 * warning, with the section kept at the size actually present).
 */
function walkSections(
  bytes: Uint8Array<ArrayBuffer>,
  names: string[],
  warnings: string[],
): RawSection[] {
  const r = new WasmReader(bytes, 8);
  const out: RawSection[] = [];
  while (!r.done) {
    const offset = r.pos;
    let id: number;
    let declared: number;
    try {
      id = r.u8('section id');
      declared = r.u32('section size');
    } catch (e) {
      warnings.push(`Section header at ${hex(offset)}: ${message(e)}`);
      break;
    }
    const size = Math.min(declared, r.remaining);
    const payload = r.sub(size);
    let name = names[id] ?? `unknown (${id})`;
    let custom = false;
    if (id === 0) {
      custom = true;
      try {
        name = payload.name('custom section name');
      } catch (e) {
        warnings.push(`Custom section at ${hex(offset)}: ${message(e)}`);
        name = '(unnamed)';
      }
    } else if (names[id] === undefined) {
      warnings.push(`Unknown section id ${id} at ${hex(offset)}`);
    }
    out.push({ section: { id, name, custom, offset, size }, payload, truncated: declared > size });
    if (declared > size) {
      warnings.push(
        `The ${name} section at ${hex(offset)} declares ${declared} bytes but only ${size} are left: the file is truncated`,
      );
      break;
    }
  }
  return out;
}

function parseModule(bytes: Uint8Array<ArrayBuffer>): WasmModule {
  const m: WasmModule = {
    format: 'module',
    version: 1,
    sections: [],
    types: [],
    imports: [],
    functions: [],
    tables: [],
    memories: [],
    globals: [],
    exports: [],
    start: null,
    elements: 0,
    bodySizes: [],
    dataSizes: [],
    dataCount: null,
    tags: [],
    names: { module: null, functions: new Map(), locals: 0 },
    producers: [],
    features: [],
    sourceMappingUrl: null,
    externalDebugInfo: null,
    dylink: null,
    warnings: [],
  };
  for (const { section, payload, truncated } of walkSections(bytes, SECTION_NAMES, m.warnings)) {
    m.sections.push(section);
    try {
      if (section.custom) customSection(section.name, payload, m);
      else moduleSection(section.id, payload, m);
      if (!payload.done && !section.custom) {
        m.warnings.push(`The ${section.name} section has ${payload.remaining} unread bytes`);
      }
    } catch (e) {
      // A cut-short last section is already reported as truncation
      if (!truncated) m.warnings.push(`The ${section.name} section: ${message(e)}`);
    }
  }
  return m;
}

function parseComponent(bytes: Uint8Array<ArrayBuffer>, version: number): WasmComponent {
  const c: WasmComponent = {
    format: 'component',
    version,
    sections: [],
    producers: [],
    warnings: [],
  };
  for (const { section, payload } of walkSections(bytes, COMPONENT_SECTION_NAMES, c.warnings)) {
    c.sections.push(section);
    if (section.custom && section.name === 'producers') {
      try {
        for (const p of producersSection(payload)) c.producers.push(p);
      } catch (e) {
        c.warnings.push(`The producers section: ${message(e)}`);
      }
    }
  }
  return c;
}

export function parseWasm(bytes: Uint8Array<ArrayBuffer>): WasmInfo {
  if (bytes.length < 8) throw new FormatError('Too short for a WebAssembly header (8 bytes)');
  if (!WASM_MAGIC.every((v, i) => bytes[i] === v)) {
    throw new FormatError('Not WebAssembly: the file doesn\'t start with "\\0asm"');
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = dv.getUint16(4, true);
  const layer = dv.getUint16(6, true);
  if (layer === 1) return parseComponent(bytes, version);
  if (layer !== 0 || version !== 1) {
    throw new FormatError(`Unsupported WebAssembly version ${dv.getUint32(4, true)}`);
  }
  return parseModule(bytes);
}

export { FormatError };
