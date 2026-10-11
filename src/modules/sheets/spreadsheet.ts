import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { formatCount, plural } from '../../core/format';
import { hasKind } from '../../core/guards';
import { unsupportedSlice, type Interpreter } from '../../core/interpreter';
import {
  columnInfo,
  looksLikeHeader,
  toTsv,
  type RecordsValue,
} from '../../core/interpreters/records';
import { inferSchema } from '../../core/schema';
import type { StatRow, TableInfo } from '../../core/types';
import { sheetFormat, type SheetFormat } from './detect';

export interface SheetInfo {
  name: string;
  /** A1-style used range, e.g. "A1:H121"; empty for an empty sheet. */
  range: string;
  /** The sheet's rows as typed records, header detected as for delimited text. */
  records: RecordsValue;
  mergedCells: number;
  formulas: number;
}

export interface DefinedName {
  name: string;
  ref: string;
  /** Sheet the name is scoped to; absent for workbook-wide names. */
  sheet?: string;
}

export interface SpreadsheetValue {
  kind: 'spreadsheet';
  format: SheetFormat;
  sheets: SheetInfo[];
  definedNames: DefinedName[];
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Dates come back UTC-correct; drop the time when it's midnight, as a date-only cell. */
function dateCell(d: Date): string {
  if (Number.isNaN(d.getTime())) return '';
  const iso = d.toISOString();
  const midnight = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0;
  return midnight
    ? `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
    : iso.replace(/\.000Z$/, 'Z');
}

function cellValue(v: unknown): unknown {
  if (v instanceof Date) return dateCell(v);
  if (v === undefined || v === '') return null;
  return v;
}

function sheetRecords(ws: XLSX.WorkSheet): RecordsValue {
  const grid: unknown[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
    UTC: true,
  });
  const data = grid.map(row => row.map(cellValue));
  const first = data[0] ?? [];
  const hasHeader = looksLikeHeader(first);
  const width = Math.max(0, ...data.map(r => r.length));
  const columns = hasHeader
    ? first.map(h => String(h).trim())
    : Array.from({ length: width }, (_, i) => `col${i + 1}`);
  for (let i = columns.length; i < width; i++) columns.push(`col${i + 1}`);
  const rows = data.slice(hasHeader ? 1 : 0).map(row => {
    const rec: Record<string, unknown> = {};
    columns.forEach((col, i) => (rec[col] = row[i] ?? null));
    return rec;
  });
  return { kind: 'records', columns, rows, delimiter: null, hasHeader, source: 'spreadsheet' };
}

function countFormulas(ws: XLSX.WorkSheet): number {
  let n = 0;
  for (const [addr, cell] of Object.entries(ws)) {
    if (!addr.startsWith('!') && typeof cell === 'object' && cell !== null && 'f' in cell && cell.f)
      n++;
  }
  return n;
}

export function parseWorkbook(bytes: Uint8Array, format: SheetFormat): SpreadsheetValue {
  const wb = XLSX.read(bytes, {
    type: 'array',
    cellDates: true,
    cellFormula: true,
    cellStyles: false,
  });
  const sheets = wb.SheetNames.map((name): SheetInfo => {
    const ws = wb.Sheets[name];
    if (!ws) {
      return {
        name,
        range: '',
        records: sheetRecords({}),
        mergedCells: 0,
        formulas: 0,
      };
    }
    return {
      name,
      range: ws['!ref'] ?? '',
      records: sheetRecords(ws),
      mergedCells: ws['!merges']?.length ?? 0,
      formulas: countFormulas(ws),
    };
  });
  const definedNames = (wb.Workbook?.Names ?? []).map((n): DefinedName => {
    const scope = n.Sheet === undefined ? undefined : wb.SheetNames[n.Sheet];
    return { name: n.Name, ref: n.Ref, ...(scope !== undefined && { sheet: scope }) };
  });
  return { kind: 'spreadsheet', format, sheets, definedNames };
}

const dims = (s: SheetInfo) => `${formatCount(s.records.rows.length)}×${s.records.columns.length}`;

export function spreadsheetLabel(v: SpreadsheetValue): string {
  const parts = [v.format.toUpperCase(), plural(v.sheets.length, 'sheet')];
  const first = v.sheets[0];
  if (first) parts.push(`${first.name} ${dims(first)}`);
  return parts.join(' · ');
}

const tableInfo = (s: SheetInfo): TableInfo => ({
  name: s.name,
  extent: s.records.rows.length,
  columns: columnInfo(s.records).map(({ name, type }) => ({ name, type })),
});

function sheetStats(s: SheetInfo): StatRow {
  return {
    label: s.name,
    value: `${dims(s)}${s.range ? ` · ${s.range}` : ''}`,
    children: [
      { label: 'Header row', value: s.records.hasHeader ? 'yes' : 'no' },
      { label: 'Formulas', value: formatCount(s.formulas) },
      { label: 'Merged cells', value: formatCount(s.mergedCells) },
      {
        label: 'Column types',
        value: '',
        children: columnInfo(s.records).map(c => ({
          label: c.name,
          value: c.empty > 0 ? `${c.type} · ${formatCount(c.empty)} empty` : c.type,
        })),
      },
    ],
  };
}

const sheetAt = (v: SpreadsheetValue, i = 0): SheetInfo => {
  const s = v.sheets[i];
  if (!s) throw new Error(`No sheet ${i}`);
  return s;
};

export function sheetCsv(s: SheetInfo): string {
  const { columns, rows } = s.records;
  return Papa.unparse({ fields: columns, data: rows.map(r => columns.map(c => r[c] ?? '')) });
}

export const spreadsheetInterpreter: Interpreter<SpreadsheetValue> = {
  kind: 'spreadsheet',
  isValue: (v): v is SpreadsheetValue => hasKind(v, 'spreadsheet'),
  // Real detection is the cheap core detector in ./detect.ts; this runs only once loaded
  detect: c => (sheetFormat(c) ? 0.95 : 0),
  parse(c) {
    const format = sheetFormat(c);
    if (!format) throw new Error('Not a spreadsheet');
    return parseWorkbook(c.bytes, format);
  },
  label: spreadsheetLabel,
  summarise(v) {
    const tables = v.sheets.map(tableInfo);
    const formulas = v.sheets.reduce((n, s) => n + s.formulas, 0);
    const merged = v.sheets.reduce((n, s) => n + s.mergedCells, 0);
    return {
      stats: [
        { label: 'Format', value: v.format.toUpperCase() },
        {
          label: 'Sheets',
          value: formatCount(v.sheets.length),
          children: v.sheets.map(sheetStats),
        },
        { label: 'Formulas', value: formulas > 0 ? `yes · ${formatCount(formulas)}` : 'no' },
        { label: 'Merged cells', value: formatCount(merged) },
        {
          label: 'Defined names',
          value: formatCount(v.definedNames.length),
          children: v.definedNames.map(n => ({
            label: n.sheet ? `${n.sheet}!${n.name}` : n.name,
            value: n.ref,
          })),
        },
      ],
      schema: inferSchema(Object.fromEntries(v.sheets.map(s => [s.name, s.records.rows]))),
      extent: tables[0]?.extent ?? 0,
      columns: tables[0]?.columns ?? [],
      tables,
    };
  },
  slice(v, req) {
    if (req.type === 'rows') return sheetAt(v, req.table).records.rows.slice(req.from, req.to);
    return unsupportedSlice('spreadsheet', req);
  },
  // The sheet showing in the preview, else the first
  export: (v, options) => {
    const s = v.sheets[options?.table ?? 0] ?? v.sheets[0];
    return { text: s ? toTsv(s.records) : '' };
  },
  derivations: v => v.sheets.map((s, i) => ({ id: `sheet:${i}`, label: `Sheet ${s.name} as CSV` })),
  derive(v, id) {
    const s = sheetAt(v, Number(id.slice('sheet:'.length)));
    return {
      mime: 'text/csv',
      name: `${s.name}.csv`,
      bytes: new TextEncoder().encode(sheetCsv(s)),
    };
  },
};
