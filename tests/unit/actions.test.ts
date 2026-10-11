import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { actionById, catalog } from '../../src/core/actions/catalog';
import { actionLabel, defaultParams, formFields } from '../../src/core/actions/form';
import { actionImpl, actionImpls } from '../../src/core/actions/run';
import { changeCase } from '../../src/core/actions/run/text';
import { defineAction, hasSettings } from '../../src/core/actions/types';
import { Engine } from '../../src/engine/engine';
import type { EntryId } from '../../src/core/types';
import { pngHeader } from './helpers';

const entry = (
  content: string | Uint8Array<ArrayBuffer>,
  mime = 'text/plain',
  id: EntryId = 'en-1',
) => {
  const blob = new Blob([content], { type: mime });
  return { id, mime, size: blob.size, blob };
};

/** Ingests `text` and runs one action on its `kind` interpretation; returns the output text. */
async function run(text: string, kind: string, actionId: string, params?: unknown) {
  const engine = new Engine({ loaders: {} });
  await engine.ingest(entry(text));
  const [out, ...rest] = await engine.runAction('en-1', kind, actionId, params);
  if (!out || rest.length) throw new Error('expected exactly one result');
  return { ...out, text: new TextDecoder().decode(out.bytes) };
}

describe('action catalog', () => {
  it('has unique ids, each with exactly one implementation', () => {
    const ids = catalog.map(a => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(actionImpls.map(a => a.info.id).sort()).toEqual([...ids].sort());
    for (const a of catalog) expect(actionImpl(a.id)?.info).toBe(a);
  });

  it('generates a form for every action, and every default is valid', () => {
    for (const a of catalog) {
      expect(() => formFields(a.params), a.id).not.toThrow();
      expect(a.params.safeParse({}).success, a.id).toBe(true);
    }
  });

  it('converts each supported field type, with hints and bounds', () => {
    const params = z.object({
      pattern: z.string().default('a+').meta({ title: 'Find', hint: 'regex' }),
      body: z.string().default('').meta({ hint: 'multiline', description: 'Text' }),
      quality: z.number().int().min(1).max(100).default(90),
      ratio: z.number().default(0.5),
      unique: z.boolean().default(false).meta({ title: 'Unique' }),
      order: z
        .enum(['asc', 'desc'])
        .default('asc')
        .meta({ optionLabels: { asc: 'A → Z' } }),
    });
    expect(formFields(params)).toEqual([
      { type: 'string', key: 'pattern', title: 'Find', default: 'a+', hint: 'regex' },
      {
        type: 'string',
        key: 'body',
        title: 'Body',
        description: 'Text',
        default: '',
        hint: 'multiline',
      },
      {
        type: 'number',
        key: 'quality',
        title: 'Quality',
        default: 90,
        integer: true,
        min: 1,
        max: 100,
      },
      { type: 'number', key: 'ratio', title: 'Ratio', default: 0.5, integer: false },
      { type: 'boolean', key: 'unique', title: 'Unique', default: false },
      {
        type: 'enum',
        key: 'order',
        title: 'Order',
        default: 'asc',
        options: [
          { value: 'asc', label: 'A → Z' },
          { value: 'desc', label: 'desc' },
        ],
      },
    ]);
  });

  it('rejects settings the forms cannot show', () => {
    const params = z.object({ tags: z.array(z.string()).default([]) });
    // @ts-expect-error -- the catalog's types already reject this; check the runtime guard too
    expect(() => formFields(params)).toThrow("Unsupported setting 'tags'");
  });

  it('labels results with the action and a short summary of its settings', () => {
    const info = (id: string) => {
      const a = actionById(id);
      if (!a) throw new Error(id);
      return a;
    };
    expect(actionLabel(info('json.format'), { indent: '4' })).toBe('Format (4 spaces)');
    expect(actionLabel(info('json.minify'), {})).toBe('Minify');
    expect(actionLabel(info('text.replace'), { find: 'foo', replace: 'bar', regex: true })).toBe(
      'Find & replace /foo/ → bar',
    );
    expect(actionLabel(info('text.sortLines'), { order: 'desc', unique: true })).toBe(
      'Sort lines Z → A, unique',
    );
    // Invalid settings fall back to the title
    expect(actionLabel(info('json.format'), { indent: 3 })).toBe('Format');

    const generic = defineAction({
      id: 'test.generic',
      title: 'Wrap',
      group: 'Lines',
      kinds: ['text'],
      params: z.object({
        width: z.number().default(80),
        hard: z.boolean().default(true).meta({ title: 'Hard' }),
        marker: z.string().default('a very long marker string'),
      }),
    });
    expect(actionLabel(generic, {})).toBe('Wrap (width 80, hard, "a very long mar…")');
    expect(hasSettings(generic)).toBe(true);
    expect(defaultParams(generic)).toEqual({
      width: 80,
      hard: true,
      marker: 'a very long marker string',
    });
  });
});

describe('Engine actions', () => {
  it('lists only the actions that fit the kind', async () => {
    const engine = new Engine({ loaders: {} });
    await engine.ingest(entry('{"b":1,"a":[2]}'));
    expect(await engine.actions('en-1', 'json')).toEqual([
      'json.format',
      'json.minify',
      'json.sortKeys',
      'json.toYaml',
      'json.types',
      'any.hash',
      'any.hexDump',
    ]);
    const text = await engine.actions('en-1', 'text');
    expect(text).toContain('text.replace');
    expect(text.some(id => id.startsWith('image.') || id.startsWith('json.'))).toBe(false);
  });

  it('rejects bad settings in the worker', async () => {
    await expect(run('{"a":1}', 'json', 'json.format', { indent: '3' })).rejects.toThrow(
      /Invalid settings for Format: indent/,
    );
    await expect(run('{"a":1}', 'json', 'json.types', { rootName: 'not valid' })).rejects.toThrow(
      'Must be a valid identifier',
    );
    await expect(run('{"a":1}', 'json', 'json.format', 'nope')).rejects.toThrow(/Invalid settings/);
  });

  it('rejects unknown actions and actions for another kind', async () => {
    await expect(run('{"a":1}', 'json', 'json.nope')).rejects.toThrow("No 'json.nope' action");
    await expect(run('hello', 'text', 'json.format')).rejects.toThrow("No 'json.format' action");
  });

  it('transfers a copy of the result bytes', async () => {
    const out = await run('{"a":1}', 'json', 'json.minify');
    expect(out.bytes.buffer.byteLength).toBe(out.bytes.byteLength);
  });
});

describe('JSON actions', () => {
  const src = '{"b":{"d":1,"c":[true,null]},"a":"x"}';

  it('formats with the chosen indent', async () => {
    expect((await run(src, 'json', 'json.format')).text).toBe(
      '{\n  "b": {\n    "d": 1,\n    "c": [\n      true,\n      null\n    ]\n  },\n  "a": "x"\n}',
    );
    expect((await run('[1]', 'json', 'json.format', { indent: '4' })).text).toBe('[\n    1\n]');
    const tab = await run('{"a":1}', 'json', 'json.format', { indent: 'tab' });
    expect(tab).toMatchObject({ mime: 'application/json', text: '{\n\t"a": 1\n}' });
  });

  it('minifies', async () => {
    expect((await run('{ "a" : [ 1, 2 ] }', 'json', 'json.minify')).text).toBe('{"a":[1,2]}');
  });

  it('sorts keys recursively, keeping array order', async () => {
    const out = await run('{"b":[{"z":1,"y":2}],"a":1}', 'json', 'json.sortKeys');
    expect(out.text).toBe(JSON.stringify({ a: 1, b: [{ y: 2, z: 1 }] }, null, 2));
  });

  it('converts to YAML', async () => {
    const out = await run(src, 'json', 'json.toYaml');
    expect(out).toMatchObject({
      mime: 'application/yaml',
      text: 'b:\n  d: 1\n  c:\n    - true\n    - null\na: x\n',
    });
  });

  it('generates TypeScript types with the root name', async () => {
    const out = await run('[{"id":1,"tags":["a"]},{"id":2,"note":"x"}]', 'json', 'json.types', {
      rootName: 'Item',
    });
    expect(out.name).toBe('Item.ts');
    expect(out.text).toBe(
      'export type Item = {\n  id: number;\n  tags?: string[];\n  note?: string;\n}[];\n',
    );
    const obj = await run('{"a":1}', 'json', 'json.types');
    expect(obj.text).toBe('export interface Root {\n  a: number;\n}\n');
  });
});

describe('text actions', () => {
  it('changes case', () => {
    expect(changeCase('hello World', 'upper')).toBe('HELLO WORLD');
    expect(changeCase('Hello World', 'lower')).toBe('hello world');
    expect(changeCase("it's a fine day", 'title')).toBe("It's A Fine Day");
    const ids = 'userName\nHTTPServer id\nfoo-bar_baz\n';
    expect(changeCase(ids, 'camel')).toBe('userName\nhttpServerId\nfooBarBaz\n');
    expect(changeCase(ids, 'snake')).toBe('user_name\nhttp_server_id\nfoo_bar_baz\n');
    expect(changeCase(ids, 'kebab')).toBe('user-name\nhttp-server-id\nfoo-bar-baz\n');
  });

  it('runs Change case through the engine', async () => {
    expect((await run('Some Text', 'text', 'text.changeCase', { to: 'snake' })).text).toBe(
      'some_text',
    );
  });

  it('sorts lines naturally, optionally descending and unique', async () => {
    const src = 'b10\na\nb2\nB2\na\n';
    expect((await run(src, 'text', 'text.sortLines')).text).toBe('a\na\nB2\nb2\nb10\n');
    expect((await run(src, 'text', 'text.sortLines', { order: 'desc', unique: true })).text).toBe(
      'b10\nb2\nB2\na\n',
    );
  });

  it('finds and replaces literally or by regex', async () => {
    const src = 'cost: $1.50, $2.00';
    expect((await run(src, 'text', 'text.replace', { find: '$', replace: '£$' })).text).toBe(
      'cost: £$1.50, £$2.00',
    );
    expect(
      (
        await run(src, 'text', 'text.replace', {
          find: '\\$(\\d+)',
          replace: '$1 GBP ',
          regex: true,
        })
      ).text,
    ).toBe('cost: 1 GBP .50, 2 GBP .00');
    await expect(run(src, 'text', 'text.replace', { find: '(', regex: true })).rejects.toThrow(
      'Invalid regular expression',
    );
    await expect(run(src, 'text', 'text.replace')).rejects.toThrow('Enter something to find');
  });
});

describe('Hash', () => {
  it('hashes the raw bytes of any kind', async () => {
    expect((await run('abc', 'text', 'any.hash')).text).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect((await run('abc', 'text', 'any.hash', { algorithm: 'SHA-1' })).text).toBe(
      'a9993e364706816aba3e25717850c26c9cd0d89d',
    );
  });
});

describe('Image convert', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('re-encodes through an OffscreenCanvas with the chosen format and quality', async () => {
    const calls: unknown[] = [];
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', async (blob: Blob) => {
      calls.push(['decode', blob.type, blob.size]);
      return { width: 3, height: 2, close };
    });
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        constructor(
          public width: number,
          public height: number,
        ) {
          calls.push(['canvas', width, height]);
        }
        getContext() {
          return {
            fillStyle: '',
            fillRect: (...a: number[]) => calls.push(['fill', ...a]),
            drawImage: () => calls.push(['draw']),
          };
        }
        async convertToBlob(opts: { type: string; quality: number }) {
          calls.push(['encode', opts.type, opts.quality]);
          return new Blob([new Uint8Array([1, 2, 3])], { type: opts.type });
        }
      },
    );
    const engine = new Engine({ loaders: {} });
    const png = pngHeader(3, 2);
    await engine.ingest({ ...entry(png, 'image/png'), name: 'photo.png' });
    expect(await engine.actions('en-1', 'image')).toContain('image.convert');

    const out = await engine.runAction('en-1', 'image', 'image.convert', {
      format: 'jpeg',
      quality: 80,
    });
    expect(out).toEqual([
      {
        mime: 'image/jpeg',
        name: 'photo.jpg',
        bytes: new Uint8Array([1, 2, 3]),
      },
    ]);
    expect(calls).toEqual([
      ['decode', 'image/png', png.byteLength],
      ['canvas', 3, 2],
      ['fill', 0, 0, 3, 2],
      ['draw'],
      ['encode', 'image/jpeg', 0.8],
    ]);
    expect(close).toHaveBeenCalled();
  });

  it('is not offered for SVG, which workers cannot decode', async () => {
    const engine = new Engine({ loaders: {} });
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>';
    await engine.ingest(entry(svg, 'image/svg+xml'));
    expect(await engine.actions('en-1', 'image')).toEqual(['any.hash', 'any.hexDump']);
  });
});
