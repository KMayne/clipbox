import { describe, expect, it } from 'vitest';
import { parseJsonPath, queryJsonPath } from '../../src/core/jsonPath';
import { decodeEntities, encodeEntities } from '../../src/core/htmlEntities';
import { decodeText, encodeText } from '../../src/core/actions/run/text';
import { flatten } from '../../src/core/actions/run/json';
import { formatXml, minifyXml } from '../../src/core/xmlFormat';
import type { EntryId } from '../../src/core/types';
import { Engine } from '../../src/engine/engine';

const td = new TextDecoder();

async function engineWith(text: string, mime = 'text/plain', name?: string) {
  const engine = new Engine({ loaders: {} });
  const blob = new Blob([text], { type: mime });
  const id: EntryId = 'en-1';
  await engine.ingest({ id, mime, size: blob.size, blob, ...(name !== undefined && { name }) });
  return engine;
}

/** Runs one action on `text`'s `kind` interpretation and returns the single result. */
async function run(
  text: string,
  kind: string,
  actionId: string,
  params: unknown = {},
  opts: { mime?: string; name?: string } = {},
) {
  const engine = await engineWith(text, opts.mime, opts.name);
  const [out, ...rest] = await engine.runAction('en-1', kind, actionId, params);
  if (!out || rest.length) throw new Error('expected exactly one result');
  return { ...out, text: td.decode(out.bytes) };
}

const runText = async (text: string, actionId: string, params?: unknown) =>
  (await run(text, 'text', actionId, params)).text;

describe('text line actions', () => {
  it('trims per line or the whole text, on either side', async () => {
    const src = '  a  \n\tb\t\n';
    expect(await runText(src, 'text.trim')).toBe('a\nb\n');
    expect(await runText(src, 'text.trim', { side: 'start' })).toBe('a  \nb\t\n');
    expect(await runText(src, 'text.trim', { side: 'end' })).toBe('  a\n\tb\n');
    expect(await runText(src, 'text.trim', { scope: 'whole' })).toBe('a  \n\tb');
  });

  it('removes blank lines, optionally only truly empty ones', async () => {
    const src = 'a\n\n  \nb\n';
    expect(await runText(src, 'text.removeBlank')).toBe('a\nb\n');
    expect(await runText(src, 'text.removeBlank', { whitespace: false })).toBe('a\n  \nb\n');
  });

  it('dedupes lines keeping the first, optionally ignoring case', async () => {
    const src = 'b\na\nB\nb\na\n';
    expect(await runText(src, 'text.dedupeLines')).toBe('b\na\nB\n');
    expect(await runText(src, 'text.dedupeLines', { ignoreCase: true })).toBe('b\na\n');
  });

  it('reverses lines', async () => {
    expect(await runText('1\n2\n3\n', 'text.reverseLines')).toBe('3\n2\n1\n');
  });

  it('splits lines into a JSON array', async () => {
    const src = ' a \n\n b\n';
    const out = await run(src, 'text', 'text.splitLines');
    expect(out.mime).toBe('application/json');
    expect(JSON.parse(out.text)).toEqual(['a', 'b']);
    const raw = await runText(src, 'text.splitLines', { trim: false, skipEmpty: false });
    expect(JSON.parse(raw)).toEqual([' a ', '', ' b']);
  });
});

