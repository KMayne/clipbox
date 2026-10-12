import { describe, expect, it } from 'vitest';
import type { EntryId } from '../../src/core/types';
import { Engine } from '../../src/engine/engine';
import { wasmInterpreter } from '../../src/core/interpreters/wasm';
import { makeContent } from '../../src/core/content';
import { parseWasm } from '../../src/core/wasm/parse';
import { WasmReader } from '../../src/core/wasm/reader';
import { signatureText, wasmLabel, wasmLayout, wasmStats } from '../../src/core/wasm/describe';
import type { WasmModule, WasmValue } from '../../src/core/wasm/types';
import {
  COMPONENT_HEADER,
  EXTERNREF,
  F32,
  FUNCREF,
  HEADER,
  I32,
  V128,
  custom,
  funcType,
  i32Const,
  limits,
  name,
  nameMap,
  nameSection,
  sampleComponent,
  sampleWasm,
  section,
  sleb,
  uleb,
  vec,
  wasmModule,
} from '../fixtures/wasm';

function moduleOf(bytes: Uint8Array<ArrayBuffer>): WasmModule {
  const info = parseWasm(bytes);
  if (info.format !== 'module') throw new Error('expected a core module');
  return info;
}

const valueOf = (bytes: Uint8Array<ArrayBuffer>): WasmValue => ({
  kind: 'wasm',
  bytes,
  info: parseWasm(bytes),
});

const stat = (v: WasmValue, label: string) => wasmStats(v).find(r => r.label === label)?.value;

describe('LEB128', () => {
  const reader = (bytes: number[]) => new WasmReader(Uint8Array.from(bytes));

  it('reads unsigned 32-bit values, including the largest', () => {
    for (const n of [0, 1, 127, 128, 624485, 2 ** 31, 2 ** 32 - 1]) {
      expect(reader(uleb(n)).u32()).toBe(n);
    }
    // Padded (non-minimal) encodings are allowed
    expect(reader([0x80, 0x80, 0x00]).u32()).toBe(0);
  });

  it('rejects 32-bit values that are too long or too large', () => {
    expect(() => reader([0x80, 0x80, 0x80, 0x80, 0x80, 0x00]).u32()).toThrow('over 5 bytes');
    expect(() => reader([0xff, 0xff, 0xff, 0xff, 0x1f]).u32()).toThrow('over 32 bits');
    expect(() => reader([0x80, 0x80]).u32()).toThrow('runs past the end');
  });

  it('reads signed 32- and 64-bit values', () => {
    for (const n of [0, -1, 63, -64, 64, -65, 2 ** 31 - 1, -(2 ** 31)]) {
      expect(reader(sleb(n)).s32()).toBe(n);
    }
    for (const n of [0n, -1n, 2n ** 63n - 1n, -(2n ** 63n), -123456789012345n]) {
      expect(reader(sleb(n)).s64()).toBe(n);
    }
    expect(() => reader(Array(11).fill(0x80)).s64()).toThrow('over 10 bytes');
  });

  it('reads unsigned 64-bit limits', () => {
    expect(reader(uleb(2n ** 40n)).u64()).toBe(2 ** 40);
  });

  it('checks vector counts against the bytes left', () => {
    expect(() => reader([...uleb(5), 1, 2]).count('thing')).toThrow(
      'declares 5 entries but only 2 bytes are left',
    );
    expect(() => reader(uleb(2 ** 32 - 1)).count('thing')).toThrow('is too many');
  });
});

