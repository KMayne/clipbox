/**
 * Display helpers for WebAssembly values: label, Info stats, the preview's layout and its tables
 * (imports, exports, functions, sections), all derived from the parsed module.
 */
import { formatBytes, formatCount, plural } from '../format';
import type { ColumnInfo, StatRow, TableInfo } from '../types';
import type {
  ImportDesc,
  Limits,
  WasmComponent,
  WasmImport,
  WasmLayout,
  WasmModule,
  WasmType,
  WasmValue,
} from './types';

/** The default page size: 64 KiB. */
const PAGE_LOG2 = 16;

const hex = (n: number) => `0x${n.toString(16).toUpperCase().padStart(8, '0')}`;

const WASI_MODULE = /^(wasi_snapshot_preview1|wasi_unstable|wasi:.*)$/;

// Functions and signatures

/** Type index of each function, imports first (the function index space). */
const funcTypeCache = new WeakMap<WasmModule, number[]>();

export function functionTypes(m: WasmModule): number[] {
  let types = funcTypeCache.get(m);
  if (!types) {
    types = [];
    for (const i of m.imports) if (i.desc.kind === 'func') types.push(i.desc.type);
    for (const t of m.functions) types.push(t);
    funcTypeCache.set(m, types);
  }
  return types;
}

const importCache = new WeakMap<WasmModule, Map<string, WasmImport[]>>();

/** The imports of one kind, in order (the start of that kind's index space). */
export function importsOf(m: WasmModule, kind: ImportDesc['kind']): WasmImport[] {
  let byKind = importCache.get(m);
  if (!byKind) {
    byKind = new Map();
    for (const i of m.imports) {
      const list = byKind.get(i.desc.kind) ?? [];
      list.push(i);
      byKind.set(i.desc.kind, list);
    }
    importCache.set(m, byKind);
  }
  return byKind.get(kind) ?? [];
}

export const importedFunctions = (m: WasmModule) => importsOf(m, 'func');

/** "(i32, i32) → i64"; no results is "()", several are "(i32, i64)". */
export function signatureText(t: WasmType | undefined, index?: number): string {
  if (!t) return index === undefined ? 'unknown type' : `type ${index} (missing)`;
  if (t.form === 'gc') return t.description;
  const results = t.results.length === 1 ? (t.results[0] ?? '') : `(${t.results.join(', ')})`;
  return `(${t.params.join(', ')}) → ${results}`;
}

export const typeSignature = (m: WasmModule, typeIndex: number) =>
  signatureText(m.types[typeIndex], typeIndex);

export const functionSignature = (m: WasmModule, funcIndex: number) => {
  const t = functionTypes(m)[funcIndex];
  return t === undefined ? `function ${funcIndex} (missing)` : typeSignature(m, t);
};

export const functionName = (m: WasmModule, funcIndex: number) =>
  m.names.functions.get(funcIndex) ?? null;

export function limitsText(l: Limits, memory: boolean): string {
  const page = 2 ** (l.pageSizeLog2 ?? PAGE_LOG2);
  const one = (n: number) =>
    memory ? `${plural(n, 'page')} (${formatBytes(n * page)})` : formatCount(n);
  const range = l.max === null ? `${one(l.min)}, no maximum` : `${one(l.min)} – ${one(l.max)}`;
  const flags = [
    l.shared && 'shared',
    l.is64 && '64-bit',
    l.pageSizeLog2 !== null && `${formatBytes(page)} pages`,
  ]
    .filter(Boolean)
    .join(', ');
  return flags ? `${range} · ${flags}` : range;
}

/** What an import or export is: a signature, limits or a global's type. */
export function descText(m: WasmModule, d: ImportDesc): string {
  switch (d.kind) {
    case 'func':
    case 'tag':
      return typeSignature(m, d.type);
    case 'table':
      return `${d.table.element}, ${limitsText(d.table.limits, false)}`;
    case 'memory':
      return limitsText(d.limits, true);
    case 'global':
      return `${d.global.mutable ? 'mut ' : ''}${d.global.type}`;
  }
}