describe('text encode/decode', () => {
  it('base64, standard and URL-safe; decoding tolerates whitespace', () => {
    expect(encodeText('hi?>', 'base64')).toBe('aGk/Pg==');
    expect(encodeText('hi?>', 'base64url')).toBe('aGk_Pg');
    expect(td.decode(decodeText('aGk/\n Pg==', 'base64').bytes)).toBe('hi?>');
    expect(td.decode(decodeText('aGk_Pg', 'base64url').bytes)).toBe('hi?>');
    expect(() => decodeText('a$b', 'base64')).toThrow('Not valid base64');
    // Binary output isn't labelled as text
    expect(decodeText('AAEC/w==', 'base64').mime).toBe('application/octet-stream');
  });

  it('URL percent-encoding, as a component or a full URI', () => {
    const s = 'a b/c?d=é&e';
    expect(encodeText(s, 'component')).toBe('a%20b%2Fc%3Fd%3D%C3%A9%26e');
    expect(encodeText(s, 'uri')).toBe('a%20b/c?d=%C3%A9&e');
    expect(td.decode(decodeText('a%20b%2Fc+d', 'component').bytes)).toBe('a b/c d');
    expect(td.decode(decodeText('a%20b%2Fc', 'uri').bytes)).toBe('a b%2Fc');
    expect(() => decodeText('%E0%A4%A', 'component')).toThrow('Malformed');
  });

  it('HTML entities, named and numeric', () => {
    expect(encodeEntities(`<a href="x">Tom & Jerry's</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;',
    );
    expect(encodeEntities('café 😀', true)).toBe('caf&#233; &#128512;');
    expect(decodeEntities('&lt;&eacute;&Omega;&hellip;&#x1F600;&#65;&nope;&amp;amp;')).toBe(
      '<éΩ…😀A&nope;&amp;',
    );
  });

  it('JSON string escape and unescape, with or without quotes', () => {
    expect(encodeText('a "b"\n\té', 'json')).toBe('a \\"b\\"\\n\\té');
    expect(encodeText('é', 'json', { nonAscii: true, quotes: true })).toBe('"\\u00e9"');
    expect(td.decode(decodeText('a \\"b\\"\\n\\u00e9', 'json').bytes)).toBe('a "b"\né');
    expect(td.decode(decodeText('"x\\ty"', 'json').bytes)).toBe('x\ty');
    expect(() => decodeText('bad "quote', 'json')).toThrow('Not a valid JSON string');
  });

  it('runs through the engine', async () => {
    expect(await runText('a&b', 'text.encode', { format: 'html' })).toBe('a&amp;b');
    expect(await runText('aGk=', 'text.decode', { format: 'base64' })).toBe('hi');
  });
});

describe('JSON actions (batch 2)', () => {
  it('converts arrays to NDJSON, and is only offered for arrays', async () => {
    const out = await run('[{"a":1},[2],"x"]', 'json', 'json.toNdjson', {}, { name: 'rows.json' });
    expect(out).toMatchObject({ mime: 'application/x-ndjson', name: 'rows.ndjson' });
    expect(out.text).toBe('{"a":1}\n[2]\n"x"\n');
    const engine = await engineWith('{"a":1}');
    await expect(engine.runAction('en-1', 'json', 'json.toNdjson', {})).rejects.toThrow(
      "doesn't apply",
    );
  });

  it('flattens to dot paths or brackets, keeping empty containers', () => {
    const v = { a: { b: [1, { c: null }], d: {} }, e: [] };
    expect(flatten(v, '.', false)).toEqual({ 'a.b.0': 1, 'a.b.1.c': null, 'a.d': {}, e: [] });
    expect(flatten(v, '/', true)).toEqual({ 'a/b[0]': 1, 'a/b[1]/c': null, 'a/d': {}, e: [] });
    expect(flatten([{ x: 1 }], '.', true)).toEqual({ '[0].x': 1 });
  });

  it('runs Flatten through the engine', async () => {
    const out = await run('{"a":{"b":1}}', 'json', 'json.flatten', { separator: '_' });
    expect(JSON.parse(out.text)).toEqual({ a_b: 1 });
  });

  it('picks values by path', async () => {
    const doc = '{"items":[{"id":1,"name":"a"},{"id":2,"name":"b"}],"id":0}';
    const pick = async (path: string, wrap = false) =>
      JSON.parse((await run(doc, 'json', 'json.pick', { path, wrap })).text);
    expect(await pick('$.items[*].name')).toEqual(['a', 'b']);
    expect(await pick('$..id')).toEqual([0, 1, 2]);
    expect(await pick('$.items[1].name')).toBe('b');
    expect(await pick('items[-1].id', true)).toEqual([2]);
    const engine = await engineWith(doc);
    const runPick = (path: string) => engine.runAction('en-1', 'json', 'json.pick', { path });
    await expect(runPick('$.nope')).rejects.toThrow('Nothing matches $.nope');
    await expect(runPick('$.items[?(@.id ==)]')).rejects.toThrow('Invalid path: ');
    expect(await pick('$.items[?(@.id > 1)].name')).toEqual(['b']);
  });
});

describe('JSONPath subset', () => {
  const doc = {
    store: {
      book: [
        { title: 'A', price: 8, isbn: 'x' },
        { title: 'B', price: 12 },
        { title: 'C', price: 9, isbn: 'y' },
        { title: 'D', price: 22 },
      ],
      bicycle: { price: 19, 'odd key': true },
    },
  };
  const q = (p: string) => queryJsonPath(doc, parseJsonPath(p));

  it('selects children, wildcards and recursive descendants', () => {
    expect(q('$')).toEqual([doc]);
    expect(q('$.store.bicycle.price')).toEqual([19]);
    expect(q("$['store']['bicycle']['odd key']")).toEqual([true]);
    expect(q('$.store.book[*].title')).toEqual(['A', 'B', 'C', 'D']);
    expect(q('$..price')).toEqual([8, 12, 9, 22, 19]);
    expect(q('$..isbn')).toEqual(['x', 'y']);
    expect(q('$.store.*').length).toBe(2);
    expect(q('$..book[0].title')).toEqual(['A']);
  });

  it('handles indices, negatives, slices and unions', () => {
    const titles = (p: string) =>
      q(p).map(b => (b && typeof b === 'object' ? 'title' in b && b.title : b));
    expect(titles('$.store.book[-1]')).toEqual(['D']);
    expect(titles('$.store.book[1:3]')).toEqual(['B', 'C']);
    expect(titles('$.store.book[:2]')).toEqual(['A', 'B']);
    expect(titles('$.store.book[-2:]')).toEqual(['C', 'D']);
    expect(titles('$.store.book[::2]')).toEqual(['A', 'C']);
    expect(titles('$.store.book[::-1]')).toEqual(['D', 'C', 'B', 'A']);
    expect(titles('$.store.book[0,2]')).toEqual(['A', 'C']);
    expect(q("$.store.book[0]['title','price']")).toEqual(['A', 8]);
    expect(q('$.store.book[9]')).toEqual([]);
  });

  it('marks definite paths and rejects what it does not support', () => {
    expect(parseJsonPath('$.a[0].b').definite).toBe(true);
    expect(parseJsonPath('$.a[*]').definite).toBe(false);
    expect(parseJsonPath('$..a').definite).toBe(false);
    expect(() => parseJsonPath('$.a[')).toThrow('Unclosed');
    expect(() => parseJsonPath('$.a[::0]')).toThrow('step');
    expect(() => parseJsonPath('$.a.')).toThrow('Expected a name');
    expect(() => parseJsonPath('$.a[(@.length-1)]')).toThrow('not supported');
  });
});

const CSV = 'name,qty,price,code\r\nPear,10,1.50,007\r\nApple,2,0.5,\r\n"Fig, dried",,12,x\r\n';

describe('records actions', () => {
  it('converts CSV to TSV and back, keeping the original cell text', async () => {
    const tsv = await run(CSV, 'records', 'records.toTsv', {}, { name: 'fruit.csv' });
    expect(tsv).toMatchObject({ mime: 'text/tab-separated-values', name: 'fruit.tsv' });
    expect(tsv.text).toBe(
      'name\tqty\tprice\tcode\nPear\t10\t1.50\t007\nApple\t2\t0.5\t\nFig, dried\t\t12\tx\n',
    );
    const csv = await run(tsv.text, 'records', 'records.toCsv');
    expect(csv.text).toBe(CSV);
    // Not offered for CSV itself
    const engine = await engineWith(CSV);
    await expect(engine.runAction('en-1', 'records', 'records.toCsv', {})).rejects.toThrow(
      "doesn't apply",
    );
  });

  it('converts JSON records to CSV with RFC 4180 quoting', async () => {
    const json = JSON.stringify([
      { a: 'x,y', b: 'say "hi"' },
      { a: 'line\nbreak', b: { n: 1 } },
      { a: 'p', b: 'q' },
    ]);
    const out = await run(json, 'records', 'records.toCsv');
    expect(out.text).toBe('a,b\r\n"x,y","say ""hi"""\r\n"line\nbreak","{""n"":1}"\r\np,q\r\n');
  });

  it('makes a Markdown table, escaping pipes, aligning numbers right', async () => {
    const src = 'a,b\r\nx|y,1\r\nz,22\r\nw,3\r\n';
    const out = await run(src, 'records', 'records.toMarkdown');
    expect(out).toMatchObject({ mime: 'text/markdown', name: 'table.md' });
    expect(out.text).toBe('| a | b |\n| --- | ---: |\n| x\\|y | 1 |\n| z | 22 |\n| w | 3 |\n');
    const centred = await run(src, 'records', 'records.toMarkdown', { align: 'center' });
    expect(centred.text.split('\n')[1]).toBe('| :---: | :---: |');
  });

  it('writes SQL INSERTs in batches, per dialect', async () => {
    const src = "id,name,note\r\n1,O'Brien,\r\n007,x\\y,ok\r\n3,z,\r\n";
    const out = await run(src, 'records', 'records.toSql', { table: 'people', batch: 2 });
    expect(out).toMatchObject({ mime: 'text/x-sql', name: 'data.sql' });
    expect(out.text).toBe(
      [
        'INSERT INTO "people" ("id", "name", "note") VALUES',
        "  (1, 'O''Brien', NULL),",
        "  ('007', 'x\\y', 'ok');",
        'INSERT INTO "people" ("id", "name", "note") VALUES',
        "  (3, 'z', NULL);",
        '',
      ].join('\n'),
    );
    const mysql = await run(src, 'records', 'records.toSql', {
      table: 'app.people',
      dialect: 'mysql',
      batch: 1,
      emptyAsNull: false,
    });
    expect(mysql.text.split('\n')[0]).toBe(
      "INSERT INTO `app`.`people` (`id`, `name`, `note`) VALUES (1, 'O''Brien', '');",
    );
    expect(mysql.text).toContain("'x\\\\y'");
  });

  it('keeps JSON types in SQL', async () => {
    const json = '[{"a":"1","b":2,"c":true,"d":null},{"a":"x","b":1.5,"c":false,"d":[1]}]';
    const out = await run(json, 'records', 'records.toSql', { batch: 1 });
    expect(out.text).toBe(
      'INSERT INTO "data" ("a", "b", "c", "d") VALUES (\'1\', 2, TRUE, NULL);\n' +
        'INSERT INTO "data" ("a", "b", "c", "d") VALUES (\'x\', 1.5, FALSE, \'[1]\');\n',
    );
  });

  it('generates TypeScript types for a row', async () => {
    const out = await run(CSV, 'records', 'records.types', { rowName: 'Fruit' });
    expect(out).toMatchObject({ name: 'Fruit.ts', mime: 'text/typescript' });
    expect(out.text).toContain('export interface Fruit {');
    expect(out.text).toContain('name: string;');
    expect(out.text).toContain('qty: number | null;');
  });

  it('picks, reorders and renames columns by name or number', async () => {
    const out = await run(CSV, 'records', 'records.pickColumns', { columns: 'price, 1:fruit' });
    expect(out.text).toBe('price,fruit\r\n1.50,Pear\r\n0.5,Apple\r\n12,"Fig, dried"\r\n');
    const engine = await engineWith(CSV);
    const pick = (columns: string) =>
      engine.runAction('en-1', 'records', 'records.pickColumns', { columns });
    await expect(pick('nope')).rejects.toThrow(
      'No column "nope" (columns: name, qty, price, code)',
    );
    await expect(pick('9')).rejects.toThrow('No column 9: there are 4 columns');
    await expect(pick('name, 1')).rejects.toThrow('appears twice');
    await expect(pick('')).rejects.toThrow('List the columns');
  });

  it('sorts stably by a column, naturally, numerically or as text, empties last', async () => {
    const src = 'k,v\r\nb,10\r\na,9\r\nc,\r\nd,10\r\ne,x2\r\nf,x10\r\n';
    const keys = async (params: object) =>
      (await run(src, 'records', 'records.sort', params)).text
        .trim()
        .split('\r\n')
        .slice(1)
        .map(l => l.split(',')[0])
        .join('');
    expect(await keys({ column: 'v', compare: 'numeric' })).toBe('abdcef');
    expect(await keys({ column: 'v', compare: 'natural' })).toBe('abdefc');
    expect(await keys({ column: '2', compare: 'text', order: 'desc' })).toBe('efabdc');
  });

  it('filters rows with each operator', async () => {
    const names = async (column: string, op: string, value = '', ignoreCase = true) =>
      (await run(CSV, 'records', 'records.filter', { column, op, value, ignoreCase })).text
        .split('\r\n')
        .slice(1, -1)
        .map(l => l.split(',')[0]);
    expect(await names('name', 'eq', 'pear')).toEqual(['Pear']);
    expect(await names('qty', 'eq', '10.0')).toEqual(['Pear']);
    expect(await names('name', 'ne', 'pear')).toEqual(['Apple', '"Fig']);
    expect(await names('name', 'contains', 'P')).toEqual(['Pear', 'Apple']);
    expect(await names('name', 'starts', 'f')).toEqual(['"Fig']);
    expect(await names('name', 'regex', '^[ap]')).toEqual(['Pear', 'Apple']);
    expect(await names('price', 'gt', '1')).toEqual(['Pear', '"Fig']);
    expect(await names('price', 'lt', '1')).toEqual(['Apple']);
    expect(await names('qty', 'empty')).toEqual(['"Fig']);
    expect(await names('code', 'notEmpty')).toEqual(['Pear', '"Fig']);
    const engine = await engineWith(CSV);
    const filter = (params: object) =>
      engine.runAction('en-1', 'records', 'records.filter', params);
    await expect(
      filter({ column: 'name', op: 'eq', value: 'pear', ignoreCase: false }),
    ).rejects.toThrow('No rows match');
    await expect(filter({ column: 'name', op: 'regex', value: '(' })).rejects.toThrow(
      'Invalid regular expression',
    );
  });

  it('keeps JSON and NDJSON sources in their own format', async () => {
    const json = '[{"n":2},{"n":1},{"n":3}]';
    const out = await run(json, 'records', 'records.sort', { column: 'n' });
    expect(out.mime).toBe('application/json');
    expect(JSON.parse(out.text)).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
    const nd = await run('{"n":2}\n{"n":1}\n', 'records', 'records.sort', { column: 'n' });
    expect(nd).toMatchObject({ mime: 'application/x-ndjson', text: '{"n":1}\n{"n":2}\n' });
  });
});

describe('NDJSON actions', () => {
  // Detection allows up to 10% invalid lines
  const lines = Array.from({ length: 22 }, (_, i) => JSON.stringify({ i: i + 1 }));
  lines[1] = '{bad';
  lines[11] = 'not json';
  const src = lines.join('\n') + '\n';

  it('converts to a JSON array, noting skipped lines', async () => {
    const out = await run(src, 'ndjson', 'ndjson.toJson', {}, { name: 'log.ndjson' });
    expect(out).toMatchObject({ mime: 'application/json', name: 'log.json' });
    expect(out.note).toBe('2 invalid lines skipped');
    expect(JSON.parse(out.text)).toHaveLength(20);
    expect(JSON.parse(out.text)[1]).toEqual({ i: 3 });
  });

  it('converts objects to CSV with the union of keys', async () => {
    const out = await run('{"a":1}\n{"b":"x,y","a":2}\n', 'ndjson', 'ndjson.toCsv');
    expect(out.text).toBe('a,b\r\n1,\r\n2,"x,y"\r\n');
  });

  it('extracts invalid lines with their numbers', async () => {
    const out = await run(src, 'ndjson', 'ndjson.invalidLines');
    expect(out.text).toBe('2: {bad\n12: not json\n');
  });
});

describe('YAML actions', () => {
  it('converts to JSON; several documents become an array', async () => {
    const one = await run(
      'a: 1\nb: [x, y]\n',
      'yaml',
      'yaml.toJson',
      {},
      { mime: 'application/yaml' },
    );
    expect(JSON.parse(one.text)).toEqual({ a: 1, b: ['x', 'y'] });
    expect(one.note).toBeUndefined();
    const many = await run('---\na: 1\n---\nb: 2\n', 'yaml', 'yaml.toJson');
    expect(JSON.parse(many.text)).toEqual([{ a: 1 }, { b: 2 }]);
    expect(many.note).toBe('2 documents as an array');
  });

  it('formats with the chosen indent, keeping comments', async () => {
    const src = '# top\na:\n    b: 1 # inline\n    c:\n        - x\n';
    const out = await run(src, 'yaml', 'yaml.format', { indent: 2 });
    expect(out.text).toBe('# top\na:\n  b: 1 # inline\n  c:\n    - x\n');
    const many = await run('---\na:\n  b: 1\n---\nc: 2\n', 'yaml', 'yaml.format', { indent: 4 });
    expect(many.text).toBe('---\na:\n    b: 1\n---\nc: 2\n');
  });
});

describe('XML actions', () => {
  const src =
    '<?xml version="1.0"?>\n<root a="1"><!-- note --><item  id="x" ><![CDATA[<raw> & ]]></item>' +
    '<p>Hello <b>world</b> !</p><pre xml:space="preserve">  keep\n  me </pre><e/></root>';

  it('pretty-prints, keeping CDATA, comments, mixed content and preserved space', () => {
    expect(formatXml(src, '  ')).toBe(
      [
        '<?xml version="1.0"?>',
        '<root a="1">',
        '  <!-- note -->',
        '  <item  id="x" ><![CDATA[<raw> & ]]></item>',
        '  <p>Hello <b>world</b> !</p>',
        '  <pre xml:space="preserve">  keep\n  me </pre>',
        '  <e/>',
        '</root>',
        '',
      ].join('\n'),
    );
  });

  it('minifies, keeping significant whitespace', () => {
    const pretty = formatXml(src, '\t');
    const expected =
      '<?xml version="1.0"?><root a="1"><!-- note --><item id="x"><![CDATA[<raw> & ]]></item>' +
      '<p>Hello <b>world</b> !</p><pre xml:space="preserve">  keep\n  me </pre><e/></root>';
    expect(minifyXml(pretty, false)).toBe(expected);
    expect(minifyXml(pretty, true)).toBe(expected.replace('<!-- note -->', ''));
    expect(minifyXml('<a>\n  <b  x = "1  2"\n  />\n</a>', false)).toBe('<a><b x="1  2"/></a>');
  });

  it('runs Format and Minify through the engine', async () => {
    const out = await run(
      '<a><b>1</b></a>',
      'xml',
      'xml.format',
      { indent: '4' },
      { name: 'f.xml' },
    );
    expect(out).toMatchObject({ mime: 'application/xml', name: 'f.xml' });
    expect(out.text).toBe('<a>\n    <b>1</b>\n</a>\n');
    expect((await run('<a>\n  <b>1</b>\n</a>', 'xml', 'xml.minify')).text).toBe('<a><b>1</b></a>');
  });

  it('converts to JSON with attribute options', async () => {
    const xml = '<a id="7"><b>2</b><b>x</b></a>';
    const json = async (params: object) =>
      JSON.parse((await run(xml, 'xml', 'xml.toJson', params)).text);
    expect(await json({})).toEqual({ a: { '@_id': 7, b: [2, 'x'] } });
    expect(await json({ prefix: '$', parseValues: false })).toEqual({
      a: { $id: '7', b: ['2', 'x'] },
    });
    expect(await json({ attributes: 'ignore' })).toEqual({ a: { b: [2, 'x'] } });
    expect(await json({ attributes: 'group' })).toEqual({
      a: { ':@': { '@_id': 7 }, b: [2, 'x'] },
    });
  });
});
