import { describe, expect, it } from 'vitest';
import { Engine } from '../../src/engine/engine';
import type { LanguageDetector } from '../../src/modules/langdetect/detector';
import type { WorkerModule } from '../../src/modules/types';

const entry = (text: string, id: `en-${string}` = 'en-1') => {
  const blob = new Blob([text], { type: 'text/plain' });
  return { id, mime: 'text/plain', size: blob.size, blob };
};

const fakeLangdetect = (): Promise<WorkerModule> =>
  Promise.resolve({
    service: {
      detect: async () => ({
        language: { monaco: 'typescript', name: 'TypeScript' },
        confidence: 0.4,
      }),
    } satisfies LanguageDetector,
  });

const CODE = 'export function greet(name: string): string {\n  return `hi ${name}`;\n}\n';

describe('Engine', () => {
  it('ingests, summarises and slices without returning values', async () => {
    const engine = new Engine({ loaders: {} });
    const res = await engine.ingest(entry('[{"a":1},{"a":2}]'));
    expect(res.interpretations.map(i => [i.status, i.label])).toEqual([
      ['ready', 'JSON array · 2'],
      ['ready', 'Records 2×1'],
      ['ready', 'JSON · 1 line'],
    ]);
    expect(res.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(res.preview).toBe('[{"a":1},{"a":2}]');
    const summary = await engine.summary('en-1', 'json');
    expect(summary).toMatchObject({ kind: 'json', extent: 2, bytes: 17 });
    expect(await engine.slice('en-1', 'records', { type: 'rows', from: 1, to: 2 })).toEqual([
      { a: 2 },
    ]);
    expect((await engine.exportValue('en-1', 'records')).text).toBe('a\n1\n2');
    expect(engine.raw('en-1', 5)).toEqual({ text: '[{"a"', truncated: true });
  });

  it('defers text until its language service loads, then resolves', async () => {
    const engine = new Engine({ loaders: { langdetect: fakeLangdetect } });
    const res = await engine.ingest(entry(CODE));
    expect(res.interpretations).toEqual([
      expect.objectContaining({ kind: 'text', status: 'loading', module: 'langdetect' }),
    ]);
    const resolved = await engine.resolve('en-1', 'text');
    expect(resolved).toMatchObject({ status: 'ready', label: 'TypeScript · 3 lines' });
    expect((await engine.summary('en-1', 'text')).language).toBe('typescript');
    expect(engine.moduleLoadStates()).toEqual({ langdetect: 'loaded' });
  });

  it('parses text without a language when the module is missing or fails to load', async () => {
    // No loader (e.g. a build without the module): nothing to wait for
    const missing = new Engine({ loaders: {} });
    const res = await missing.ingest(entry(CODE));
    expect(res.interpretations[0]).toMatchObject({ status: 'ready', label: 'Text · 3 lines' });
    expect(missing.moduleLoadStates()).toEqual({});

    // Offline and not cached: ctx.service() returns null and the text still parses
    const broken = new Engine({
      loaders: { langdetect: () => Promise.reject(new Error('offline')) },
    });
    await broken.ingest(entry(CODE));
    expect(await broken.resolve('en-1', 'text')).toMatchObject({
      status: 'ready',
      label: 'Text · 3 lines',
    });
  });

  it('marks a module failed after a load error, and retries it on the next need', async () => {
    let attempts = 0;
    const flaky = (): Promise<WorkerModule> =>
      ++attempts === 1 ? Promise.reject(new Error('offline')) : fakeLangdetect();
    const engine = new Engine({ loaders: { langdetect: flaky } });
    await engine.ingest(entry(CODE));
    expect(await engine.resolve('en-1', 'text')).toMatchObject({ label: 'Text · 3 lines' });
    expect(engine.moduleLoadStates()).toEqual({ langdetect: 'failed' });

    const again = await engine.ingest(entry(CODE, 'en-2'));
    expect(again.interpretations[0]).toMatchObject({ status: 'loading', module: 'langdetect' });
    expect(await engine.resolve('en-2', 'text')).toMatchObject({
      label: 'TypeScript · 3 lines',
    });
    expect(engine.moduleLoadStates()).toEqual({ langdetect: 'loaded' });
  });

  it('derives new content that ingests as another kind', async () => {
    const engine = new Engine({ loaders: {} });
    const res = await engine.ingest(entry(btoa('[{"a":1,"b":"x,y"},{"a":2}]')));
    expect(res.interpretations[0]).toMatchObject({ kind: 'base64', status: 'ready' });
    const summary = await engine.summary('en-1', 'base64');
    expect(summary.derivations).toEqual([{ id: 'decode', label: 'Decode' }]);

    const decoded = await engine.derive('en-1', 'base64', 'decode');
    expect(decoded.mime).toBe('application/json');
    const blob = new Blob([decoded.bytes], { type: decoded.mime });
    const next = await engine.ingest({ id: 'en-2', mime: decoded.mime, size: blob.size, blob });
    expect(next.interpretations[0]).toMatchObject({ kind: 'json', label: 'JSON array · 2' });
    // The source value is still usable: derive copies rather than transferring its buffer
    expect(await engine.slice('en-1', 'base64', { type: 'text' })).toContain('"x,y"');

    expect((await engine.summary('en-2', 'json')).derivations).toEqual([
      { id: 'csv', label: 'As CSV' },
    ]);
    const csv = await engine.derive('en-2', 'json', 'csv');
    expect(new TextDecoder().decode(csv.bytes)).toBe('a,b\r\n1,"x,y"\r\n2,\r\n');
    const asJson = await engine.derive('en-2', 'records', 'json');
    expect(JSON.parse(new TextDecoder().decode(asJson.bytes))).toEqual([
      { a: 1, b: 'x,y' },
      { a: 2 },
    ]);
    await expect(engine.derive('en-2', 'text', 'decode')).rejects.toThrow();
  });
});
