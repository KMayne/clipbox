import initSqlJs from 'sql.js';
import { describe, expect, it } from 'vitest';
import { makeContent } from '../../src/core/content';
import { register } from '../../src/core/interpreter';
import { detectKinds, getInterpreter } from '../../src/core/interpreters';
import { sqliteDetector } from '../../src/modules/sqlite/detect';
import { createSqliteInterpreter, openDatabase } from '../../src/modules/sqlite/sqlite';
import { bytesContent, textContent } from './helpers';

const sqlite = register(createSqliteInterpreter(() => initSqlJs()));
const ctx = { service: async () => null };

async function fixture({ analyze = false } = {}): Promise<Uint8Array<ArrayBuffer>> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT NOT NULL, age INTEGER, avatar BLOB);
    CREATE TABLE "odd ""name""" (k TEXT, v REAL);
    CREATE INDEX people_name ON people(name);
    CREATE VIEW adults AS SELECT * FROM people WHERE age >= 18;
    PRAGMA user_version = 7;
  `);
  const insert = db.prepare('INSERT INTO people (name, age, avatar) VALUES (?, ?, ?)');
  for (let i = 0; i < 250; i++)
    insert.run([`person ${i}`, i % 90, i === 0 ? new Uint8Array([1, 2, 255]) : null]);
  insert.free();
  db.run(`INSERT INTO "odd ""name""" VALUES ('a', 1.5), ('b', 2.5), ('c', null)`);
  if (analyze) db.run('ANALYZE');
  const bytes = db.export();
  db.close();
  return new Uint8Array(bytes);
}

describe('sqlite detection', () => {
  it('matches the file header only', async () => {
    expect(sqliteDetector.detect(bytesContent(await fixture()))).toBe(0.98);
    expect(sqliteDetector.detect(textContent('SQLite format 3 is a file format'))).toBe(0);
    expect(sqliteDetector.detect(bytesContent(new Uint8Array(200)))).toBe(0);
  });
});

describe('sqlite interpreter', () => {
  it('lists tables, columns and objects', async () => {
    const v = await sqlite.parse(bytesContent(await fixture()), ctx);
    expect(sqlite.label(v)).toMatch(/^SQLite · 2 tables · \d+(\.\d)? KB$/);
    const s = await sqlite.summarise(v);
    // Not counted at open: a full scan per table would be slow on big databases
    expect(s.tables?.map(t => [t.name, t.extent, t.exact, t.columns.length])).toEqual([
      ['people', 0, false, 4],
      ['odd "name"', 0, false, 2],
    ]);
    expect(s.tables?.[0]?.columns).toEqual([
      { name: 'id', type: 'INTEGER · pk' },
      { name: 'name', type: 'TEXT · not null' },
      { name: 'age', type: 'INTEGER' },
      { name: 'avatar', type: 'BLOB' },
    ]);
    const stat = (label: string) => s.stats.find(r => r.label === label);
    expect(stat('Tables')?.children?.map(c => c.value)).toEqual([
      'rows not counted · 4 columns',
      'rows not counted · 2 columns',
    ]);
    expect(stat('Views')?.value).toBe('1');
    expect(stat('Indexes')?.children).toEqual([{ label: 'people_name', value: 'on people' }]);
    expect(stat('User version')?.value).toBe('7');
    expect(stat('Page size')?.value).toBe('4.0 KB');
    const schema = await sqlite.slice(v, { type: 'text' });
    expect(schema).toContain('CREATE TABLE people');
    expect(schema).toContain('CREATE VIEW adults');
  });

  it('counts a table only on request, then reports it as exact', async () => {
    const v = await sqlite.parse(bytesContent(await fixture()), ctx);
    expect(await sqlite.slice(v, { type: 'count', table: 0 })).toBe(250);
    expect(await sqlite.slice(v, { type: 'count', table: 1 })).toBe(3);
    const s = await sqlite.summarise(v);
    expect(s.tables?.map(t => [t.extent, t.exact])).toEqual([
      [250, true],
      [3, true],
    ]);
  });

  it('uses sqlite_stat1 estimates when the database was analyzed', async () => {
    const v = await sqlite.parse(bytesContent(await fixture({ analyze: true })), ctx);
    const s = await sqlite.summarise(v);
    expect(s.tables?.[0]).toMatchObject({ extent: 250, exact: false });
    const tables = s.stats.find(r => r.label === 'Tables');
    expect(tables?.children?.[0]?.value).toBe('~250 rows (estimate) · 4 columns');
  });

  it('reads windows of rows with LIMIT/OFFSET', async () => {
    const v = await sqlite.parse(bytesContent(await fixture()), ctx);
    expect(await sqlite.slice(v, { type: 'rows', from: 0, to: 2 })).toEqual([
      { id: 1, name: 'person 0', age: 0, avatar: "x'0102ff'" },
      { id: 2, name: 'person 1', age: 1, avatar: null },
    ]);
    const tail = await sqlite.slice(v, { type: 'rows', from: 248, to: 500 });
    expect(Array.isArray(tail) && tail.length).toBe(2);
    expect(await sqlite.slice(v, { type: 'rows', from: 1, to: 3, table: 1 })).toEqual([
      { k: 'b', v: 2.5 },
      { k: 'c', v: null },
    ]);
  });

  it('opens the database read-only and leaves the bytes alone', async () => {
    const bytes = await fixture();
    const before = bytes.slice();
    const v = openDatabase(await initSqlJs(), bytes);
    expect(() => v.db.run('DELETE FROM people')).toThrow(/readonly|query_only/i);
    expect(v.db.exec('SELECT count(*) FROM people')[0]?.values[0]?.[0]).toBe(250);
    expect(bytes).toEqual(before);
  });

  it('derives tables as CSV that records picks up', async () => {
    const v = await sqlite.parse(bytesContent(await fixture()), ctx);
    expect(sqlite.derivations(v).map(d => d.label)).toEqual([
      'Table people as CSV',
      'Table odd "name" as CSV',
    ]);
    const out = await sqlite.derive(v, 'table:0');
    expect(out).toMatchObject({ mime: 'text/csv', name: 'people.csv' });
    const csv = makeContent(out.mime, out.bytes, out.name);
    expect(detectKinds(csv)[0]?.kind).toBe('records');
    const records = getInterpreter('records');
    const rv = await records.parse(csv, ctx);
    expect(records.label(rv)).toBe('Records 250×4');
    expect(await records.slice(rv, { type: 'rows', from: 1, to: 2 })).toEqual([
      { id: 2, name: 'person 1', age: 1, avatar: null },
    ]);
  });
});
