/**
 * Progress and cancellation for long-running work in the engine worker (actions, derivations).
 * Pure: no worker or DOM APIs beyond AbortSignal, DOMException and timers.
 */
import { isRecord } from './guards';

/** What long-running work gets from the engine: a cancel signal and a progress reporter. */
export interface TaskContext {
  /**
   * Aborted when the user cancels, or the source entry is removed. Check it in long loops
   * (`checkpoint` does, and yields so the cancel message can arrive).
   */
  signal: AbortSignal;
  /**
   * Reports progress: `fraction` from 0 to 1, or undefined when it can't be known (an
   * indeterminate bar). `message` says what's happening, e.g. "Page 3 of 12". The engine
   * throttles reports, so calling it once per loop iteration is fine.
   */
  progress(fraction: number | undefined, message?: string): void;
}

/** One progress report, as sent from the worker to the UI. */
export interface ProgressReport {
  fraction?: number;
  message?: string;
}

/** A context for work nobody watches or cancels (tests, internal callers). */
export const noTask = (): TaskContext => ({
  signal: new AbortController().signal,
  progress: () => {},
});

/** What a cancelled run rejects with. Survives Comlink as an Error named 'AbortError'. */
export const abortError = () => new DOMException('Cancelled', 'AbortError');

export const isAbortError = (err: unknown): boolean =>
  (err instanceof Error || isRecord(err)) && err.name === 'AbortError';

/** Keeps `fraction` in 0..1 (undefined when it isn't a finite number) and messages short. */
export function cleanReport(fraction: number | undefined, message?: string): ProgressReport {
  const f =
    typeof fraction === 'number' && Number.isFinite(fraction)
      ? Math.min(1, Math.max(0, fraction))
      : undefined;
  const m = message ? message.slice(0, 200) : undefined;
  return { ...(f !== undefined && { fraction: f }), ...(m && { message: m }) };
}

export interface Throttle {
  report(fraction: number | undefined, message?: string): void;
  /** Sends a held-back report now (the run's final state). */
  flush(): void;
  /** Drops any held-back report and stops the timer. */
  dispose(): void;
}

/**
 * Passes at most one report per `interval` ms to `send`. The first goes at once; later ones
 * within the interval are held back (only the latest is kept) and sent when it ends, so the last
 * report always arrives.
 */
export function throttle(
  send: (report: ProgressReport) => void,
  interval = 100,
  now: () => number = Date.now,
): Throttle {
  let last = -Infinity;
  let pending: ProgressReport | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const fire = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (!pending) return;
    const report = pending;
    pending = null;
    last = now();
    send(report);
  };
  return {
    report(fraction, message) {
      pending = cleanReport(fraction, message);
      const wait = last + interval - now();
      if (wait <= 0) fire();
      else timer ??= setTimeout(fire, wait);
    },
    flush: fire,
    dispose() {
      pending = null;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}

/** Rejects with an AbortError as soon as `signal` aborts, whatever `promise` does. */
export function raceAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    promise.catch(() => {}); // settles later; nobody's listening
    return Promise.reject(abortError());
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(abortError());
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

const YIELD_EVERY = 50;
let lastYield = 0;

/**
 * For long synchronous loops: throws an AbortError once `signal` aborts, and every ~50 ms yields
 * to the worker's event loop so a Cancel (and progress messages) can get through. Cheap enough to
 * call on every iteration.
 */
export async function checkpoint(signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw abortError();
  const t = Date.now();
  if (t - lastYield < YIELD_EVERY) return;
  await new Promise(resolve => setTimeout(resolve, 0));
  lastYield = Date.now();
  if (signal.aborted) throw abortError();
}

/** Throws an AbortError if `signal` has aborted. For async loops that already yield. */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

/**
 * Calls `fn(i)` for each i below `n`. Every `every` items it reports `i / n` with `message` and
 * runs `checkpoint`, so long synchronous loops stay cancellable. Without `task` it's a plain loop.
 */
export async function loop(
  n: number,
  task: TaskContext | undefined,
  message: string,
  fn: (i: number) => void,
  every = 2048,
): Promise<void> {
  for (let i = 0; i < n; i++) {
    if (task && i % every === 0) {
      task.progress(i / n, message);
      await checkpoint(task.signal);
    }
    fn(i);
  }
}
