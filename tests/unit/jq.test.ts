import { describe, expect, it } from 'vitest';
import type { EntryId } from '../../src/core/types';
import type { RunProgress } from '../../src/engine/engine';
import { Engine } from '../../src/engine/engine';
import { createJqRunner, createJqService } from '../../src/modules/jq/jq';
import type { JqOptions } from '../../src/modules/jq/service';
import { fakeJqWorker, inlineJqWorker, type FakeJqWorker } from './fakeJqWorker';

const opts: JqOptions = { raw: false, compact: true, slurp: false, args: [] };

/** A service over fake workers, keeping each one it spawns. */
function serviceWith(make: () => FakeJqWorker) {
  const spawned: FakeJqWorker[] = [];
  const service = createJqService(() => {
    const w = make();
    spawned.push(w);
    return w;
  });
  return { service, spawned };
}

/** Never answers: a filter such as repeat(.) */
const hangingWorker = () => fakeJqWorker(() => {});
const echoWorker = () =>
  fakeJqWorker((req, reply) => reply({ id: req.id, ok: true, stdout: req.filter }));

describe('jq service (runner workers)', () => {
  it('runs real jq through the runner protocol and keeps one worker warm', async () => {
    const { service, spawned } = serviceWith(inlineJqWorker);
    expect(await service.run('[1,2,3]', 'map(. * 2)', opts)).toBe('[2,4,6]');
    expect(await service.run('{"a":1}', '.a', opts)).toBe('1');
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.posted.map(p => p.flags)).toEqual([['-c'], ['-c']]);
    await expect(service.run('1', 'error("boom")', opts)).rejects.toThrow('jq: error: boom');
    // A jq error isn't the worker's fault: it's still reused
    expect(await service.run('1', '. + 1', opts)).toBe('2');
    expect(spawned).toHaveLength(1);
  });

  it('gives concurrent runs a worker each, keeping only one afterwards', async () => {
    const { service, spawned } = serviceWith(echoWorker);
    const [a, b] = await Promise.all([service.run('1', 'a', opts), service.run('1', 'b', opts)]);
    expect([a, b]).toEqual(['a', 'b']);
    expect(spawned).toHaveLength(2);
    expect(spawned.filter(w => w.terminated)).toHaveLength(1);
  });

  it('terminates the worker on abort and rejects with an AbortError', async () => {
    const { service, spawned } = serviceWith(hangingWorker);
    const ac = new AbortController();
    const run = service.run('1', 'repeat(.)', opts, { signal: ac.signal });
    ac.abort();
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    expect(spawned[0]?.terminated).toBe(true);
    // An already-aborted signal never starts a worker
    await expect(service.run('1', '.', opts, { signal: ac.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(spawned).toHaveLength(1);
  });

  it('times out, terminating the worker, and the next run gets a fresh one', async () => {
    let hang = true;
    const { service, spawned } = serviceWith(() => (hang ? hangingWorker() : echoWorker()));
    await expect(service.run('1', 'repeat(.)', opts, { timeout: 0.05 })).rejects.toThrow(
      'jq timed out after 0.05 s',
    );
    expect(spawned[0]?.terminated).toBe(true);
    hang = false;
    expect(await service.run('1', '.', opts)).toBe('.');
    expect(spawned).toHaveLength(2);
  });

  it('rejects when the worker itself fails, and drops it', async () => {
    const w = hangingWorker();
    const service = createJqService(() => w);
    const run = service.run('1', '.', opts);
    w.fail('Failed to load the jq worker');
    await expect(run).rejects.toThrow('Failed to load the jq worker');
    expect(w.terminated).toBe(true);
  });

  it('ignores replies for other runs and malformed messages', async () => {
    const { service } = serviceWith(() =>
      fakeJqWorker((req, reply) => {
        reply({ id: req.id + 100, ok: true, stdout: 'wrong' });
        reply('nonsense');
        reply({ id: req.id, ok: true, stdout: 'right' });
      }),
    );
    expect(await service.run('1', '.', opts)).toBe('right');
  });

  it('the runner answers bad requests with an error', async () => {
    const handle = createJqRunner(() => Promise.reject(new Error('offline')));
    expect(await handle({ nope: 1 })).toEqual({ id: -1, ok: false, error: 'Bad jq request' });
    expect(await handle({ id: 3, input: '1', filter: '.', flags: [] })).toEqual({
      id: 3,
      ok: false,
      error: 'offline',
    });
  });
});

describe('jq action: cancel and timeout through the engine', () => {
  async function engineWithJson(make: () => FakeJqWorker) {
    const service = createJqService(make);
    const engine = new Engine({ loaders: { jq: async () => ({ service }) } });
    const text = '[{"a":1}]';
    const blob = new Blob([text], { type: 'text/plain' });
    const id: EntryId = 'en-1';
    await engine.ingest({ id, mime: 'text/plain', size: blob.size, blob });
    return engine;
  }

  it('reports "Running jq…" and Cancel stops a filter that never ends', async () => {
    const engine = await engineWithJson(hangingWorker);
    const reports: RunProgress[] = [];
    engine.onProgress(p => {
      reports.push(p);
      engine.cancelAction(p.runId);
    });
    await expect(
      engine.runAction('en-1', 'json', 'query.jq', { filter: 'repeat(.)' }, 'run-jq'),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(reports[0]).toMatchObject({ runId: 'run-jq', message: 'Running jq…' });
    expect(reports[0]?.fraction).toBeUndefined();
  });

  it('the timeout setting stops it with a clear error', async () => {
    const engine = await engineWithJson(hangingWorker);
    await expect(
      engine.runAction('en-1', 'json', 'query.jq', { filter: 'repeat(.)', timeout: 1 }),
    ).rejects.toThrow('jq timed out after 1 s');
  });
});
