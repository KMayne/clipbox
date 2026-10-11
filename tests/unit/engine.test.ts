import { describe, expect, it } from 'vitest';
import { Engine } from '../../src/engine/engine';

describe('Engine', () => {
  it('ingests, materialises and slices', async () => {
    const engine = new Engine();
    const blob = new Blob(['[{"a":1},{"a":2}]'], { type: 'text/plain' });
    const res = await engine.ingest({ id: 'en-1', mime: 'text/plain', size: blob.size, blob });
    expect(res.interpretations.map(i => i.label)).toEqual([
      'JSON array · 2',
      'Records 2×1',
      'Text · 1 line',
    ]);
    expect(res.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(res.preview).toBe('[{"a":1},{"a":2}]');
    const m = engine.materialise('en-1', 'json');
    expect(m.summary.extent).toBe(2);
    expect(engine.exportValue('en-1', 'records').text).toBe('a\n1\n2');
    expect(engine.raw('en-1', 5)).toEqual({ text: '[{"a"', truncated: true });
  });
});
