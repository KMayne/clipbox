import type loadWabt from 'wabt';
import { z } from 'zod';
import { abortError } from '../../core/progress';
import type { WabtService, WatOptions } from './service';

export type Wabt = Awaited<ReturnType<typeof loadWabt>>;

/**
 * Every feature wabt 1.0.39 knows, so modern modules (SIMD, threads, GC, memory64, exceptions…)
 * read. `multi_memory` isn't in wabt's typings but is in its feature list.
 */
const ALL_FEATURES = {
  exceptions: true,
  mutable_globals: true,
  sat_float_to_int: true,
  sign_extension: true,
  simd: true,
  threads: true,
  function_references: true,
  multi_value: true,
  tail_call: true,
  bulk_memory: true,
  reference_types: true,
  annotations: true,
  code_metadata: true,
  gc: true,
  memory64: true,
  multi_memory: true,
  extended_const: true,
  relaxed_simd: true,
};

/** wabt's error report on one line: "readWasm failed:\n000000a: error: …" → "0x0a: …". */
export const wabtMessage = (message: string) =>
  message
    .replace(/^readWasm failed:\s*/, '')
    .split('\n')
    .map(line => line.trim().replace(/^0*([0-9a-f]+): error: /i, '0x$1: '))
    .filter(Boolean)
    .join(' · ') || 'wabt could not read the module';

/** Reads `bytes` and prints them as WAT; frees wabt's copy of the module either way. */
export function disassemble(wabt: Wabt, bytes: Uint8Array, options: WatOptions): string {
  const module = wabt.readWasm(bytes, { readDebugNames: true, ...ALL_FEATURES });
  try {
    module.applyNames();
    return module.toText({ foldExprs: options.foldExprs, inlineExport: options.inlineExport });
  } finally {
    module.destroy();
  }
}

// The runner's protocol: one request in, one response out, matched by id

export const wabtRequestSchema = z.object({
  id: z.number(),
  bytes: z.instanceof(Uint8Array),
  foldExprs: z.boolean(),
  inlineExport: z.boolean(),
});
export type WabtRequest = z.infer<typeof wabtRequestSchema>;

export const wabtResponseSchema = z.union([
  z.object({ id: z.number(), ok: z.literal(true), text: z.string() }),
  z.object({ id: z.number(), ok: z.literal(false), error: z.string() }),
]);
export type WabtResponse = z.infer<typeof wabtResponseSchema>;

/** The runner worker's side: answers requests with a lazily-loaded wabt (loaded once per worker). */
export function createWabtRunner(
  load: () => Promise<Wabt>,
): (msg: unknown) => Promise<WabtResponse> {
  let wabt: Promise<Wabt> | null = null;
  const get = () =>
    (wabt ??= load().catch((err: unknown) => {
      wabt = null; // allow a retry
      throw err;
    }));
  return async msg => {
    const parsed = wabtRequestSchema.safeParse(msg);
    if (!parsed.success) return { id: -1, ok: false, error: 'Bad wabt request' };
    const { id, bytes, foldExprs, inlineExport } = parsed.data;
    try {
      return { id, ok: true, text: disassemble(await get(), bytes, { foldExprs, inlineExport }) };
    } catch (err) {
      return {
        id,
        ok: false,
        error: wabtMessage(err instanceof Error ? err.message : String(err)),
      };
    }
  };
}

/** A runner worker, as the service sees it (a real Worker, or a fake in tests). */
export interface WabtWorker {
  post(request: WabtRequest): void;
  /** Sets the handlers for the worker's messages and its load or uncaught errors. */
  listen(onMessage: (data: unknown) => void, onError: (message: string) => void): void;
  terminate(): void;
}

const ignore = () => {};

/**
 * A wabt service that runs each disassembly in a runner worker from `spawn`, as the jq module
 * does: one idle worker is kept warm for the next run, and a run that's cancelled or crashes has
 * its worker terminated (which also frees wabt's memory).
 */
export function createWabtService(spawn: () => WabtWorker): WabtService {
  let idle: WabtWorker | null = null;
  let nextId = 1;
  return {
    toWat(bytes, options, { signal } = {}) {
      if (signal?.aborted) return Promise.reject(abortError());
      const worker = idle ?? spawn();
      idle = null;
      const id = nextId++;
      return new Promise<string>((resolve, reject) => {
        let done = false;
        const finish = (reusable: boolean) => {
          done = true;
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
        signal?.addEventListener('abort', onAbort, { once: true });
        worker.listen(
          data => {
            const msg = wabtResponseSchema.safeParse(data);
            if (done || !msg.success || msg.data.id !== id) return;
            finish(true);
            if (msg.data.ok) resolve(msg.data.text);
            else reject(new Error(msg.data.error));
          },
          message => {
            if (done) return;
            finish(false);
            reject(new Error(message || 'The wabt worker failed'));
          },
        );
        worker.post({ id, bytes, ...options });
      });
    },
  };
}
