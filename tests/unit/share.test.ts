import { describe, expect, it } from 'vitest';
import {
  partFromResponse,
  shareEntries,
  shareKey,
  type SharedPart,
} from '../../src/capture/sharePayload';

const text = (field: string, value: string): SharedPart => ({
  field,
  mime: 'text/plain',
  blob: new Blob([value]),
});

const file = (name: string, mime: string, content: string): SharedPart => ({
  field: 'files',
  mime,
  blob: new Blob([content], { type: mime }),
  filename: name,
});

const contents = async (parts: SharedPart[]) =>
  Promise.all(
    (await shareEntries(parts)).map(async e => ({
      mime: e.mime,
      name: e.name,
      text: await e.blob.text(),
      size: e.size,
    })),
  );

describe('shareEntries', () => {
  it('keeps the text and drops a title when there is other content', async () => {
    expect(
      await contents([text('title', 'Example Domain'), text('text', 'https://example.com')]),
    ).toEqual([{ mime: 'text/plain', name: undefined, text: 'https://example.com', size: 19 }]);
  });

  it('adds the URL unless the text already contains it', async () => {
    const both = await contents([text('text', 'Look at this'), text('url', 'https://a.example/')]);
    expect(both.map(e => e.text)).toEqual(['Look at this', 'https://a.example/']);
    const inText = await contents([
      text('text', 'Look: https://a.example/'),
      text('url', 'https://a.example/'),
    ]);
    expect(inText.map(e => e.text)).toEqual(['Look: https://a.example/']);
  });

  it('uses the URL alone, or the title when nothing else was shared', async () => {
    expect((await contents([text('url', 'https://b.example')])).map(e => e.text)).toEqual([
      'https://b.example',
    ]);
    expect((await contents([text('title', 'Just a title')])).map(e => e.text)).toEqual([
      'Just a title',
    ]);
  });

  it('turns files into named entries after the text', async () => {
    expect(
      await contents([
        file('data.json', 'application/json', '{"a":1}'),
        text('text', ' caption '),
        file('b.csv', 'text/csv', 'x,y\n1,2'),
      ]),
    ).toEqual([
      { mime: 'text/plain', name: undefined, text: 'caption', size: 7 },
      { mime: 'application/json', name: 'data.json', text: '{"a":1}', size: 7 },
      { mime: 'text/csv', name: 'b.csv', text: 'x,y\n1,2', size: 7 },
    ]);
  });

  it('returns nothing for an empty share', async () => {
    expect(await shareEntries([text('text', '   ')])).toEqual([]);
    expect(await shareEntries([])).toEqual([]);
  });
});

describe('stashed parts', () => {
  it('finds the share id and part index in a stashed URL', () => {
    expect(shareKey('https://x.example/clipbox/__clipbox/share/0b6c-41/3')).toEqual({
      id: '0b6c-41',
      index: 3,
    });
    expect(shareKey('https://x.example/__clipbox/share/abc/0')).toEqual({ id: 'abc', index: 0 });
    expect(shareKey('https://x.example/__clipbox/downloaded')).toBeNull();
    expect(shareKey('https://x.example/__clipbox/share/abc/x')).toBeNull();
  });

  it('reads a text part back from its response', async () => {
    const res = new Response('hello', {
      headers: { 'x-clipbox-field': 'text', 'content-type': 'text/plain;charset=utf-8' },
    });
    const part = await partFromResponse(res);
    expect(part).toMatchObject({ field: 'text', mime: 'text/plain;charset=utf-8' });
    expect(part?.filename).toBeUndefined();
    expect(await part?.blob.text()).toBe('hello');
  });

  it('decodes a file part’s name', async () => {
    const res = new Response(new Uint8Array([1, 2, 3]), {
      headers: {
        'x-clipbox-field': 'files',
        'x-clipbox-filename': encodeURIComponent('résumé 1.pdf'),
        'content-type': 'application/pdf',
      },
    });
    const part = await partFromResponse(res);
    expect(part).toMatchObject({
      field: 'files',
      mime: 'application/pdf',
      filename: 'résumé 1.pdf',
    });
    expect(part?.blob.size).toBe(3);
  });

  it('rejects a response without a field', async () => {
    expect(await partFromResponse(new Response('x'))).toBeNull();
  });
});
