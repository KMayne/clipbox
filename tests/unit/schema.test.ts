import { describe, expect, it } from 'vitest';
import { defined } from '../../src/core/guards';
import { inferSchema, schemaToTs } from '../../src/core/schema';

describe('schema', () => {
  it('merges array element objects with presence', () => {
    const s = inferSchema([
      { id: 1, name: 'Ada', team: 'core' },
      { id: 2, name: 'Linus' },
      { id: 3, name: null, team: 'infra' },
      { id: 4, name: 'Grace', team: 'core' },
    ]);
    expect(s.t).toBe('array');
    if (s.t !== 'array' || s.of.t !== 'object') throw new Error('bad shape');
    expect(defined(s.of.fields.id).presence).toBe(1);
    expect(defined(s.of.fields.team).presence).toBe(0.75);
    expect(defined(s.of.fields.name).schema).toEqual({
      t: 'union',
      of: [{ t: 'string' }, { t: 'null' }],
    });
  });

  it('renders TS declarations', () => {
    const ts = schemaToTs(inferSchema([{ id: 1, 'first name': 'a' }, { id: 2 }]));
    expect(ts).toBe('{\n  id: number;\n  "first name"?: string;\n}[]');
  });

  it('parenthesises union arrays', () => {
    expect(schemaToTs(inferSchema([1, 'a']))).toBe('(number | string)[]');
  });
});
