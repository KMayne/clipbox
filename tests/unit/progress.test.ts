import { afterEach, describe, expect, it, vi } from 'vitest';
import { findStrings, findStringsAsync } from '../../src/core/executable/strings';
import {
  abortError,
  checkpoint,
  cleanReport,
  isAbortError,
  loop,
  raceAbort,
  throttle,
  type ProgressReport,
} from '../../src/core/progress';
import { Engine, type RunProgress } from '../../src/engine/engine';

describe('throttle', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends the first report at once, holds back the rest, and always sends the last', () => {
    vi.useFakeTimers();
    const sent: ProgressReport[] = [];
    const t = throttle(r => sent.push(r), 100);
    t.report(0, 'a');
    expect(sent).toEqual([{ fraction: 0, message: 'a' }]);
    for (let i = 1; i <= 9; i++) {
      vi.advanceTimersByTime(5);
      t.report(i / 10, 'b');
    }
    expect(sent).toHaveLength(1);
    vi.advanceTimersByTime(100);
    // Only the latest held-back report goes
    expect(sent).toEqual([
      { fraction: 0, message: 'a' },
      { fraction: 0.9, message: 'b' },
    ]);
  });

  it('caps the rate at one report per interval', () => {
    vi.useFakeTimers();
    let count = 0;
    const t = throttle(() => count++, 100);
    for (let ms = 0; ms < 1000; ms++) {
      t.report(ms / 1000);
      vi.advanceTimersByTime(1);
    }
    t.flush();
    expect(count).toBeGreaterThanOrEqual(10);
    expect(count).toBeLessThanOrEqual(12);
  });

  it('flush sends a held-back report now; dispose drops it', () => {
    vi.useFakeTimers();
    const sent: ProgressReport[] = [];
    const t = throttle(r => sent.push(r), 100);
    t.report(0.1);
    t.report(1, 'done');
    t.flush();
    expect(sent.at(-1)).toEqual({ fraction: 1, message: 'done' });
    t.report(0.5);
    t.flush();
    t.report(0.6);
    t.dispose();
    vi.advanceTimersByTime(500);
    expect(sent.at(-1)).toEqual({ fraction: 0.5 });
  });

  it('clamps fractions and treats non-numbers as indeterminate', () => {
    expect(cleanReport(1.5)).toEqual({ fraction: 1 });
    expect(cleanReport(-1, 'x')).toEqual({ fraction: 0, message: 'x' });
    expect(cleanReport(NaN)).toEqual({});
    expect(cleanReport(undefined, 'Hashing')).toEqual({ message: 'Hashing' });
  });
});