describe('core module sections', () => {
  const m = moduleOf(sampleWasm());

  it('walks every section in order, with offsets and sizes', () => {
    expect(m.sections.map(s => s.name)).toEqual([
      'type',
      'import',
      'function',
      'table',
      'memory',
      'global',
      'export',
      'start',
      'element',
      'data count',
      'code',
      'data',
      'name',
      'producers',
      'target_features',
      'sourceMappingURL',
      '.debug_info',
    ]);
    expect(m.sections[0]).toMatchObject({ id: 1, offset: 8, custom: false });
    expect(m.sections.at(-1)).toMatchObject({ id: 0, custom: true, size: 22 });
    expect(m.warnings).toEqual([]);
  });

  it('reads types, imports and functions', () => {
    expect(m.types).toEqual([
      { form: 'func', params: ['i32', 'i32'], results: ['i32'] },
      { form: 'func', params: [], results: [] },
      { form: 'func', params: ['i32'], results: [] },
      { form: 'func', params: ['i32', 'i64'], results: ['i32', 'i64'] },
    ]);
    expect(m.imports.map(i => [i.module, i.name, i.desc.kind])).toEqual([
      ['wasi_snapshot_preview1', 'proc_exit', 'func'],
      ['env', 'emscripten_notify_memory_growth', 'func'],
      ['env', '__indirect_function_table', 'table'],
      ['env', '__memory_base', 'global'],
    ]);
    expect(m.imports[2]?.desc).toEqual({
      kind: 'table',
      table: {
        element: 'funcref',
        limits: { min: 1, max: null, shared: false, is64: false, pageSizeLog2: null },
      },
    });
    expect(m.functions).toEqual([0, 1, 3]);
  });

  it('reads tables, memory, globals, exports and start', () => {
    expect(m.tables).toEqual([
      {
        element: 'funcref',
        limits: { min: 2, max: 10, shared: false, is64: false, pageSizeLog2: null },
      },
    ]);
    expect(m.memories).toEqual([
      { min: 1, max: 256, shared: false, is64: false, pageSizeLog2: null },
    ]);
    expect(m.globals).toEqual([
      { type: 'i32', mutable: true, init: 'i32.const 1024' },
      { type: 'i64', mutable: false, init: 'i64.const -42' },
    ]);
    expect(m.exports.map(e => [e.name, e.kind, e.index])).toEqual([
      ['add', 'func', 2],
      ['memory', 'memory', 0],
      ['_start', 'func', 3],
      ['__stack_pointer', 'global', 1],
      ['table', 'table', 1],
      ['pair', 'func', 4],
    ]);
    expect(m.start).toBe(3);
  });

  it('counts elements, measures code and data', () => {
    expect(m.elements).toBe(1);
    expect(m.dataCount).toBe(2);
    expect(m.bodySizes).toEqual([7, 2, 6]);
    expect(m.dataSizes).toEqual([2, 3]);
  });

  it('reads the name, producers, target_features and sourceMappingURL sections', () => {
    expect(m.names.module).toBe('sample');
    expect([...m.names.functions]).toEqual([
      [0, 'proc_exit'],
      [2, 'add'],
      [3, '_start'],
      [4, 'pair'],
    ]);
    expect(m.names.locals).toBe(2);
    expect(m.producers).toEqual([
      { field: 'language', values: [{ name: 'Rust', version: '1.80.0' }] },
      {
        field: 'processed-by',
        values: [
          { name: 'rustc', version: '1.80.0 (051478957 2024-07-21)' },
          { name: 'wasm-bindgen', version: '0.2.92' },
        ],
      },
    ]);
    expect(m.features).toEqual(['+bulk-memory', '+mutable-globals', '-simd128']);
    expect(m.sourceMappingUrl).toBe('sample.wasm.map');
  });

  it('reads tags, tag imports and the newer value and reference types', () => {
    const t = moduleOf(
      wasmModule(
        section(
          1,
          vec([
            funcType([V128, F32, FUNCREF, EXTERNREF], []),
            funcType([I32], []),
            // (ref null func) and (ref 0)
            [
              0x60,
              ...vec([
                [0x63, 0x70],
                [0x64, 0x00],
              ]),
              0x00,
            ],
          ]),
        ),
        section(2, vec([[...name('env'), ...name('oops'), 0x04, 0x00, 1]])),
        section(
          13,
          vec([
            [0x00, 1],
            [0x00, 0],
          ]),
        ),
        section(7, vec([[...name('oops2'), 0x04, 1]])),
      ),
    );
    expect(t.types[0]).toEqual({
      form: 'func',
      params: ['v128', 'f32', 'funcref', 'externref'],
      results: [],
    });
    expect(signatureText(t.types[2])).toBe('((ref null func), (ref 0)) → ()');
    expect(t.imports[0]?.desc).toEqual({ kind: 'tag', type: 1 });
    expect(t.tags).toEqual([1, 0]);
    const v: WasmValue = { kind: 'wasm', bytes: new Uint8Array(), info: t };
    expect(wasmLayout(v).badges).toContain('Exceptions');
  });

  it('reads memory64, shared memory, custom page sizes and table64 limits', () => {
    const t = moduleOf(
      wasmModule(
        section(4, vec([[FUNCREF, ...limits(0x05, 1n, 2n ** 33n)]])),
        section(
          5,
          vec([limits(0x05, 1n, 2n ** 34n), limits(0x03, 1, 16), [0x08, ...uleb(1), ...uleb(0)]]),
        ),
      ),
    );
    expect(t.tables[0]?.limits).toMatchObject({ is64: true, max: 2 ** 33 });
    expect(t.memories).toEqual([
      { min: 1, max: 2 ** 34, shared: false, is64: true, pageSizeLog2: null },
      { min: 1, max: 16, shared: true, is64: false, pageSizeLog2: null },
      { min: 1, max: null, shared: false, is64: false, pageSizeLog2: 0 },
    ]);
    const v = valueOf(wasmModule(section(5, vec([limits(0x05, 1n, 2n ** 34n)]))));
    expect(stat(v, 'Memory')).toBe('1 page (64 KB) – 17,179,869,184 pages (1048576 GB) · 64-bit');
    expect(wasmLayout(v).badges).toContain('memory64');
    const shared = valueOf(wasmModule(section(5, vec([limits(0x03, 1, 16)]))));
    expect(stat(shared, 'Memory')).toBe('1 page (64 KB) – 16 pages (1.0 MB) · shared');
  });

  it('reads a table with an initialiser and globals with other constants', () => {
    const t = moduleOf(
      wasmModule(
        section(4, vec([[0x40, 0x00, FUNCREF, ...limits(0, 1), 0xd0, 0x70, 0x0b]])),
        section(
          6,
          vec([
            [F32, 0x00, 0x43, 0x00, 0x00, 0x80, 0x3f, 0x0b],
            [FUNCREF, 0x00, 0xd2, 0x00, 0x0b],
            [I32, 0x00, 0x23, 0x00, 0x0b],
            // Extended constant: i32.const 1, i32.const 2, i32.add
            [I32, 0x00, 0x41, 1, 0x41, 2, 0x6a, 0x0b],
          ]),
        ),
      ),
    );
    expect(t.tables).toHaveLength(1);
    expect(t.globals.map(g => g.init)).toEqual(['f32.const 1', 'ref.func 0', 'global.get 0', null]);
  });

  it('notes GC types without decoding them into signatures', () => {
    const t = moduleOf(
      wasmModule(
        section(
          1,
          vec([
            // rec { struct (mut i32, i8); array i16 }
            [
              0x4e,
              ...uleb(2),
              0x5f,
              ...vec([
                [0x7f, 0x01],
                [0x78, 0x00],
              ]),
              0x5e,
              0x77,
              0x01,
            ],
            // sub final (no supertypes) func (i32) → ()
            [0x4f, 0x00, ...funcType([I32], [])],
            // sub (supertype 0) struct {}
            [0x50, ...vec([[0]]), 0x5f, 0x00],
          ]),
        ),
      ),
    );
    expect(t.types).toEqual([
      { form: 'gc', description: 'GC type: struct (2 fields)' },
      { form: 'gc', description: 'GC type: array of mut i16' },
      { form: 'func', params: ['i32'], results: [] },
      { form: 'gc', description: 'GC type: struct (0 fields)' },
    ]);
    expect(t.warnings).toEqual([]);
  });

  it('reads external_debug_info, dylink.0 and the older dylink', () => {
    const t = moduleOf(
      wasmModule(
        custom('external_debug_info', name('https://example.com/a.debug.wasm')),
        custom('dylink.0', [
          ...[1, 5, ...uleb(1024), 2, 3, 0],
          ...[2, 17, ...vec([name('libc.so'), name('libm.so')])],
        ]),
      ),
    );
    expect(t.externalDebugInfo).toBe('https://example.com/a.debug.wasm');
    expect(t.dylink).toEqual({
      memorySize: 1024,
      memoryAlign: 2,
      tableSize: 3,
      tableAlign: 0,
      needed: ['libc.so', 'libm.so'],
    });
    const legacy = moduleOf(
      wasmModule(custom('dylink', [...uleb(16), 0, 1, 0, ...vec([name('a.so')])])),
    );
    expect(legacy.dylink).toEqual({
      memorySize: 16,
      memoryAlign: 0,
      tableSize: 1,
      tableAlign: 0,
      needed: ['a.so'],
    });
  });
});

