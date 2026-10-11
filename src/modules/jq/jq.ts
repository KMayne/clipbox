import type { Jq } from 'jq-wasm';
import { z } from 'zod';
import { abortError } from '../../core/progress';
import { JQ_TIMEOUT, type JqOptions, type JqService } from './service';

/** The flags for `options`, in jq's command-line form. */
export function jqFlags({ raw, compact, slurp, args }: JqOptions): string[] {
  const flags: string[] = [];
  if (raw) flags.push('-r');
  if (compact) flags.push('-c');
  if (slurp) flags.push('-s');
  for (const a of args) flags.push(a.json ? '--argjson' : '--arg', a.name, a.value);
  return flags;
}

/**
 * jq's stderr on one line for the notice: without the stdin location (meaningless here), the
 * caret line (it can't line up in a notice) and the "N compile errors" footer.
 */
export const jqMessage = (stderr: string) =>
  stderr
    .replace(/ \(at \/dev\/stdin:\d+\)/g, '')
    .replace(/\/dev\/stdin/g, 'input')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '' && !/^\^+$/.test(line) && !/^jq: \d+ compile errors?$/.test(line))
    .join(' ');

// The runner's protocol: one request in, one response out, matched by id

export const jqRequestSchema = z.object({
  id: z.number(),
  input: z.string(),
  filter: z.string(),
  flags: z.array(z.string()),
});
export type JqRequest = z.infer<typeof jqRequestSchema>;

export const jqResponseSchema = z.union([
  z.object({ id: z.number(), ok: z.literal(true), stdout: z.string() }),
  z.object({ id: z.number(), ok: z.literal(false), error: z.string() }),
]);
export type JqResponse = z.infer<typeof jqResponseSchema>;

/**
 * The runner worker's side: answers requests with a lazily-loaded jq-wasm instance (loaded once
 * per worker). jq-wasm runs synchronously, which is why it gets a worker of its own.
 */
export function createJqRunner(load: () => Promise<Jq>): (msg: unknown) => Promise<JqResponse> {
  let jq: Promise<Jq> | null = null;
  const get = () =>
    (jq ??= load().catch((err: unknown) => {
      jq = null; // allow a retry, e.g. once back online
      throw err;
    }));
  return async msg => {
    const parsed = jqRequestSchema.safeParse(msg);
    if (!parsed.success) return { id: -1, ok: false, error: 'Bad jq request' };
    const { id, input, filter, flags } = parsed.data;
    try {
      const { stdout, stderr, exitCode } = (await get()).raw(input, filter, flags);
      if (exitCode !== 0)
        return { id, ok: false, error: stderr ? jqMessage(stderr) : `jq exited with ${exitCode}` };
      return { id, ok: true, stdout };
    } catch (err) {
      return { id, ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  };
}

/** A runner worker, as the service sees it (a real Worker, or a fake in tests). */
export interface JqWorker {
  post(request: JqRequest): void;
  /** Sets the handlers for the worker's messages and its load or uncaught errors. */
  listen(onMessage: (data: unknown) => void, onError: (message: string) => void): void;
  terminate(): void;
}

const ignore = () => {};

/**
 * A jq service that runs each filter in a runner worker from `spawn`. One idle worker is kept
 * warm (jq-wasm stays loaded) for the next run; a run that's cancelled, times out or crashes has
 * its worker terminated, which also frees whatever memory the filter took.
 */
export function createJqService(spawn: () => JqWorker): JqService {
  let idle: JqWorker | null = null;
  let nextId = 1;
  return {
    run(input, filter, options, { signal, timeout = JQ_TIMEOUT } = {}) {
      if (signal?.aborted) return Promise.reject(abortError());
      const worker = idle ?? spawn();
      idle = null;
      const id = nextId++;
      return new Promise<string>((resolve, reject) => {
        let done = false;
        const finish = (reusable: boolean) => {
          done = true;
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          worker.listen(ignore, ignore);
          if (reusable && !idle) idle = worker;
          else worker.terminate();
        };
        const onAbort = () => {
          if (done) return;
          finish(false);
          reject(abortError());
        };
        const timer = setTimeout(() => {
          if (done) return;
          finish(false);
          reject(new Error(`jq timed out after ${timeout} s`));
        }, timeout * 1000);
        signal?.addEventListener('abort', onAbort, { once: true });
        worker.listen(
          data => {
            const msg = jqResponseSchema.safeParse(data);
            if (done || !msg.success || msg.data.id !== id) return;
            finish(true);
            if (msg.data.ok) resolve(msg.data.stdout);
            else reject(new Error(msg.data.error));
          },
          message => {
            if (done) return;
            finish(false);
            reject(new Error(message || 'The jq worker failed'));
          },
        );
        worker.post({ id, input, filter, flags: jqFlags(options) });
      });
    },
  };
}
