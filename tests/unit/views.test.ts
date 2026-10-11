import { describe, expect, it } from 'vitest';
import { Engine } from '../../src/engine/engine';
import { parseViews, type InspectorView, type ViewClass } from '../../src/state/uiStore';
import { viewClassOf, viewFor, viewsFor } from '../../src/state/views';

const views = (text: InspectorView, binary: InspectorView): Record<ViewClass, InspectorView> => ({
  text,
  binary,
});
const labels = (kind: string) => viewsFor(kind).map(o => o.label);

describe('inspector views', () => {
  it('offers views per kind, with the rendered one named for what it shows', () => {
    expect(labels('html')).toEqual(['Text', 'Preview', 'Split', 'Hex dump']);
    expect(labels('json')).toEqual(['Text', 'Tree', 'Split', 'Hex dump']);
    expect(labels('records')).toEqual(['Text', 'Table', 'Split', 'Hex dump']);
    expect(labels('text')).toEqual(['Text', 'Hex dump']);
    expect(labels('image')).toEqual(['Image', 'Hex dump']);
    expect(labels('pdf')).toEqual(['Pages', 'Hex dump']);
    expect(labels('binary')).toEqual(['Hex dump']);
  });

  it('opens text-based kinds in Split and binary ones rendered', () => {
    const defaults = views('split', 'rendered');
    expect(viewFor('json', defaults)).toBe('split');
    expect(viewFor('markdown', defaults)).toBe('split');
    expect(viewFor('image', defaults)).toBe('rendered');
    expect(viewFor('pdf', defaults)).toBe('rendered');
  });

  it('remembers a choice per class, falling back where a view isn’t offered', () => {
    expect(viewFor('yaml', views('hex', 'rendered'))).toBe('hex');
    expect(viewFor('image', views('split', 'hex'))).toBe('hex');
    // Plain text has no Split or rendered view: it shows its text
    expect(viewFor('text', views('split', 'rendered'))).toBe('text');
    expect(viewFor('text', views('rendered', 'rendered'))).toBe('text');
    // Images have no Text view: rendered
    expect(viewFor('image', views('split', 'text'))).toBe('rendered');
    expect(viewFor('binary', views('split', 'rendered'))).toBe('hex');
    expect(viewClassOf('audio')).toBe('binary');
    expect(viewClassOf(undefined)).toBe('text');
  });

  it('reads saved views, migrating older settings', () => {
    expect(parseViews('{"text":"text","binary":"hex"}')).toEqual({ text: 'text', binary: 'hex' });
    // Preview / Split / Raw names, and binary Split, from before views were per kind
    expect(parseViews('{"text":"preview","binary":"split"}')).toEqual({
      text: 'rendered',
      binary: 'rendered',
    });
    expect(parseViews('{"text":"raw","binary":"raw"}')).toEqual({ text: 'text', binary: 'hex' });
    expect(parseViews('raw')).toEqual({ text: 'text', binary: 'rendered' });
    expect(parseViews('{"text":"nonsense"}')).toEqual({ text: 'split', binary: 'rendered' });
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
