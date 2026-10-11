import { loadJq } from 'jq-wasm';
import { describe, expect, it } from 'vitest';
import { splitJqValues } from '../../src/core/actions/run/query';
import type { EntryId } from '../../src/core/types';
import { Engine } from '../../src/engine/engine';
import { createJqService, jqFlags } from '../../src/modules/jq/jq';

const td = new TextDecoder();

const jqLoader = async () => ({ service: createJqService(() => loadJq()) });

async function engineWith(text: string, mime = 'text/plain', name?: string) {
  const engine = new Engine({ loaders: { jq: jqLoader } });
  const blob = new Blob([text], { type: mime });
  const id: EntryId = 'en-1';
  await engine.ingest({ id, mime, size: blob.size, blob, ...(name !== undefined && { name }) });
  return engine;
}

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
  return { name: out.name, mime: out.mime, text: td.decode(out.bytes) };
}

const PEOPLE = JSON.stringify([
  { name: 'Ada', age: 36, team: 'core', user: { country: 'UK' }, price: 1.1 },
  { name: 'Linus', age: 54, team: 'kernel', user: { country: 'FI' }, price: 2.2 },
  { name: 'Grace', age: 85, team: 'core', user: { country: 'US' } },
  { name: 'Alan', age: 41, team: 'core', user: { country: 'UK' }, price: 3 },
  { name: 'Tim', age: 30, user: {} },
]);

const json = (text: string): unknown => JSON.parse(text);

