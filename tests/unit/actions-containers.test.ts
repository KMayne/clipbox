import { strToU8, zipSync } from 'fflate';
import initSqlJs from 'sql.js';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { register } from '../../src/core/interpreter';
import { Engine } from '../../src/engine/engine';
import { createSqliteInterpreter } from '../../src/modules/sqlite/sqlite';
import { service as sqliteService } from '../../src/modules/sqlite/worker';
import { pdfBytes, samplePdf } from '../fixtures/pdf';

const td = new TextDecoder();

async function ingest(engine: Engine, bytes: Uint8Array<ArrayBuffer>, mime: string, name: string) {
  const blob = new Blob([bytes], { type: mime });
  await engine.ingest({ id: 'en-1', mime, size: blob.size, blob, name });
}

async function run(engine: Engine, kind: string, id: string, params: unknown = {}) {
  const out = await engine.runAction('en-1', kind, id, params);
  return out.map(o => ({ name: o.name, mime: o.mime, text: td.decode(o.bytes) }));
}

describe('spreadsheet actions', () => {
  function xlsx(): Uint8Array<ArrayBuffer> {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['name', 'age', 'name'],
        ['Ada', 36, 'x'],
        ['Linus', 54, null],
      ]),
      'People',
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        [1, 2],
        [3, 4],
      ]),
      'Numbers',
    );
    const out: unknown = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    if (!(out instanceof ArrayBuffer)) throw new Error('Expected an ArrayBuffer');
    return new Uint8Array(out);
  }

  async function engine() {
    const e = new Engine({ loaders: { sheets: () => import('../../src/modules/sheets/worker') } });
    await ingest(e, xlsx(), 'application/octet-stream', 'book.xlsx');
    await e.resolve('en-1', 'spreadsheet');
    return e;
  }

  it('converts one sheet, picked by name or number, with or without keys', async () => {
    const e = await engine();
    const [first] = await run(e, 'spreadsheet', 'spreadsheet.sheetJson');
    expect(first).toMatchObject({ name: 'People.json', mime: 'application/json' });
    // A repeated header gets a suffix rather than overwriting
    expect(JSON.parse(first?.text ?? '')).toEqual([
      { name: 'Ada', age: 36, name_2: 'x' },
      { name: 'Linus', age: 54, name_2: null },
    ]);
    const [numbers] = await run(e, 'spreadsheet', 'spreadsheet.sheetJson', {
      sheet: '2',
      header: false,
    });
    expect(JSON.parse(numbers?.text ?? '')).toEqual([
      [1, 2],
      [3, 4],
    ]);
    const [byName] = await run(e, 'spreadsheet', 'spreadsheet.sheetJson', { sheet: 'numbers' });
    expect(JSON.parse(byName?.text ?? '')).toEqual([{ '1': 3, '2': 4 }]);
    await expect(run(e, 'spreadsheet', 'spreadsheet.sheetJson', { sheet: 'Nope' })).rejects.toThrow(
      "No sheet 'Nope' (sheets: People, Numbers)",
    );
  });

  it('converts every sheet into one object', async () => {
    const [all] = await run(await engine(), 'spreadsheet', 'spreadsheet.allJson', {
      header: false,
    });
    expect(all?.name).toBe('book.json');
    expect(Object.keys(JSON.parse(all?.text ?? ''))).toEqual(['People', 'Numbers']);
  });
});

