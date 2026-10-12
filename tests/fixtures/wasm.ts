/**
 * Hand-assembled WebAssembly binaries for tests: helpers that emit LEB128 integers, names,
 * vectors and sections, and a small module that uses most of what the parser reads.
 */

export const I32 = 0x7f;
export const I64 = 0x7e;
export const F32 = 0x7d;
export const F64 = 0x7c;
export const V128 = 0x7b;
export const FUNCREF = 0x70;
export const EXTERNREF = 0x6f;

export function uleb(value: number | bigint): number[] {
  let n = BigInt(value);
  const out: number[] = [];
  do {
    let b = Number(n & 0x7fn);
    n >>= 7n;
    if (n !== 0n) b |= 0x80;
    out.push(b);
  } while (n !== 0n);
  return out;
}

export function sleb(value: number | bigint): number[] {
  let n = BigInt(value);
  const out: number[] = [];
  for (;;) {
    const b = Number(n & 0x7fn);
    n >>= 7n;
    const done = (n === 0n && (b & 0x40) === 0) || (n === -1n && (b & 0x40) !== 0);
    out.push(done ? b : b | 0x80);
    if (done) return out;
  }
}

export const utf8 = (s: string) => [...new TextEncoder().encode(s)];

/** A WebAssembly name: its UTF-8 length, then the bytes. */
export const name = (s: string) => [...uleb(utf8(s).length), ...utf8(s)];

export const vec = (items: number[][]) => [...uleb(items.length), ...items.flat()];

export const section = (id: number, payload: number[]) => [id, ...uleb(payload.length), ...payload];

export const custom = (n: string, payload: number[]) => section(0, [...name(n), ...payload]);

export const HEADER = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
/** A component: version 0x0d, layer 1. */
export const COMPONENT_HEADER = [0x00, 0x61, 0x73, 0x6d, 0x0d, 0x00, 0x01, 0x00];

export const wasmModule = (...sections: number[][]) =>
  Uint8Array.from([...HEADER, ...sections.flat()]);

export const funcType = (params: number[], results: number[]) => [
  0x60,
  ...vec(params.map(p => [p])),
  ...vec(results.map(r => [r])),
];

/** Limits: flags then min (and max), as LEB128. */
export const limits = (flags: number, min: number | bigint, max?: number | bigint) => [
  flags,
  ...uleb(min),
  ...(max === undefined ? [] : uleb(max)),
];

export const i32Const = (n: number) => [0x41, ...sleb(n), 0x0b];

/** A function body: no locals, then `code` and `end`. */
export const body = (code: number[]) => {
  const b = [0x00, ...code, 0x0b];
  return [...uleb(b.length), ...b];
};

export const producers = (fields: [string, [string, string][]][]) =>
  custom(
    'producers',
    vec(
      fields.map(([field, tools]) => [
        ...name(field),
        ...vec(tools.map(([n, v]) => [...name(n), ...name(v)])),
      ]),
    ),
  );

/** A name map: index → name. */
export const nameMap = (entries: [number, string][]) =>
  vec(entries.map(([i, n]) => [...uleb(i), ...name(n)]));

export const nameSection = (subsections: [number, number[]][]) =>
  custom(
    'name',
    subsections.flatMap(([id, payload]) => [id, ...uleb(payload.length), ...payload]),
  );

/**
 * A small valid module, in section order, that wabt reads too:
 * - imports: WASI `proc_exit`, an Emscripten-style `env` function, a table and a mutable global;
 * - three functions (`add`, `_start`, `pair` with two results), a table, a memory, two globals;
 * - exports, a start function, an element segment, data count, code and two data segments;
 * - name, producers (Rust), target_features, sourceMappingURL and `.debug_info` sections.
 */
export function sampleWasm(): Uint8Array<ArrayBuffer> {
  return wasmModule(
    section(
      1,
      vec([
        funcType([I32, I32], [I32]),
        funcType([], []),
        funcType([I32], []),
        funcType([I32, I64], [I32, I64]),
      ]),
    ),
    section(
      2,
      vec([
        [...name('wasi_snapshot_preview1'), ...name('proc_exit'), 0x00, 2],
        [...name('env'), ...name('emscripten_notify_memory_growth'), 0x00, 2],
        [...name('env'), ...name('__indirect_function_table'), 0x01, FUNCREF, ...limits(0, 1)],
        [...name('env'), ...name('__memory_base'), 0x03, I32, 0x00],
      ]),
    ),
    section(3, vec([[0], [1], [3]])),
    section(4, vec([[FUNCREF, ...limits(1, 2, 10)]])),
    section(5, vec([limits(1, 1, 256)])),
    section(
      6,
      vec([
        [I32, 0x01, ...i32Const(1024)],
        [I64, 0x00, 0x42, ...sleb(-42), 0x0b],
      ]),
    ),
    section(
      7,
      vec([
        [...name('add'), 0x00, ...uleb(2)],
        [...name('memory'), 0x02, 0],
        [...name('_start'), 0x00, 3],
        [...name('__stack_pointer'), 0x03, 1],
        [...name('table'), 0x01, 1],
        [...name('pair'), 0x00, 4],
      ]),
    ),
    section(8, uleb(3)),
    // One active segment for table 0 at offset 0: [add]
    section(9, vec([[0x00, ...i32Const(0), ...vec([[2]])]])),
    section(12, uleb(2)),
    section(10, vec([body([0x20, 0, 0x20, 1, 0x6a]), body([]), body([0x20, 0, 0x20, 1])])),
    section(
      11,
      vec([
        [0x00, ...i32Const(8), ...name('hi')],
        [0x01, ...name('abc')],
      ]),
    ),
    nameSection([
      [0, name('sample')],
      [
        1,
        nameMap([
          [0, 'proc_exit'],
          [2, 'add'],
          [3, '_start'],
          [4, 'pair'],
        ]),
      ],
      [
        2,
        vec([
          [
            2,
            ...nameMap([
              [0, 'a'],
              [1, 'b'],
            ]),
          ],
        ]),
      ],
    ]),
    producers([
      ['language', [['Rust', '1.80.0']]],
      [
        'processed-by',
        [
          ['rustc', '1.80.0 (051478957 2024-07-21)'],
          ['wasm-bindgen', '0.2.92'],
        ],
      ],
    ]),
    custom(
      'target_features',
      vec([
        [0x2b, ...name('bulk-memory')],
        [0x2b, ...name('mutable-globals')],
        [0x2d, ...name('simd128')],
      ]),
    ),
    custom('sourceMappingURL', name('sample.wasm.map')),
    custom('.debug_info', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
  );
}

/** A component (version 0x0d, layer 1): a core module, a type, an import, an export, producers. */
export function sampleComponent(): Uint8Array<ArrayBuffer> {
  return Uint8Array.from([
    ...COMPONENT_HEADER,
    ...section(1, [...HEADER]),
    ...section(7, [0x00]),
    ...section(10, [0x00]),
    ...section(11, [0x00]),
    ...producers([['language', [['Rust', '']]]]),
  ]);
}
