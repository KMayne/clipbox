import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { makeContent } from '../../src/core/content';
import { register } from '../../src/core/interpreter';
import { detectKinds, getInterpreter } from '../../src/core/interpreters';
import { Engine } from '../../src/engine/engine';
import { sheetFormat, spreadsheetDetector } from '../../src/modules/sheets/detect';
import { spreadsheetInterpreter } from '../../src/modules/sheets/spreadsheet';
import { bytesContent } from './helpers';

const sheet = register(spreadsheetInterpreter);

/** Two sheets: typed rows with a header, a formula and a merge; and a headerless grid. */
function workbook(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const people = XLSX.utils.aoa_to_sheet(
    [
      ['name', 'age', 'active', 'joined'],
      ['Ada', 36, true, new Date(Date.UTC(2020, 0, 15))],
      ['Linus', 54, false, new Date(Date.UTC(2021, 5, 1))],
      ['Grace', 85, true, null],
    ],
    { UTC: true },
  );
  people.E1 = { t: 's', v: 'total' };
  people.E2 = { t: 'n', v: 90, f: 'B2+B3' };
  people['!ref'] = 'A1:E4';
  people['!merges'] = [XLSX.utils.decode_range('E3:E4')];
  XLSX.utils.book_append_sheet(wb, people, 'People');
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
    ]),
    'Numbers',
  );
  wb.Workbook = { Names: [{ Name: 'Ages', Ref: 'People!$B$2:$B$4' }] };
  return wb;
}

const write = (wb: XLSX.WorkBook, bookType: XLSX.BookType): Uint8Array<ArrayBuffer> => {
  const out: unknown = XLSX.write(wb, { type: 'array', bookType });
  if (!(out instanceof ArrayBuffer)) throw new Error('Expected an ArrayBuffer');
  return new Uint8Array(out);
};

/** Minimal stored (uncompressed) zip; CRCs are left zero, which the detector never checks. */
function zip(files: Record<string, string>): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const local: number[] = [];
  const central: number[] = [];
  const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
  const u32 = (n: number) => [...u16(n & 0xffff), ...u16(n >>> 16)];
  for (const [name, body] of Object.entries(files)) {
    const n = [...enc.encode(name)];
    const data = [...enc.encode(body)];
    const offset = local.length;
    local.push(...u32(0x04034b50), ...u16(10), ...u16(0), ...u16(0), ...u32(0), ...u32(0));
    local.push(
      ...u32(data.length),
      ...u32(data.length),
      ...u16(n.length),
      ...u16(0),
      ...n,
      ...data,
    );
    central.push(...u32(0x02014b50), ...u16(20), ...u16(10), ...u16(0), ...u16(0), ...u32(0));
    central.push(...u32(0), ...u32(data.length), ...u32(data.length), ...u16(n.length));
    central.push(...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...n);
  }
  const count = Object.keys(files).length;
  const eocd = [...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(count), ...u16(count)];
  eocd.push(...u32(central.length), ...u32(local.length), ...u16(0));
  return new Uint8Array([...local, ...central, ...eocd]);
}

describe('spreadsheet detection', () => {
  it('recognises xlsx, ods and xls', () => {
    const wb = workbook();
    const xlsx = bytesContent(write(wb, 'xlsx'));
    expect(sheetFormat(xlsx)).toBe('xlsx');
    expect(spreadsheetDetector.detect(xlsx)).toBe(0.95);
    expect(sheetFormat(bytesContent(write(wb, 'ods')))).toBe('ods');
    expect(spreadsheetDetector.detect(bytesContent(write(wb, 'ods')))).toBe(0.95);
    const xls = bytesContent(write(wb, 'biff8'));
    expect(sheetFormat(xls)).toBe('xls');
    expect(spreadsheetDetector.detect(xls)).toBe(0.95);
  });

  it('ignores other zips and OLE files', () => {
    expect(
      spreadsheetDetector.detect(bytesContent(zip({ 'a.txt': 'hello', 'b/c.json': '{}' }))),
    ).toBe(0);
    const docx = zip({
      '[Content_Types].xml': '<Types/>',
      '_rels/.rels': '<Relationships/>',
      'word/document.xml': '<w:document/>',
    });
    expect(spreadsheetDetector.detect(bytesContent(docx))).toBe(0);
    // An ODF text document has content.xml too, but a different mimetype
    const odt = zip({ mimetype: 'application/vnd.oasis.opendocument.text', 'content.xml': '<x/>' });
    expect(spreadsheetDetector.detect(bytesContent(odt))).toBe(0);
    const ole = new Uint8Array(1536);
    ole.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect(spreadsheetDetector.detect(bytesContent(ole))).toBe(0);
    expect(
      spreadsheetDetector.detect(makeContent('application/vnd.ms-excel', ole, 'old.xls')),
    ).toBe(0.7);
  });
});