describe('sqlite actions', () => {
  async function engine() {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run(`
      CREATE TABLE people (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, avatar BLOB);
      CREATE VIEW named AS SELECT name FROM people;
      CREATE INDEX people_name ON people(name);
      CREATE TRIGGER t AFTER INSERT ON people BEGIN SELECT 1; END;
      CREATE TABLE tags (tag TEXT);
      INSERT INTO people (name, avatar) VALUES ('Ada', x'01ff'), ('Linus', NULL);
    `);
    const bytes = new Uint8Array(db.export());
    db.close();
    const e = new Engine({
      loaders: {
        sqlite: async () => ({
          interpreters: [register(createSqliteInterpreter(() => initSqlJs()))],
          service: sqliteService,
        }),
      },
    });
    await ingest(e, bytes, 'application/vnd.sqlite3', 'app.db');
    await e.resolve('en-1', 'sqlite');
    return e;
  }

  it('dumps a table as JSON, blobs as hex', async () => {
    const e = await engine();
    const [out] = await run(e, 'sqlite', 'sqlite.tableJson');
    expect(out).toMatchObject({ name: 'people.json', mime: 'application/json' });
    expect(JSON.parse(out?.text ?? '')).toEqual([
      { id: 1, name: 'Ada', avatar: "x'01ff'" },
      { id: 2, name: 'Linus', avatar: null },
    ]);
    const [tags] = await run(e, 'sqlite', 'sqlite.tableJson', { table: 'tags' });
    expect(tags?.text).toBe('[]\n');
  });

  it('writes the schema with tables first', async () => {
    const [out] = await run(await engine(), 'sqlite', 'sqlite.schema');
    expect(out).toMatchObject({ name: 'app.sql', mime: 'application/sql' });
    expect(out?.text).toBe(
      [
        'CREATE TABLE people (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, avatar BLOB);',
        'CREATE TABLE tags (tag TEXT);',
        'CREATE INDEX people_name ON people(name);',
        'CREATE VIEW named AS SELECT name FROM people;',
        'CREATE TRIGGER t AFTER INSERT ON people BEGIN SELECT 1; END;',
      ].join('\n\n') + '\n',
    );
  });
});

describe('archive actions', () => {
  it('lists entries as CSV', async () => {
    const e = new Engine({ loaders: {} });
    const zip = new Uint8Array(
      zipSync({
        'data.json': [strToU8('{"hello":"world"}'), { mtime: new Date(2024, 0, 2, 3, 4, 6) }],
        'dir/': [new Uint8Array(0), { mtime: new Date(2024, 0, 2, 3, 4, 6) }],
        'dir/a, b.txt': [strToU8('hi'), { mtime: new Date(2024, 0, 2, 3, 4, 6) }],
      }),
    );
    await ingest(e, zip, 'application/zip', 'photos.zip');
    const [out] = await run(e, 'archive', 'archive.listing');
    expect(out).toMatchObject({ name: 'photos-listing.csv', mime: 'text/csv' });
    expect(out?.text).toBe(
      'path,size,compressed size,modified,type\r\n' +
        'data.json,17,19,2024-01-02T03:04:06,file\r\n' +
        'dir/,,,2024-01-02T03:04:06,directory\r\n' +
        '"dir/a, b.txt",2,4,2024-01-02T03:04:06,file\r\n',
    );
  });
});

describe('pdf actions', () => {
  it('writes the metadata as JSON', async () => {
    const e = new Engine({ loaders: { pdf: () => import('../../src/modules/pdf/worker') } });
    await ingest(e, pdfBytes(samplePdf()), 'application/pdf', 'sample.pdf');
    await e.resolve('en-1', 'pdf');
    const [out] = await run(e, 'pdf', 'pdf.metadata');
    expect(out).toMatchObject({ name: 'sample-metadata.json', mime: 'application/json' });
    const meta: unknown = JSON.parse(out?.text ?? '');
    expect(meta).toMatchObject({
      file: 'sample.pdf',
      version: '1.7',
      pageCount: 2,
      encrypted: false,
      document: { title: 'Clipbox sample', author: 'Ada Lovelace' },
      info: { Title: 'Clipbox sample', Author: 'Ada Lovelace', Producer: 'Clipbox test' },
      xmp: null,
      pages: [
        { page: 1, width: 595, height: 842, size: 'A4' },
        { page: 2, width: 595, height: 842, size: 'A4' },
      ],
      outline: [
        { title: 'Chapter 1', page: 1, children: [{ title: 'Section 1.1', page: 1 }] },
        { title: 'Chapter 2', page: 2 },
      ],
      attachments: [],
    });
  });
});