describe('Group by', () => {
  const group = (params: object, text = PEOPLE) => run(text, 'json', 'query.groupBy', params);

  it('makes an object of arrays, sorted by key, with missing values as (none)', async () => {
    const out = await group({ field: 'user.country', output: 'object' });
    expect(out.mime).toBe('application/json');
    expect(out.name).toBe('by-user.country.json');
    const parsed = json(out.text);
    expect(Object.keys(JSON.parse(out.text))).toEqual(['FI', 'UK', 'US', '(none)']);
    expect(parsed).toMatchObject({ UK: [{ name: 'Ada' }, { name: 'Alan' }] });
  });

  it('keeps the chosen order for number-like keys in an object', async () => {
    const data = JSON.stringify([{ n: 10 }, { n: 2 }, { n: 2 }, { n: 'x' }]);
    const out = await group({ field: 'n', output: 'object', sort: 'countDesc' }, data);
    expect(out.text.indexOf('"2"')).toBeLessThan(out.text.indexOf('"10"'));
    const asc = await group({ field: 'n', output: 'object', sort: 'keyDesc' }, data);
    expect([...asc.text.matchAll(/^ {2}"([^"]+)"/gm)].map(m => m[1])).toEqual(['x', '10', '2']);
  });

  it('makes an array of groups, skipping missing values, sorted by count', async () => {
    const out = await group({
      field: 'team',
      output: 'groups',
      sort: 'countDesc',
      missing: 'skip',
    });
    const parsed = json(out.text);
    expect(parsed).toMatchObject([
      { key: 'core', count: 3 },
      { key: 'kernel', count: 1 },
    ]);
  });

  it('makes a summary table with aggregates', async () => {
    const out = await group({
      field: 'team',
      aggregates:
        'sum:price, avg:age, min:age, max:name, distinct:user.country, first:name, last:name, count:price',
    });
    expect(json(out.text)).toEqual([
      {
        team: 'core',
        count: 3,
        sum_price: 4.1,
        avg_age: 54,
        min_age: 36,
        max_name: 'Grace',
        'distinct_user.country': 2,
        first_name: 'Ada',
        last_name: 'Alan',
        count_price: 2,
      },
      {
        team: 'kernel',
        count: 1,
        sum_price: 2.2,
        avg_age: 54,
        min_age: 54,
        max_name: 'Linus',
        'distinct_user.country': 1,
        first_name: 'Linus',
        last_name: 'Linus',
        count_price: 1,
      },
      {
        team: '(none)',
        count: 1,
        sum_price: null,
        avg_age: 30,
        min_age: 30,
        max_name: 'Tim',
        'distinct_user.country': 0,
        first_name: 'Tim',
        last_name: 'Tim',
        count_price: 0,
      },
    ]);
  });

  it('stringifies numbers, booleans and null as keys', async () => {
    const data = JSON.stringify([{ k: 1 }, { k: '1' }, { k: true }, { k: null }, { k: false }]);
    const out = await group({ field: 'k', output: 'groups', sort: 'first' }, data);
    expect(json(out.text)).toMatchObject([
      { key: 1, count: 2 },
      { key: true, count: 1 },
      { key: null, count: 1 },
      { key: false, count: 1 },
    ]);
    const obj = await group({ field: 'k', output: 'object', sort: 'keyAsc' }, data);
    expect(Object.keys(JSON.parse(obj.text)).sort()).toEqual(['1', 'false', 'null', 'true']);
  });

  it('groups CSV records by column name or number into CSV', async () => {
    const csv = 'name,team,score\r\nA,red,1\r\nB,blue,2\r\nC,red,3\r\nD,,4\r\n';
    const out = await run(
      csv,
      'records',
      'query.groupBy',
      { field: '2', aggregates: 'sum:score', sort: 'countDesc' },
      { mime: 'text/csv', name: 'scores.csv' },
    );
    expect(out.mime).toBe('text/csv');
    expect(out.name).toBe('scores-by-team.csv');
    expect(out.text).toBe('team,count,sum_score\r\nred,2,4\r\nblue,1,2\r\n(none),1,4\r\n');
  });

  it('gives clear errors for unknown fields and bad aggregates', async () => {
    await expect(group({ field: 'nope' })).rejects.toThrow(
      'No field "nope" (fields: name, age, team, user, user.country, price)',
    );
    await expect(group({ field: '' })).rejects.toThrow('Enter a field (fields: name');
    await expect(group({ field: 'team', aggregates: 'sum price' })).rejects.toThrow(
      'write function:field',
    );
    await expect(group({ field: 'team', aggregates: 'median:age' })).rejects.toThrow(
      'Unknown aggregate "median"',
    );
    await expect(group({ field: 'team', aggregates: 'sum:cost' })).rejects.toThrow(
      'No field "cost"',
    );
    const csv = 'name,team\r\nA,red\r\nB,blue\r\n';
    await expect(
      run(csv, 'records', 'query.groupBy', { field: 'c' }, { mime: 'text/csv' }),
    ).rejects.toThrow('No column "c" (columns: name, team)');
  });

  it("isn't offered for JSON that isn't an array of objects", async () => {
    await expect(group({ field: 'a' }, '{"a":1}')).rejects.toThrow("doesn't apply");
  });
});

describe('Count by and Distinct values', () => {
  it('counts by a field, largest first', async () => {
    const out = await run(PEOPLE, 'json', 'query.countBy', { field: 'user.country' });
    expect(json(out.text)).toEqual([
      { 'user.country': 'UK', count: 2 },
      { 'user.country': 'FI', count: 1 },
      { 'user.country': 'US', count: 1 },
      { 'user.country': '(none)', count: 1 },
    ]);
    expect(out.name).toBe('count-by-user.country.json');
  });

  it('lists distinct values in several orders', async () => {
    const values = async (sort: string) =>
      json((await run(PEOPLE, 'json', 'query.distinct', { field: 'team', sort })).text);
    expect(await values('first')).toEqual(['core', 'kernel']);
    expect(await values('count')).toEqual(['core', 'kernel']);
    const ages = json(
      (await run(PEOPLE, 'json', 'query.distinct', { field: 'age', sort: 'asc' })).text,
    );
    expect(ages).toEqual([30, 36, 41, 54, 85]);
  });
});

describe('Pick by path on records', () => {
  it('queries the rows with a filter', async () => {
    const csv = 'name,qty\r\nPear,10\r\nFig,2\r\n';
    const out = await run(
      csv,
      'records',
      'json.pick',
      { path: '$[?@.qty > 5].name' },
      {
        mime: 'text/csv',
      },
    );
    expect(json(out.text)).toEqual(['Pear']);
  });
});

describe('jq', () => {
  const jq = (text: string, params: object, kind = 'json', mime?: string) =>
    run(text, kind, 'query.jq', params, mime === undefined ? {} : { mime });

  it('runs select and map filters through the engine', async () => {
    const names = await jq(PEOPLE, { filter: '.[] | select(.age > 40) | .name' });
    expect(json(names.text)).toEqual(['Linus', 'Grace', 'Alan']);
    expect(names.mime).toBe('application/json');
    const teams = await jq(PEOPLE, {
      filter: '[.[] | select(.team)] | group_by(.team) | map({team: .[0].team, n: length})',
      compact: true,
    });
    expect(teams.text).toBe('[{"team":"core","n":3},{"team":"kernel","n":1}]\n');
  });

  it('returns one value as it is and pretty-prints several as an array', async () => {
    const one = await jq('{"a":{"b":[1,2]}}', { filter: '.a' });
    expect(one.text).toBe('{\n  "b": [\n    1,\n    2\n  ]\n}\n');
    const many = await jq('[{"a":1},{"a":[2]}]', { filter: '.[]' });
    expect(many.text).toBe('[\n  {\n    "a": 1\n  },\n  {\n    "a": [\n      2\n    ]\n  }\n]\n');
  });

  it('gives raw text lines with -r, and supports --arg and --argjson', async () => {
    const out = await jq(PEOPLE, {
      filter: '.[] | select(.age >= ($min | tonumber) and .team == $team) | .name',
      raw: true,
      args: 'min=40\nteam=core\n',
    });
    expect(out.text).toBe('Grace\nAlan\n');
    expect(out.mime).toBe('text/plain');
    const num = await jq(PEOPLE, {
      filter: '[.[] | select(.age > $min)] | length',
      args: 'min:=50',
    });
    expect(num.text).toBe('2\n');
  });

  it('slurps NDJSON and reads YAML, and records as rows', async () => {
    const nd = '{"n":1}\n{"n":2}\n{"n":3}\n';
    expect(
      (await jq(nd, { filter: '.n', compact: true }, 'ndjson', 'application/x-ndjson')).text,
    ).toBe('[1,2,3]\n');
    expect(
      (await jq(nd, { filter: 'map(.n) | add', slurp: true }, 'ndjson', 'application/x-ndjson'))
        .text,
    ).toBe('6\n');
    const yaml = 'a: 1\nb: [x, y]\n';
    expect((await jq(yaml, { filter: '.b[1]' }, 'yaml', 'application/yaml')).text).toBe('"y"\n');
    const csv = 'name,qty\r\nPear,10\r\nFig,2\r\n';
    expect((await jq(csv, { filter: 'map(.qty) | add' }, 'records', 'text/csv')).text).toBe('12\n');
  });

  it("reports jq's compile and runtime errors", async () => {
    await expect(jq(PEOPLE, { filter: '.[] | foo(' })).rejects.toThrow(
      'jq: error: syntax error, unexpected end of file at <top-level>, line 1, column 10: .[] | foo(',
    );
    await expect(jq(PEOPLE, { filter: 'error("boom")' })).rejects.toThrow('jq: error: boom');
    await expect(jq(PEOPLE, { filter: 'empty' })).rejects.toThrow('The filter gave no output');
    await expect(jq(PEOPLE, { filter: '.', args: '1bad=x' })).rejects.toThrow(
      'Variables line 1: write name=value',
    );
  });

  it('splits pretty and compact output into values', () => {
    expect(splitJqValues('{\n  "a": [\n    1\n  ]\n}\n"x"\n[]\n', false)).toEqual([
      '{\n  "a": [\n    1\n  ]\n}',
      '"x"',
      '[]',
    ]);
    expect(splitJqValues('1\n{"a":1}', true)).toEqual(['1', '{"a":1}']);
    expect(
      jqFlags({
        raw: true,
        compact: false,
        slurp: true,
        args: [{ name: 'a', value: '1', json: true }],
      }),
    ).toEqual(['-r', '-s', '--argjson', 'a', '1']);
  });
});
