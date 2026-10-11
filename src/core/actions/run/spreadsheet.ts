import { isRecord } from '../../guards';
import { spreadsheetAllJson, spreadsheetSheetJson } from '../catalog/spreadsheet';
import { implement } from '../types';
import { textResult, withExtension } from './util';

/**
 * The fields of the sheets module's value these actions read (plain data, parsed already), so
 * this file doesn't pull SheetJS into the core worker chunk.
 */
interface SheetData {
  name: string;
  records: { columns: string[]; rows: Record<string, unknown>[]; hasHeader: boolean };
}

interface SpreadsheetData {
  kind: 'spreadsheet';
  sheets: SheetData[];
}

const isSheetData = (s: unknown): s is SheetData =>
  isRecord(s) &&
  typeof s.name === 'string' &&
  isRecord(s.records) &&
  Array.isArray(s.records.columns) &&
  s.records.columns.every(c => typeof c === 'string') &&
  Array.isArray(s.records.rows) &&
  s.records.rows.every(isRecord) &&
  typeof s.records.hasHeader === 'boolean';

const isSpreadsheetData = (v: unknown): v is SpreadsheetData =>
  isRecord(v) && v.kind === 'spreadsheet' && Array.isArray(v.sheets) && v.sheets.every(isSheetData);

/**
 * Picks a sheet or table by name (exact, then ignoring case) or 1-based number; empty is the
 * first. Shared with SQLite's "Table as JSON".
 */
export function pick<T extends { name: string }>(items: T[], query: string, unit: string): number {
  const q = query.trim();
  if (q === '') {
    if (!items.length) throw new Error(`There are no ${unit}s`);
    return 0;
  }
  let i = items.findIndex(s => s.name === q);
  if (i === -1) i = items.findIndex(s => s.name.toLowerCase() === q.toLowerCase());
  if (i === -1 && /^\d+$/.test(q) && Number(q) >= 1 && Number(q) <= items.length) i = Number(q) - 1;
  if (i === -1) {
    const names = items.map(s => s.name).join(', ');
    throw new Error(`No ${unit} '${q}' (${unit}s: ${names || 'none'})`);
  }
  return i;
}

/** The sheet as it was in the file: the header row (if one was detected) then the data rows. */
function grid({ records }: SheetData): unknown[][] {
  const { columns, rows, hasHeader } = records;
  const data = rows.map(r => columns.map(c => r[c] ?? null));
  return hasHeader ? [columns, ...data] : data;
}

/** Keys from a header row: blanks get `colN`, repeats get `_2`, `_3`… */
function keysOf(header: unknown[]): string[] {
  const seen = new Map<string, number>();
  return header.map((h, i) => {
    const base = h === null || String(h).trim() === '' ? `col${i + 1}` : String(h).trim();
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}_${n}`;
  });
}

/** Objects keyed by the first row, or every row as an array of cells. */
export function sheetJson(sheet: SheetData, header: boolean): unknown[] {
  const rows = grid(sheet);
  if (!header) return rows;
  const [first = [], ...data] = rows;
  const keys = keysOf(first);
  return data.map(row => Object.fromEntries(keys.map((k, i) => [k, row[i] ?? null])));
}

const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;

export const spreadsheetImpls = [
  implement(spreadsheetSheetJson, {
    value: isSpreadsheetData,
    applies: ({ value }) => value.sheets.length > 0,
    run({ value }, { sheet, header }) {
      const s = value.sheets[pick(value.sheets, sheet, 'sheet')];
      if (!s) throw new Error('No such sheet');
      return textResult(json(sheetJson(s, header)), 'application/json', `${s.name}.json`);
    },
  }),
  implement(spreadsheetAllJson, {
    value: isSpreadsheetData,
    applies: ({ value }) => value.sheets.length > 0,
    run: ({ value, content }, { header }) =>
      textResult(
        json(Object.fromEntries(value.sheets.map(s => [s.name, sheetJson(s, header)]))),
        'application/json',
        withExtension(content.name, 'json', 'workbook'),
      ),
  }),
];