describe('describing a module', () => {
  const v = valueOf(sampleWasm());

  it('labels it with function and export counts and the language', () => {
    expect(wasmLabel(v)).toBe('WebAssembly · 3 functions · 6 exports · Rust');
    const plain = valueOf(wasmModule(section(1, vec([funcType([], [])]))));
    expect(wasmLabel(plain)).toBe('WebAssembly · 0 functions · 0 exports');
  });

  it('lists the Info stats', () => {
    expect(stat(v, 'Functions')).toBe('5 · 2 imported, 3 defined');
    expect(stat(v, 'Imports')).toBe('4');
    expect(stat(v, 'Memory')).toBe('1 page (64 KB) – 256 pages (16 MB)');
    expect(stat(v, 'Tables')).toBe('funcref, 2 – 10');
    expect(stat(v, 'Globals')).toBe('2 · 1 mutable');
    expect(stat(v, 'Start function')).toBe('_start');
    expect(stat(v, 'Code')).toBe('3 bodies · 15 B');
    expect(stat(v, 'Data segments')).toBe('2 · 5 B');
    expect(stat(v, 'WASI')).toBe('Yes · wasi_snapshot_preview1 (1 import)');
    expect(stat(v, 'Emscripten')).toBe('Likely · 1 runtime import');
    expect(stat(v, 'Language')).toBe('Rust 1.80.0');
    expect(stat(v, 'Processed by')).toBe(
      'rustc 1.80.0 (051478957 2024-07-21), wasm-bindgen 0.2.92',
    );
    expect(stat(v, 'Target features')).toBe('+bulk-memory +mutable-globals -simd128');
    expect(stat(v, 'Names')).toBe('4 functions, 2 locals');
    expect(stat(v, 'Debug info')).toBe('DWARF · 22 B');
    expect(stat(v, 'Source map')).toBe('sample.wasm.map');
    expect(stat(v, 'Custom sections')).toMatch(/^5 · /);
  });

  it('builds the preview layout', () => {
    const l = wasmLayout(v);
    expect(l.badges).toEqual(['Rust', 'WASI', 'Emscripten', 'DWARF', 'Source map']);
    expect(l.sections).toHaveLength(17);
    expect(l.format).toBe('WebAssembly core module, version 1');
  });
});

