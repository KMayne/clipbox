/**
 * Deep recursion without the call stack. A recursive function becomes a generator that, instead
 * of calling itself, writes `yield* call(f(child))`; `trampoline` runs the generators off an
 * explicit stack, so nesting depth is bounded by memory, not by the engine's stack size (which
 * overflows around 10k frames).
 *
 * Plain `yield* g()` (without `call`) is still fine for helpers, as long as every cycle of the
 * recursion goes through a `call`: each `yield*` adds a generator that every resume passes
 * through, so only a constant number may be stacked between two `call`s.
 */

/** A sub-call for `trampoline` to run, with where to put its result. */
export interface Frame {
  step: Step<unknown>;
  box: { result?: { value: unknown } };
}

/** A trampolined computation that results in a T. */
export type Step<T> = Generator<Frame, T, void>;

/** Runs `step` as a sub-call: inside a Step, `const x = yield* call(f(…))`. */
export function* call<T>(step: Step<T>): Step<T> {
  const box: { result?: { value: T } } = {};
  yield { step, box };
  if (!box.result) throw new Error('trampoline: sub-call did not finish');
  return box.result.value;
}

/** Runs `step` to completion with an explicit stack of frames. */
export function trampoline<T>(step: Step<T>): T {
  const box: { result?: { value: T } } = {};
  const stack: Frame[] = [{ step, box }];
  for (let top = stack.at(-1); top; top = stack.at(-1)) {
    const r = top.step.next();
    if (r.done) {
      top.box.result = { value: r.value };
      stack.pop();
    } else {
      stack.push(r.value);
    }
  }
  if (!box.result) throw new Error('trampoline: computation did not finish');
  return box.result.value;
}