describe('spreadsheet interpreter', () => {
  const content = bytesContent(write(workbook(), 'xlsx'));

  it('lists sheets with typed rows, formulas, merges and defined names', async () => {
    const v = await sheet.parse(content, { service: async () => null });
    expect(sheet.label(v)).toBe('XLSX · 2 sheets · People 3×5');
    const s = await sheet.summarise(v);
    expect(s.tables?.map(t => [t.name, t.extent, t.columns.length])).toEqual([
      ['People', 3, 5],
      ['Numbers', 3, 3],
    ]);
    expect(s.tables?.[0]?.columns.map(c => c.type)).toEqual([
      'string',
      'number',
      'boolean',
      'date',
      'number',
    ]);
    expect(await sheet.slice(v, { type: 'rows', from: 0, to: 2 })).toEqual([
      { name: 'Ada', age: 36, active: true, joined: '2020-01-15', total: 90 },
      { name: 'Linus', age: 54, active: false, joined: '2021-06-01', total: null },
    ]);
    // Headerless sheet gets generated column names
    expect(await sheet.slice(v, { type: 'rows', from: 2, to: 3, table: 1 })).toEqual([
      { col1: 7, col2: 8, col3: 9 },
    ]);
    const stat = (label: string) => s.stats.find(r => r.label === label);
    expect(stat('Formulas')?.value).toBe('yes · 1');
    expect(stat('Merged cells')?.value).toBe('1');
    expect(stat('Defined names')?.children).toEqual([{ label: 'Ages', value: 'People!$B$2:$B$4' }]);
    expect(stat('Sheets')?.children?.map(c => [c.label, c.value])).toEqual([
      ['People', '3×5 · A1:E4'],
      ['Numbers', '3×3 · A1:C3'],
    ]);
    expect((await sheet.export(v)).text?.split('\n')[0]).toBe('name\tage\tactive\tjoined\ttotal');
    // Copy takes the selected sheet; an out-of-range index falls back to the first
    expect((await sheet.export(v, { table: 1 })).text?.split('\n')[0]).toBe('col1\tcol2\tcol3');
    expect((await sheet.export(v, { table: 9 })).text?.split('\n')[0]).toBe(
      'name\tage\tactive\tjoined\ttotal',
    );
  });

  it('derives each sheet as CSV that records picks up', async () => {
    const v = await sheet.parse(content, { service: async () => null });
    expect(sheet.derivations(v).map(d => d.label)).toEqual([
      'Sheet People as CSV',
      'Sheet Numbers as CSV',
    ]);
    const out = await sheet.derive(v, 'sheet:0');
    expect(out).toMatchObject({ mime: 'text/csv', name: 'People.csv' });
    const csv = makeContent(out.mime, out.bytes, out.name);
    expect(detectKinds(csv)[0]?.kind).toBe('records');
    const records = getInterpreter('records');
    const rv = await records.parse(csv, { service: async () => null });
    expect(records.label(rv)).toBe('Records 3×5');
    expect(await records.slice(rv, { type: 'rows', from: 0, to: 1 })).toEqual([
      { name: 'Ada', age: 36, active: true, joined: '2020-01-15', total: 90 },
    ]);
  });

  it('loads lazily through the engine', async () => {
    const engine = new Engine({
      loaders: { sheets: () => import('../../src/modules/sheets/worker') },
    });
    const entry = {
      id: 'en-1' as const,
      mime: 'application/octet-stream',
      size: content.size,
      blob: new Blob([content.bytes]),
      name: 'people.xlsx',
    };
    const res = await engine.ingest(entry);
    expect(res.interpretations[0]).toMatchObject({
      kind: 'spreadsheet',
      status: 'loading',
      module: 'sheets',
    });
    expect(await engine.resolve('en-1', 'spreadsheet')).toMatchObject({
      status: 'ready',
      label: 'XLSX · 2 sheets · People 3×5',
    });
  });
});