describe('wasm through the engine', () => {
  async function ingest(bytes: Uint8Array<ArrayBuffer>, name = 'sample.wasm') {
    const engine = new Engine({ loaders: {} });
    const blob = new Blob([bytes], { type: 'application/wasm' });
    const id: EntryId = 'en-1';
    const result = await engine.ingest({ id, mime: blob.type, name, size: blob.size, blob });
    return { engine, result };
  }

  it('offers wasm first, binary second', async () => {
    const { result } = await ingest(sampleWasm());
    expect(result.interpretations.map(i => i.kind)).toEqual(['wasm', 'binary']);
    expect(result.interpretations[0]?.label).toBe('WebAssembly · 3 functions · 6 exports · Rust');
  });

  it('serves the imports, exports, functions and sections tables', async () => {
    const { engine } = await ingest(sampleWasm());
    const summary = await engine.summary('en-1', 'wasm');
    expect(summary.tables?.map(t => [t.name, t.extent])).toEqual([
      ['Imports', 4],
      ['Exports', 6],
      ['Functions', 5],
      ['Sections', 17],
    ]);
    const imports = await engine.slice('en-1', 'wasm', { type: 'rows', from: 0, to: 10, table: 0 });
    expect(imports).toEqual([
      {
        module: 'wasi_snapshot_preview1',
        name: 'proc_exit',
        kind: 'func',
        index: 0,
        signature: '(i32) → ()',
      },
      {
        module: 'env',
        name: 'emscripten_notify_memory_growth',
        kind: 'func',
        index: 1,
        signature: '(i32) → ()',
      },
      {
        module: 'env',
        name: '__indirect_function_table',
        kind: 'table',
        index: 0,
        signature: 'funcref, 1, no maximum',
      },
      { module: 'env', name: '__memory_base', kind: 'global', index: 0, signature: 'i32' },
    ]);
    const exports = await engine.slice('en-1', 'wasm', { type: 'rows', from: 0, to: 10, table: 1 });
    expect(exports).toEqual([
      { name: 'add', kind: 'func', index: 2, function: 'add', signature: '(i32, i32) → i32' },
      {
        name: 'memory',
        kind: 'memory',
        index: 0,
        function: '',
        signature: '1 page (64 KB) – 256 pages (16 MB)',
      },
      { name: '_start', kind: 'func', index: 3, function: '_start', signature: '() → ()' },
      {
        name: '__stack_pointer',
        kind: 'global',
        index: 1,
        function: '',
        signature: 'mut i32 = 1024',
      },
      { name: 'table', kind: 'table', index: 1, function: '', signature: 'funcref, 2 – 10' },
      {
        name: 'pair',
        kind: 'func',
        index: 4,
        function: 'pair',
        signature: '(i32, i64) → (i32, i64)',
      },
    ]);
    const functions = await engine.slice('en-1', 'wasm', {
      type: 'rows',
      from: 0,
      to: 3,
      table: 2,
    });
    expect(functions).toEqual([
      {
        index: 0,
        name: 'proc_exit',
        signature: '(i32) → ()',
        'body size': null,
        'exported as': '',
        'imported from': 'wasi_snapshot_preview1.proc_exit',
      },
      {
        index: 1,
        name: '',
        signature: '(i32) → ()',
        'body size': null,
        'exported as': '',
        'imported from': 'env.emscripten_notify_memory_growth',
      },
      {
        index: 2,
        name: 'add',
        signature: '(i32, i32) → i32',
        'body size': 7,
        'exported as': 'add',
        'imported from': '',
      },
    ]);
    const sections = await engine.slice('en-1', 'wasm', { type: 'rows', from: 0, to: 1, table: 3 });
    expect(sections).toEqual([{ id: 1, name: 'type', offset: '0x00000008', size: 21 }]);
  });

  it('copies the selected table as tab-separated text', async () => {
    const { engine } = await ingest(sampleWasm());
    const { text } = await engine.exportValue('en-1', 'wasm', { table: 1 });
    expect(text?.split('\n')[0]).toBe('name\tkind\tsignature\tfunction\tindex');
    expect(text?.split('\n')[1]).toBe('add\tfunc\t(i32, i32) → i32\tadd\t2');
  });

  it("doesn't claim other bytes or unknown versions", () => {
    const detect = (bytes: number[]) =>
      wasmInterpreter.detect(makeContent('application/octet-stream', Uint8Array.from(bytes)));
    expect(detect(HEADER)).toBeGreaterThan(0.9);
    expect(detect(COMPONENT_HEADER)).toBeGreaterThan(0.9);
    expect(detect([0x00, 0x61, 0x73, 0x6d, 0x02, 0x00, 0x00, 0x00])).toBe(0);
    expect(detect([0x00, 0x61, 0x73, 0x6d])).toBe(0);
    expect(detect([0x7f, 0x45, 0x4c, 0x46, 1, 0, 0, 0])).toBe(0);
  });
});

