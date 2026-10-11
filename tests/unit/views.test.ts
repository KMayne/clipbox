import { describe, expect, it } from 'vitest';
import { Engine } from '../../src/engine/engine';
import { parseViews } from '../../src/state/uiStore';
import { canSplit, viewClassOf, viewFor } from '../../src/state/views';

describe('inspector views', () => {
  const defaults = { text: 'split', binary: 'preview' } as const;

  it('opens text-based kinds in Split and binary ones in Preview', () => {
    expect(viewFor('json', defaults)).toBe('split');
    expect(viewFor('markdown', defaults)).toBe('split');
    expect(viewFor('image', defaults)).toBe('preview');
    expect(viewFor('pdf', defaults)).toBe('preview');
  });

  it('remembers a choice per class', () => {
    const views = { text: 'raw', binary: 'split' } as const;
    expect(viewFor('yaml', views)).toBe('raw');
    expect(viewFor('image', views)).toBe('split');
    expect(viewClassOf('audio')).toBe('binary');
    expect(viewClassOf(undefined)).toBe('text');
  });

  it("doesn't split values whose preview already is their source", () => {
    expect(canSplit('text')).toBe(false);
    expect(canSplit('binary')).toBe(false);
    expect(canSplit('image')).toBe(true);
    expect(viewFor('text', defaults)).toBe('preview');
    expect(viewFor('binary', { text: 'split', binary: 'split' })).toBe('preview');
  });

  it('reads saved views, migrating the old single-view setting', () => {
    expect(parseViews('{"text":"preview","binary":"split"}')).toEqual({
      text: 'preview',
      binary: 'split',
    });
    expect(parseViews('raw')).toEqual({ text: 'raw', binary: 'preview' });
    expect(parseViews('{"text":"nonsense"}')).toEqual({ text: 'split', binary: 'preview' });
    expect(parseViews('not json')).toBeUndefined();
    expect(parseViews(null)).toBeUndefined();
  });
});

describe('Engine.rawBytes', () => {
  it('returns a clamped window of the original bytes', async () => {
    const engine = new Engine({ loaders: {} });
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    await engine.ingest({ id: 'en-1', mime: blob.type, size: blob.size, blob });
    expect([...engine.rawBytes('en-1', 0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect([...engine.rawBytes('en-1', 5, 100)]).toEqual([2, 3]);
    expect([...engine.rawBytes('en-1', 50, 60)]).toEqual([]);
  });
});
