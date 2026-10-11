import { describe, expect, it } from 'vitest';
import { judgeConnection, nextToDownload } from '../../src/modules/backgroundPolicy';

describe('judgeConnection', () => {
  const fast = { effectiveType: '4g', downlink: 10, saveData: false };

  it('accepts a fast connection', () => {
    expect(judgeConnection(fast)).toEqual({ ok: true });
  });

  it.each([
    [null, 'connection speed unknown'],
    [{ ...fast, saveData: true }, 'Data Saver is on'],
    [{ ...fast, type: 'cellular' }, 'on a cellular connection'],
    [{ ...fast, effectiveType: '3g' }, 'slow connection (3g)'],
    [{ ...fast, downlink: 1.5 }, 'slow connection (1.5 Mbps)'],
    [{ effectiveType: '4g' }, 'slow connection (? Mbps)'],
  ])('rejects %j', (conn, reason) => {
    expect(judgeConnection(conn)).toEqual({ ok: false, reason });
  });
});

describe('nextToDownload', () => {
  const sizes = { editor: 5_400_000, langdetect: 1_800_000, x509: 220_000, pdf: 4_000_000 };
  const none = { state: 'none' } as const;
  const cached = { state: 'cached' } as const;

  it('picks the smallest auto module that is not cached, tried or skipped', () => {
    const cache = { editor: none, langdetect: none, x509: cached, pdf: none };
    expect(nextToDownload(sizes, {}, cache, new Set())).toBe('langdetect');
    expect(nextToDownload(sizes, {}, cache, new Set(['langdetect']))).toBe('pdf');
  });

  it('respects policies: off is never fetched, preload is handled elsewhere', () => {
    const cache = { editor: none, langdetect: none, x509: none, pdf: none };
    const policies = { x509: 'off', langdetect: 'preload' } as const;
    expect(nextToDownload(sizes, policies, cache, new Set())).toBe('pdf');
  });

  it('returns null when everything is cached', () => {
    const cache = { editor: cached, langdetect: cached, x509: cached, pdf: cached };
    expect(nextToDownload(sizes, {}, cache, new Set())).toBeNull();
  });
});
