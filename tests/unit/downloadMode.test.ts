import { describe, expect, it } from 'vitest';
import {
  DOWNLOAD_MODE_KEY,
  LEGACY_BACKGROUND_KEY,
  LEGACY_POLICIES_KEY,
  loadDownloadMode,
  parseDownloadMode,
  saveDownloadMode,
} from '../../src/modules/downloadMode';

/** An in-memory Storage. */
function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
    removeItem: (k: string) => void items.delete(k),
  };
}

describe('parseDownloadMode', () => {
  it('defaults to Automatic', () => {
    expect(parseDownloadMode(null, null)).toBe('automatic');
  });

  it.each(['automatic', 'onDemand', 'everything'])('reads a stored %s', mode => {
    expect(parseDownloadMode(JSON.stringify({ mode }), null)).toBe(mode);
  });

  it.each(['not json', '"onDemand"', '{"mode":"sometimes"}', '{}', 'null'])(
    'ignores malformed %s',
    stored => {
      expect(parseDownloadMode(stored, null)).toBe('automatic');
    },
  );

  it('migrates the old background toggle: off means On demand', () => {
    expect(parseDownloadMode(null, '{"enabled":false,"skipped":["x509"]}')).toBe('onDemand');
    expect(parseDownloadMode(null, '{"enabled":true,"skipped":[]}')).toBe('automatic');
    expect(parseDownloadMode(null, 'garbage')).toBe('automatic');
  });

  it('prefers the new setting over the old toggle', () => {
    expect(parseDownloadMode('{"mode":"everything"}', '{"enabled":false}')).toBe('everything');
  });
});

describe('loadDownloadMode', () => {
  it('saves the migrated mode and removes both legacy keys', () => {
    const storage = memoryStorage({
      [LEGACY_BACKGROUND_KEY]: '{"enabled":false,"skipped":[]}',
      [LEGACY_POLICIES_KEY]: '{"x509":"off"}',
    });
    expect(loadDownloadMode(storage)).toBe('onDemand');
    expect(Object.fromEntries(storage.items)).toEqual({
      [DOWNLOAD_MODE_KEY]: '{"mode":"onDemand"}',
    });
    // Loading again reads the migrated setting
    expect(loadDownloadMode(storage)).toBe('onDemand');
  });

  it('writes nothing when there is nothing to migrate', () => {
    const storage = memoryStorage();
    expect(loadDownloadMode(storage)).toBe('automatic');
    expect(storage.items.size).toBe(0);
  });

  it('round-trips with saveDownloadMode', () => {
    const storage = memoryStorage();
    saveDownloadMode(storage, 'everything');
    expect(loadDownloadMode(storage)).toBe('everything');
  });

  it('falls back to the default when storage throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {},
      removeItem: () => {},
    };
    expect(loadDownloadMode(broken)).toBe('automatic');
    expect(() =>
      saveDownloadMode({ ...broken, setItem: broken.getItem }, 'onDemand'),
    ).not.toThrow();
  });
});