/** The kind's index of each import (the nth imported function, table, …). */
function importIndices(imports: WasmImport[]): number[] {
  const next: Record<string, number> = {};
  return imports.map(i => {
    const n = next[i.desc.kind] ?? 0;
    next[i.desc.kind] = n + 1;
    return n;
  });
}

/** What an export refers to: a signature, limits or a global's type. */
export function exportTarget(m: WasmModule, kind: string, index: number): string {
  const imported = (k: ImportDesc['kind']) => importsOf(m, k);
  switch (kind) {
    case 'func':
      return functionSignature(m, index);
    case 'tag': {
      const tags = imported('tag');
      const own = m.tags[index - tags.length];
      const t = index < tags.length ? tags[index]?.desc : undefined;
      if (t?.kind === 'tag') return typeSignature(m, t.type);
      return own === undefined ? `tag ${index} (missing)` : typeSignature(m, own);
    }
    case 'table': {
      const tables = imported('table');
      const t = tables[index]?.desc;
      if (t) return descText(m, t);
      const own = m.tables[index - tables.length];
      return own ? descText(m, { kind: 'table', table: own }) : `table ${index} (missing)`;
    }
    case 'memory': {
      const mems = imported('memory');
      const t = mems[index]?.desc;
      if (t) return descText(m, t);
      const own = m.memories[index - mems.length];
      return own ? limitsText(own, true) : `memory ${index} (missing)`;
    }
    case 'global': {
      const globals = imported('global');
      const t = globals[index]?.desc;
      if (t) return descText(m, t);
      const own = m.globals[index - globals.length];
      if (!own) return `global ${index} (missing)`;
      const type = `${own.mutable ? 'mut ' : ''}${own.type}`;
      return own.init ? `${type} = ${own.init.replace(/^\S+\.const /, '')}` : type;
    }
    default:
      return '';
  }
}

// Facts

export function language(m: WasmModule | WasmComponent): string | null {
  const field = m.producers.find(p => p.field === 'language');
  return field?.values[0]?.name ?? null;
}

const producerText = (values: { name: string; version: string }[]) =>
  values.map(v => (v.version ? `${v.name} ${v.version}` : v.name)).join(', ');

const PRODUCER_FIELDS: Record<string, string> = {
  language: 'Language',
  'processed-by': 'Processed by',
  sdk: 'SDK',
};

export function wasiModules(m: WasmModule): string[] {
  return [...new Set(m.imports.map(i => i.module).filter(n => WASI_MODULE.test(n)))];
}

/** Imports that suggest an Emscripten build (`env.emscripten_*`, `__syscall_*`, …). */
export function emscriptenImports(m: WasmModule): number {
  return m.imports.filter(
    i => i.module === 'env' && /^(_?emscripten_|__syscall_|_embind_|invoke_[vidjf]+$)/.test(i.name),
  ).length;
}

const debugSections = (v: WasmValue) =>
  v.info.sections.filter(s => s.custom && s.name.startsWith('.debug_'));

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function wasmLabel(v: WasmValue): string {
  const m = v.info;
  if (m.format === 'component') {
    const lang = language(m);
    return ['WASM component', plural(m.sections.length, 'section'), ...(lang ? [lang] : [])].join(
      ' · ',
    );
  }
  const lang = language(m);
  return [
    'WebAssembly',
    plural(m.functions.length, 'function'),
    plural(m.exports.length, 'export'),
    ...(lang ? [lang] : []),
  ].join(' · ');
}

function countBy<T>(xs: T[], key: (x: T) => string): StatRow[] {
  const counts = new Map<string, number>();
  for (const x of xs) counts.set(key(x), (counts.get(key(x)) ?? 0) + 1);
  return [...counts].map(([label, n]) => ({ label, value: formatCount(n) }));
}

