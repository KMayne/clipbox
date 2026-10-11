import { describe, expect, it } from 'vitest';
import { toBase64 } from '../../src/core/format';
import { detectKinds, getInterpreter } from '../../src/core/interpreters';
import type { InterpretContext } from '../../src/core/interpreter';
import { bytesContent, pngHeader, textContent } from './helpers';

const noServices: InterpretContext = { service: async () => null };
const b64 = getInterpreter('base64');
const confidence = (text: string) => b64.detect(textContent(text));
const enc = (s: string) => btoa(s);

async function parse(text: string) {
  const v = await b64.parse(textContent(text), noServices);
  return { label: b64.label(v), summary: await b64.summarise(v), value: v };
}

const stat = (stats: { label: string; value: string }[], label: string) =>
  stats.find(s => s.label === label)?.value;

describe('base64 detection', () => {
  it('scores by decoded content', () => {
    expect(confidence(enc('{"user":"ada","id":42}'))).toBe(0.85);
    expect(confidence(toBase64(pngHeader(4, 4)))).toBe(0.85);
    expect(confidence(enc('Hello, world! How are you?'))).toBe(0.6);
    const random = toBase64(Uint8Array.from({ length: 48 }, (_, i) => (i * 97 + 13) % 256));
    expect(confidence(random)).toBe(0.4);
  });

  it('accepts URL-safe, unpadded and wrapped input', async () => {
    const urlSafe = enc('??>>??>>{"a":"b"}~~~~').replace(/\+/g, '-').replace(/\//g, '_');
    expect(urlSafe).toMatch(/[-_]/);
    expect((await parse(urlSafe)).value).toMatchObject({ variant: 'url' });
    const unpadded = enc('Hello, world! Hi').replace(/=+$/, '');
    expect((await parse(unpadded)).value).toMatchObject({
      padded: false,
      text: 'Hello, world! Hi',
    });
    const long = enc('The quick brown fox jumps over the lazy dog. '.repeat(4));
    const wrapped = long.match(/.{1,76}/g)?.join('\n') ?? '';
    expect(wrapped).toContain('\n');
    expect(confidence(wrapped)).toBe(0.6);
  });

  it('accepts short unpadded tokens that decode to words', () => {
    expect(confidence('aGVsbG8gd29ybGQ')).toBe(0.5); // "hello world"
    expect(confidence('YWRtaW46c2VjcmV0')).toBe(0.6); // "admin:secret", 16 chars
    expect(confidence('YWRtaW46cGFzcw')).toBe(0.5); // "admin:pass"
    expect(detectKinds(textContent('aGVsbG8gd29ybGQ'))[0]?.kind).toBe('base64');
  });

  it.each([
    'Constructor1',
    'readonlyArray',
    'toLocaleString',
    'getElementById',
    'TildeToken',
    'big-endian',
    'Administrator',
    '1700000000000',
  ])('does not take the short word %s for base64', word => {
    expect(confidence(word)).toBe(0);
  });

  it('rejects words, hex, short strings, JSON and bad padding', () => {
    expect(confidence('HelloWorldThisIsJustWords')).toBe(0);
    expect(confidence('some_snake_case_identifier_name')).toBe(0);
    expect(confidence('Administrator123')).toBe(0);
    expect(confidence('deadbeefcafebabe0123456789abcdef')).toBe(0);
    expect(confidence('aGVsbG8=')).toBe(0);
    expect(confidence('{"a": 1, "b": [1, 2, 3]}')).toBe(0);
    expect(confidence('two words that are long enough')).toBe(0);
    expect(confidence(enc('Hello, world! Hi!') + '=')).toBe(0);
    expect(confidence('ab+c-def0123456789AB')).toBe(0);
  });
});

describe('base64 value', () => {
  it('labels and summarises decoded text', async () => {
    const { label, summary, value } = await parse(enc('{"user":"ada"}\n'));
    expect(label).toBe('Base64 · JSON · 15 B');
    expect(value).toMatchObject({ kind: 'base64', variant: 'standard', mime: 'application/json' });
    expect(summary.language).toBe('json');
    expect(stat(summary.stats, 'Decoded size')).toBe('15 B');
    expect(stat(summary.stats, 'Encoded size')).toBe('20 chars');
    expect(await b64.slice(value, { type: 'text' })).toBe('{"user":"ada"}\n');
    expect(await b64.export(value)).toEqual({ text: '{"user":"ada"}\n' });
  });

  it('decodes data URLs with their MIME type and previews images', async () => {
    const url = `data:image/png;base64,${toBase64(pngHeader(2, 3))}`;
    expect(confidence(url)).toBe(0.95);
    const { label, value, summary } = await parse(url);
    expect(label).toBe('Base64 · PNG · 33 B');
    expect(value).toMatchObject({ mime: 'image/png', text: null, dataUrl: true });
    expect(summary.language).toBeUndefined();
    expect(await b64.slice(value, { type: 'image' })).toMatchObject({ mime: 'image/png' });
    expect(await b64.derive(value, 'decode')).toMatchObject({ mime: 'image/png' });

    const text = await parse('data:text/plain;charset=utf-8;base64,aGk=');
    expect(text.value).toMatchObject({ mime: 'text/plain', text: 'hi' });
    expect(text.label).toBe('Base64 · text · 2 B');
  });

  it('copies decoded images as images and other binary as the base64 text', async () => {
    const png = toBase64(pngHeader(2, 3));
    const image = await parse(png);
    expect(await b64.export(image.value)).toEqual({
      image: { bytes: pngHeader(2, 3), mime: 'image/png' },
    });
    const url = `data:image/png;base64,${png}`;
    expect((await b64.export((await parse(url)).value)).image?.mime).toBe('image/png');

    const random = toBase64(Uint8Array.from({ length: 48 }, (_, i) => (i * 97 + 13) % 256));
    expect(await b64.export((await parse(`  ${random}\n`)).value)).toEqual({ text: random });
    const octets = `data:application/octet-stream;base64,${random}`;
    expect(await b64.export((await parse(octets)).value)).toEqual({ text: octets });
  });

  it('is not offered for binary entries', () => {
    expect(b64.detect(bytesContent(pngHeader(1, 1)))).toBe(0);
  });
});
