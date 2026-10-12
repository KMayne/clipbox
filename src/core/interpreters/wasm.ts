import { hasKind } from '../guards';
import { unsupportedSlice, type Interpreter } from '../interpreter';
import {
  tableInfos,
  tableTsv,
  wasmLabel,
  wasmLayout,
  wasmStats,
  wasmTables,
} from '../wasm/describe';
import { isWasm, parseWasm } from '../wasm/parse';
import type { WasmValue } from '../wasm/types';

/** Above binary (0.2), which stays on offer. */
const CONFIDENCE = 0.95;

/** WebAssembly binaries: core modules (version 1) and components, parsed in core. */
export const wasmInterpreter: Interpreter<WasmValue> = {
  kind: 'wasm',
  isValue: (v): v is WasmValue => hasKind(v, 'wasm'),
  detect: c => (c.magic === 'wasm' && isWasm(c.bytes) ? CONFIDENCE : 0),
  parse: c => ({ kind: 'wasm', bytes: c.bytes, info: parseWasm(c.bytes) }),
  label: wasmLabel,
  summarise(v) {
    const tables = tableInfos(v);
    return {
      stats: wasmStats(v),
      extent: tables[0]?.extent ?? 0,
      columns: tables[0]?.columns ?? [],
      tables,
    };
  },
  slice(v, req) {
    switch (req.type) {
      case 'json':
        return wasmLayout(v);
      case 'rows': {
        const t = wasmTables(v)[req.table ?? 0];
        if (!t) throw new Error(`No table ${req.table ?? 0}`);
        return t.rows.slice(req.from, req.to);
      }
      case 'count':
        return wasmTables(v)[req.table]?.rows.length ?? 0;
      case 'bytes':
        return v.bytes.slice(req.from, req.to);
      default:
        return unsupportedSlice('wasm', req);
    }
  },
  export: (v, options) => ({ text: tableTsv(v, options?.table ?? 0) }),
};