export function wasmStats(v: WasmValue): StatRow[] {
  const m = v.info;
  const custom = v.info.sections.filter(s => s.custom);
  const customRow: StatRow[] = custom.length
    ? [
        {
          label: 'Custom sections',
          value: `${formatCount(custom.length)} · ${formatBytes(sum(custom.map(s => s.size)))}`,
          children: custom.map(s => ({ label: s.name, value: formatBytes(s.size) })),
        },
      ]
    : [];
  const producers: StatRow[] = m.producers.map(p => ({
    label: PRODUCER_FIELDS[p.field] ?? p.field,
    value: producerText(p.values) || '—',
  }));
  const notes = m.warnings.map(w => ({ label: 'Note', value: w }));
  if (m.format === 'component') {
    return [
      { label: 'Format', value: `Component (version ${m.version}, layer 1)` },
      { label: 'Size', value: formatBytes(v.bytes.byteLength) },
      {
        label: 'Sections',
        value: formatCount(m.sections.length),
        children: countBy(m.sections, s => s.name),
      },
      ...producers,
      ...customRow,
      ...notes,
    ];
  }
  const imported = importedFunctions(m).length;
  const total = imported + m.functions.length;
  const wasi = wasiModules(m);
  const emscripten = emscriptenImports(m);
  const debug = debugSections(v);
  const start = m.start === null ? null : (functionName(m, m.start) ?? `function ${m.start}`);
  const rows: (StatRow | false)[] = [
    { label: 'Format', value: 'Core module, version 1' },
    { label: 'Size', value: formatBytes(v.bytes.byteLength) },
    m.names.module !== null && { label: 'Module name', value: m.names.module },
    {
      label: 'Functions',
      value: `${formatCount(total)} · ${formatCount(imported)} imported, ${formatCount(m.functions.length)} defined`,
    },
    {
      label: 'Imports',
      value: formatCount(m.imports.length),
      ...(m.imports.length > 0 && { children: countBy(m.imports, i => i.module) }),
    },
    {
      label: 'Exports',
      value: formatCount(m.exports.length),
      ...(m.exports.length > 0 && { children: countBy(m.exports, e => e.kind) }),
    },
    {
      label: 'Memory',
      value:
        m.memories.length === 0
          ? importedKind(m, 'memory') || 'None'
          : m.memories.map(l => limitsText(l, true)).join('; '),
    },
    {
      label: 'Tables',
      value:
        m.tables.length === 0
          ? importedKind(m, 'table') || 'None'
          : m.tables.map(t => `${t.element}, ${limitsText(t.limits, false)}`).join('; '),
    },
    {
      label: 'Globals',
      value: `${formatCount(m.globals.length)}${
        m.globals.some(g => g.mutable)
          ? ` · ${formatCount(m.globals.filter(g => g.mutable).length)} mutable`
          : ''
      }`,
    },
    m.tags.length > 0 && { label: 'Tags', value: formatCount(m.tags.length) },
    { label: 'Start function', value: start ?? 'None' },
    {
      label: 'Code',
      value: `${formatCount(m.bodySizes.length)} ${m.bodySizes.length === 1 ? 'body' : 'bodies'} · ${formatBytes(sum(m.bodySizes))}`,
    },
    {
      label: 'Data segments',
      value: `${formatCount(m.dataSizes.length)} · ${formatBytes(sum(m.dataSizes))}`,
    },
    m.elements > 0 && { label: 'Element segments', value: formatCount(m.elements) },
    {
      label: 'WASI',
      value: wasi.length
        ? `Yes · ${wasi.join(', ')} (${plural(
            m.imports.filter(i => wasi.includes(i.module)).length,
            'import',
          )})`
        : 'No',
    },
    emscripten > 0 && {
      label: 'Emscripten',
      value: `Likely · ${plural(emscripten, 'runtime import')}`,
    },
    ...producers,
    m.features.length > 0 && { label: 'Target features', value: m.features.join(' ') },
    m.names.functions.size > 0 && {
      label: 'Names',
      value: [
        `${formatCount(m.names.functions.size)} functions`,
        ...(m.names.locals > 0 ? [`${formatCount(m.names.locals)} locals`] : []),
      ].join(', '),
    },
    debug.length > 0 && {
      label: 'Debug info',
      value: `DWARF · ${formatBytes(sum(debug.map(s => s.size)))}`,
      children: debug.map(s => ({ label: s.name, value: formatBytes(s.size) })),
    },
    m.sourceMappingUrl !== null && { label: 'Source map', value: m.sourceMappingUrl },
    m.externalDebugInfo !== null && { label: 'External debug info', value: m.externalDebugInfo },
    m.dylink !== null && {
      label: 'Dynamic library',
      value: [
        `memory ${formatBytes(m.dylink.memorySize)}`,
        `table ${formatCount(m.dylink.tableSize)}`,
        ...(m.dylink.needed.length ? [`needs ${m.dylink.needed.join(', ')}`] : []),
      ].join(', '),
    },
    ...customRow,
    ...notes,
  ];
  return rows.filter(r => r !== false);
}

