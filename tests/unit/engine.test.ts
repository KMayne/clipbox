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
    engine.setPolicies({ langdetect: 'off' });
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
    engine.setPolicies({ langdetect: 'auto' });
    const res = await engine.ingest(entry(CODE));
    expect(res.interpretations).toEqual([
      expect.objectContaining({ kind: 'text', status: 'loading', module: 'langdetect' }),
    ]);
    const resolved = await engine.resolve('en-1', 'text');
    expect(resolved).toMatchObject({ status: 'ready', label: 'TypeScript · 3 lines' });
    expect((await engine.summary('en-1', 'text')).language).toBe('typescript');
    expect(engine.moduleLoadStates()).toEqual({ langdetect: 'loaded' });
  });

  it('parses text without a language when the module is off or fails to load', async () => {
    const off = new Engine({ loaders: { langdetect: fakeLangdetect } });
    off.setPolicies({ langdetect: 'off' });
    const res = await off.ingest(entry(CODE));
    expect(res.interpretations[0]).toMatchObject({ status: 'ready', label: 'Text · 3 lines' });
    expect(off.moduleLoadStates()).toEqual({});

    const broken = new Engine({
      loaders: { langdetect: () => Promise.reject(new Error('offline')) },
    });
    broken.setPolicies({ langdetect: 'auto' });
    await broken.ingest(entry(CODE));
    expect(await broken.resolve('en-1', 'text')).toMatchObject({
      status: 'ready',
      label: 'Text · 3 lines',
    });
  });

  it('preloads modules with the preload policy', async () => {
    const engine = new Engine({ loaders: { langdetect: fakeLangdetect } });
    engine.setPolicies({ langdetect: 'preload' });
    await Promise.resolve();
    await engine.ingest(entry(CODE));
    expect(engine.moduleLoadStates()).toEqual({ langdetect: 'loaded' });
  });
});