describe('cancellation helpers', () => {
  it('AbortErrors are recognised, also after crossing Comlink as plain errors', () => {
    expect(isAbortError(abortError())).toBe(true);
    expect(isAbortError(Object.assign(new Error('Cancelled'), { name: 'AbortError' }))).toBe(true);
    expect(isAbortError(new Error('Cancelled'))).toBe(false);
  });

  it('raceAbort rejects as soon as the signal aborts', async () => {
    const controller = new AbortController();
    const never = new Promise<number>(() => {});
    const raced = raceAbort(never, controller.signal);
    controller.abort();
    await expect(raced).rejects.toMatchObject({ name: 'AbortError' });
    await expect(raceAbort(Promise.resolve(1), new AbortController().signal)).resolves.toBe(1);
  });

  it('checkpoint and loop stop once aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(checkpoint(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    const seen: number[] = [];
    const live = new AbortController();
    const reports: (number | undefined)[] = [];
    const task = {
      signal: live.signal,
      progress: (f: number | undefined) => {
        reports.push(f);
        if (f !== undefined && f >= 0.5) live.abort();
      },
    };
    await expect(loop(100, task, 'x', i => seen.push(i), 10)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(seen).toHaveLength(50);
    expect(reports).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5]);
  });

  it('strings: the async scan matches the sync one, reports progress and cancels', async () => {
    const b = new Uint8Array(3 << 20);
    b.set(new TextEncoder().encode('hello world'), 2 << 20);
    const options = { minLength: 6, encoding: 'both' as const, max: 100 };
    const reports: number[] = [];
    const task = {
      signal: new AbortController().signal,
      progress: (f?: number) => reports.push(f ?? -1),
    };
    const found = await findStringsAsync(b, options, task);
    expect(found).toEqual(findStrings(b, options));
    expect(found.strings.map(s => s.text)).toEqual(['hello world']);
    expect(reports.length).toBeGreaterThan(2);
    expect(reports).toEqual([...reports].sort((x, y) => x - y));

    const controller = new AbortController();
    const cancelling = { signal: controller.signal, progress: () => controller.abort() };
    await expect(findStringsAsync(b, options, cancelling)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});

/** A CSV big enough that filtering it reports progress several times. */
function bigCsv(rows: number) {
  const lines = ['id,name,score'];
  for (let i = 0; i < rows; i++) lines.push(`${i},row ${i},${i % 100}`);
  return new TextEncoder().encode(lines.join('\n'));
}

async function engineWithCsv(rows = 20000) {
  const engine = new Engine({ loaders: {} });
  const blob = new Blob([bigCsv(rows)], { type: 'text/csv' });
  await engine.ingest({ id: 'en-1', mime: 'text/csv', size: blob.size, blob, name: 'big.csv' });
  return engine;
}

describe('engine runs', () => {
  const filter = { column: 'score', op: 'lt', value: '50' };

  it('reports throttled progress under the run id, ending with the last report', async () => {
    const engine = await engineWithCsv();
    const reports: RunProgress[] = [];
    engine.onProgress(p => reports.push(p));
    const [out] = await engine.runAction('en-1', 'records', 'records.filter', filter, 'run-a');
    expect(new TextDecoder().decode(out?.bytes).split('\n').filter(Boolean)).toHaveLength(10001);
    expect(reports.length).toBeGreaterThan(0);
    expect(reports.every(r => r.runId === 'run-a')).toBe(true);
    expect(reports[0]).toMatchObject({ fraction: 0, message: 'Filtering 20,000 rows' });
    expect(engine.activeRuns()).toEqual([]);
  });

  it('cancelAction aborts a run mid-way: it rejects with an AbortError', async () => {
    const engine = await engineWithCsv();
    let cancelled = false;
    engine.onProgress(p => {
      if (!cancelled) {
        cancelled = true;
        engine.cancelAction(p.runId);
      }
    });
    await expect(
      engine.runAction('en-1', 'records', 'records.filter', filter, 'run-b'),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancelled).toBe(true);
    expect(engine.activeRuns()).toEqual([]);
    // The run id is free again, and an uncancelled run still works
    engine.onProgress(null);
    await expect(
      engine.runAction('en-1', 'records', 'records.filter', filter, 'run-b'),
    ).resolves.toHaveLength(1);
  });

  it('a result that arrives after Cancel is dropped', async () => {
    const engine = await engineWithCsv(10);
    // Hex dump doesn't check the signal: cancel it before it gets going
    const run = engine.runAction('en-1', 'records', 'any.hexDump', {}, 'run-c');
    engine.cancelAction('run-c');
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('forgetting the source entry cancels its runs', async () => {
    const engine = await engineWithCsv();
    engine.onProgress(() => engine.forget('en-1'));
    await expect(
      engine.runAction('en-1', 'records', 'records.filter', filter, 'run-d'),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('cancelling Normalise audio part-way through pass 1 rejects and returns nothing', async () => {
    const rate = 44100;
    const frames = rate * 20;
    const bytes = new Uint8Array(44 + frames * 2);
    const dv = new DataView(bytes.buffer);
    const ascii = (at: number, s: string) =>
      [...s].forEach((ch, i) => dv.setUint8(at + i, ch.charCodeAt(0)));
    ascii(0, 'RIFF');
    dv.setUint32(4, 36 + frames * 2, true);
    ascii(8, 'WAVE');
    ascii(12, 'fmt ');
    dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true);
    dv.setUint16(22, 1, true);
    dv.setUint32(24, rate, true);
    dv.setUint32(28, rate * 2, true);
    dv.setUint16(32, 2, true);
    dv.setUint16(34, 16, true);
    ascii(36, 'data');
    dv.setUint32(40, frames * 2, true);
    for (let i = 0; i < frames; i++)
      dv.setInt16(44 + i * 2, Math.round(1000 * Math.sin((2 * Math.PI * 440 * i) / rate)), true);

    const engine = new Engine({
      loaders: {
        media: () => import('../../src/modules/media/worker'),
        audiotools: () => import('../../src/modules/audiotools/worker'),
      },
    });
    const blob = new Blob([bytes], { type: 'audio/wav' });
    await engine.ingest({ id: 'en-a', mime: 'audio/wav', size: blob.size, blob, name: 'a.wav' });
    await engine.resolve('en-a', 'audio');
    const reports: RunProgress[] = [];
    engine.onProgress(p => {
      reports.push(p);
      engine.cancelAction(p.runId);
    });
    await expect(
      engine.runAction('en-a', 'audio', 'media.normalise', {}, 'run-n'),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(reports[0]?.message).toBe('Pass 1 of 2 · measuring loudness');
    expect(reports[0]?.fraction).toBeLessThan(0.1);
  });
});