function importedKind(m: WasmModule, kind: 'memory' | 'table'): string {
  const i = m.imports.find(x => x.desc.kind === kind);
  return i ? `Imported from ${i.module}.${i.name}: ${descText(m, i.desc)}` : '';
}

function badges(v: WasmValue): string[] {
  const m = v.info;
  const lang = language(m);
  if (m.format === 'component') return lang ? [lang] : [];
  const out: string[] = [];
  if (lang) out.push(lang);
  if (wasiModules(m).length) out.push('WASI');
  if (emscriptenImports(m) > 0) out.push('Emscripten');
  const mems = [
    ...m.memories,
    ...m.imports.flatMap(i => (i.desc.kind === 'memory' ? [i.desc.limits] : [])),
  ];
  if (mems.some(l => l.is64)) out.push('memory64');
  if (mems.some(l => l.shared)) out.push('Shared memory');
  if (m.types.some(t => t.form === 'gc')) out.push('GC types');
  if (m.tags.length || m.imports.some(i => i.desc.kind === 'tag')) out.push('Exceptions');
  if (debugSections(v).length) out.push('DWARF');
  if (m.sourceMappingUrl !== null) out.push('Source map');
  if (m.dylink !== null) out.push('Dynamic library');
  return out;
}

/** The Info stats repeated in the preview's card; imports and exports have their own tabs. */
const FACTS = new Set([
  'Module name',
  'Sections',
  'Functions',
  'Memory',
  'Tables',
  'Globals',
  'Tags',
  'Start function',
  'Code',
  'Data segments',
  'Processed by',
  'SDK',
]);

export function wasmLayout(v: WasmValue): WasmLayout {
  const m = v.info;
  return {
    title: wasmLabel(v),
    format:
      m.format === 'component'
        ? `WebAssembly component (version ${m.version}, layer 1)`
        : 'WebAssembly core module, version 1',
    badges: badges(v),
    facts: wasmStats(v)
      .filter(r => FACTS.has(r.label))
      .map(r => ({ label: r.label, value: r.value })),
    sections: m.sections.map(s => ({ name: s.name, size: s.size, custom: s.custom })),
    size: v.bytes.byteLength,
    warnings: m.warnings,
  };
}

// Tables

interface WasmTable {
  name: string;
  columns: ColumnInfo[];
  rows: Record<string, unknown>[];
}

const col = (name: string, type = 'string'): ColumnInfo => ({ name, type });

const tableCache = new WeakMap<WasmValue, WasmTable[]>();