describe('components', () => {
  it('lists a component’s top-level sections by id', () => {
    const v = valueOf(sampleComponent());
    expect(v.info.format).toBe('component');
    expect(v.info.sections.map(s => s.name)).toEqual([
      'core module',
      'type',
      'import',
      'export',
      'producers',
    ]);
    expect(wasmLabel(v)).toBe('WASM component · 5 sections · Rust');
    expect(stat(v, 'Format')).toBe('Component (version 13, layer 1)');
  });
});

describe('truncated, corrupt and hostile input', () => {
  it('fails clearly on a header that is cut short or not WebAssembly', () => {
    expect(() => parseWasm(Uint8Array.from([0x00, 0x61, 0x73, 0x6d]))).toThrow(
      'Too short for a WebAssembly header',
    );
    expect(() => parseWasm(Uint8Array.from([1, 2, 3, 4, 1, 0, 0, 0]))).toThrow('Not WebAssembly');
    expect(() => parseWasm(Uint8Array.from([0x00, 0x61, 0x73, 0x6d, 2, 0, 0, 0]))).toThrow(
      'Unsupported WebAssembly version 2',
    );
  });

  it('keeps the sections before one that runs past the end of the file', () => {
    const full = sampleWasm();
    const m = moduleOf(full.slice(0, full.length - 5));
    expect(m.types).toHaveLength(4);
    expect(m.exports).toHaveLength(6);
    expect(m.sections.at(-1)?.name).toBe('.debug_info');
    expect(m.warnings).toEqual([
      'The .debug_info section at 0x236 declares 22 bytes but only 17 are left: the file is truncated',
    ]);
  });

  it('records a section that fails to parse and reads its neighbours', () => {
    const m = moduleOf(
      wasmModule(
        section(1, vec([funcType([I32], [])])),
        // An import with an unknown kind
        section(2, vec([[...name('a'), ...name('b'), 0x09, 0]])),
        section(3, vec([[0]])),
      ),
    );
    expect(m.types).toHaveLength(1);
    expect(m.functions).toEqual([0]);
    expect(m.warnings).toEqual(['The import section: Unknown import kind 9 at 0x16']);
  });

  it('reports an over-long LEB128 and a bad value type', () => {
    const m = moduleOf(
      wasmModule(
        section(3, [0x80, 0x80, 0x80, 0x80, 0x80, 0x80]),
        section(1, vec([[0x60, 1, 0x55, 0]])),
      ),
    );
    expect(m.warnings).toEqual([
      'The function section: function count at 0xa is over 5 bytes',
      'The type section: Unknown value type 0x55 at 0x15',
    ]);
  });

  it('never trusts declared counts', () => {
    const huge = [0xff, 0xff, 0xff, 0xff, 0x0f];
    const t0 = performance.now();
    const m = moduleOf(
      wasmModule(
        section(1, huge),
        section(2, [...uleb(500_000), 0, 0]),
        section(3, [...uleb(999_999), 1, 2, 3]),
        section(10, [...uleb(100_000), 1, 0]),
        nameSection([[1, [...uleb(1_000_000), 0, ...name('f')]]]),
        custom('producers', [...uleb(400_000), 1]),
      ),
    );
    expect(performance.now() - t0).toBeLessThan(500);
    expect(m.warnings).toEqual([
      'The type section: type at 0xa: 4294967295 entries is too many',
      'The import section: import at 0x11 declares 500000 entries but only 2 bytes are left',
      'The function section: function at 0x18 declares 999999 entries but only 3 bytes are left',
      'The code section: function body at 0x20 declares 100000 entries but only 2 bytes are left',
      expect.stringContaining('name section: name at'),
      expect.stringContaining('The producers section: producer field at'),
    ]);
  });

  it('keeps the names read before a cut-short name subsection', () => {
    const entries = nameMap([
      [0, 'first'],
      [1, 'second'],
      [2, 'third'],
    ]);
    // The function names subsection declares its full size, but the section ends early
    const sub = [1, ...uleb(entries.length), ...entries.slice(0, -4)];
    const m = moduleOf(wasmModule(custom('name', sub)));
    expect([...m.names.functions.values()]).toEqual(['first', 'second']);
    expect(m.warnings[0]).toBe('name section: the last subsection is cut short');
    expect(m.warnings).toHaveLength(2);
  });

  it('notes unknown sections and leftover bytes', () => {
    const m = moduleOf(wasmModule(section(42, [1, 2]), section(8, [0, 9, 9])));
    expect(m.sections.map(s => s.name)).toEqual(['unknown (42)', 'start']);
    expect(m.warnings).toEqual([
      'Unknown section id 42 at 0x8',
      'The start section has 2 unread bytes',
    ]);
  });
});

it('reads data segments with an explicit memory index', () => {
  const m = moduleOf(wasmModule(section(11, vec([[0x02, 0x00, ...i32Const(16), ...name('xyz')]]))));
  expect(m.dataSizes).toEqual([3]);
});