/** Imports, Exports and Functions (when non-empty), then Sections; components only Sections. */
export function wasmTables(v: WasmValue): WasmTable[] {
  const cached = tableCache.get(v);
  if (cached) return cached;
  const m = v.info;
  const tables: WasmTable[] = [];
  if (m.format === 'module') {
    if (m.imports.length) {
      const indices = importIndices(m.imports);
      tables.push({
        name: 'Imports',
        columns: [
          col('module'),
          col('name'),
          col('kind'),
          col('signature'),
          col('index', 'number'),
        ],
        rows: m.imports.map((i, n) => ({
          module: i.module,
          name: i.name,
          kind: i.desc.kind,
          index: indices[n] ?? n,
          signature: descText(m, i.desc),
        })),
      });
    }
    if (m.exports.length) {
      tables.push({
        name: 'Exports',
        columns: [
          col('name'),
          col('kind'),
          col('signature'),
          col('function'),
          col('index', 'number'),
        ],
        rows: m.exports.map(e => ({
          name: e.name,
          kind: e.kind,
          index: e.index,
          function: e.kind === 'func' ? (functionName(m, e.index) ?? '') : '',
          signature: exportTarget(m, e.kind, e.index),
        })),
      });
    }
    const types = functionTypes(m);
    if (types.length) {
      const imports = importedFunctions(m);
      const exported = new Map<number, string[]>();
      for (const e of m.exports) {
        if (e.kind !== 'func') continue;
        const names = exported.get(e.index) ?? [];
        names.push(e.name);
        exported.set(e.index, names);
      }
      tables.push({
        name: 'Functions',
        columns: [
          col('index', 'number'),
          col('name'),
          col('signature'),
          col('body size', 'number'),
          col('exported as'),
          col('imported from'),
        ],
        rows: types.map((_, i) => {
          const imp = imports[i];
          return {
            index: i,
            name: functionName(m, i) ?? '',
            signature: functionSignature(m, i),
            'body size': imp ? null : (m.bodySizes[i - imports.length] ?? null),
            'exported as': exported.get(i)?.join(', ') ?? '',
            'imported from': imp ? `${imp.module}.${imp.name}` : '',
          };
        }),
      });
    }
  }
  tables.push({
    name: 'Sections',
    columns: [col('id', 'number'), col('name'), col('offset'), col('size', 'number')],
    rows: m.sections.map(s => ({
      id: s.id,
      name: s.custom ? `custom: ${s.name}` : s.name,
      offset: hex(s.offset),
      size: s.size,
    })),
  });
  tableCache.set(v, tables);
  return tables;
}

export const tableInfos = (v: WasmValue): TableInfo[] =>
  wasmTables(v).map(t => ({ name: t.name, extent: t.rows.length, columns: t.columns }));

/** One table as tab-separated text (what Copy gives). */
export function tableTsv(v: WasmValue, index: number): string {
  const t = wasmTables(v)[index];
  if (!t) return '';
  const cell = (x: unknown) => (x === null || x === undefined ? '' : String(x));
  return [
    t.columns.map(c => c.name).join('\t'),
    ...t.rows.map(r => t.columns.map(c => cell(r[c.name])).join('\t')),
  ].join('\n');
}

/** The module's interface: imports and exports with their types, for the JSON action. */
export function interfaceJson(v: WasmValue): unknown {
  const m = v.info;
  if (m.format === 'component') throw new Error('Components have no core imports or exports');
  return {
    imports: m.imports.map(i => ({
      module: i.module,
      name: i.name,
      kind: i.desc.kind,
      type: descText(m, i.desc),
      ...(i.desc.kind === 'func' && {
        params: paramsOf(m, i.desc.type),
        results: resultsOf(m, i.desc.type),
      }),
    })),
    exports: m.exports.map(e => {
      const t = e.kind === 'func' ? functionTypes(m)[e.index] : undefined;
      const name = e.kind === 'func' ? functionName(m, e.index) : null;
      return {
        name: e.name,
        kind: e.kind,
        index: e.index,
        type: exportTarget(m, e.kind, e.index),
        ...(name !== null && { function: name }),
        ...(t !== undefined && { params: paramsOf(m, t), results: resultsOf(m, t) }),
      };
    }),
  };
}

const paramsOf = (m: WasmModule, t: number) => {
  const type = m.types[t];
  return type?.form === 'func' ? type.params : null;
};
const resultsOf = (m: WasmModule, t: number) => {
  const type = m.types[t];
  return type?.form === 'func' ? type.results : null;
};
