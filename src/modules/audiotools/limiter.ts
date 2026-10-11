/**
 * Gain planning for loudness normalisation, and an offline true-peak lookahead limiter.
 *
 * The limiter works on the sub-block grid the analysis pass recorded (true peak and K-weighted
 * energy per ~1.3 ms), so its gain envelope is known before the second pass starts: it looks ahead
 * by reading the whole envelope rather than by delaying the audio.
 */
import { integratedLoudness, type SubBlocks } from './loudness';
import { fromDb } from './truePeak';

export interface GainPlan {
  /** Constant gain in dB. */
  gainDb: number;
  /** The gain was lowered from `wantedDb` to keep the true peak under the ceiling. */
  capped: boolean;
  /** The gain the target needs. */
  wantedDb: number;
}

/**
 * The single gain for normalisation. Without the limiter, a gain that would push the true peak
 * over the ceiling is lowered to just reach it (the result is quieter than the target).
 */
export function planGain(opts: {
  integrated: number;
  truePeakDb: number;
  target: number;
  ceiling: number;
  limit: boolean;
}): GainPlan {
  const { integrated, truePeakDb, target, ceiling, limit } = opts;
  if (!Number.isFinite(integrated)) throw new Error('Too quiet to measure (silent?)');
  const wantedDb = target - integrated;
  if (limit || !Number.isFinite(truePeakDb)) return { gainDb: wantedDb, capped: false, wantedDb };
  const headroom = ceiling - truePeakDb;
  return headroom < wantedDb
    ? { gainDb: headroom, capped: true, wantedDb }
    : { gainDb: wantedDb, capped: false, wantedDb };
}

export interface LimiterOptions {
  /** Ramp-down time before a peak, in ms (the lookahead). */
  attackMs?: number;
  /** Time constant for recovering after a peak, in ms. */
  releaseMs?: number;
  /** Extra safety below the ceiling, in dB, for the gain changing within a sub-block. */
  marginDb?: number;
}

/**
 * Per-sub-block limiter gain (linear, ≤ 1) such that `gain × envelope × peak` stays under the
 * ceiling in every sub-block.
 *
 * 1. Required gain per sub-block, from the peaks of it and its neighbours (the interpolation filter
 *    and the per-frame ramps reach across sub-block edges).
 * 2. Minimum over the next A sub-blocks (A = attack), then a one-pole release, then a moving
 *    average over the previous A sub-blocks. Every value averaged at sub-block s is a minimum
 *    over a window containing s, so the average never exceeds the requirement at s: the ramp
 *    finishes exactly on the peak and never overshoots.
 */
export function limiterEnvelope(
  peaks: Float32Array,
  gain: number,
  ceiling: number,
  subSeconds: number,
  opts: LimiterOptions = {},
): Float32Array {
  const { attackMs = 5, releaseMs = 150, marginDb = 0.1 } = opts;
  const n = peaks.length;
  const limit = fromDb(ceiling - marginDb);
  const required = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = Math.max(peaks[i - 1] ?? 0, peaks[i] ?? 0, peaks[i + 1] ?? 0) * gain;
    required[i] = p > limit ? limit / p : 1;
  }
  const attack = Math.max(1, Math.round(attackMs / 1000 / subSeconds));

  // Sliding minimum over [i, i + attack) with a monotonic deque
  const mins = new Float32Array(n);
  const deque = new Int32Array(n + 1);
  let head = 0;
  let tail = 0;
  for (let i = n - 1; i >= 0; i--) {
    const v = required[i] ?? 1;
    while (tail > head && (required[deque[tail - 1] ?? 0] ?? 1) >= v) tail--;
    deque[tail++] = i;
    while ((deque[head] ?? 0) >= i + attack) head++;
    mins[i] = required[deque[head] ?? i] ?? 1;
  }

  // Release: rise towards the minimum with a time constant; drops follow immediately
  const coeff = Math.exp(-subSeconds / (releaseMs / 1000));
  let prev = 1;
  for (let i = 0; i < n; i++) {
    const m = mins[i] ?? 1;
    prev = m < prev ? m : prev + (m - prev) * (1 - coeff);
    mins[i] = prev;
  }

  // Moving average over (i - attack, i]; before the start the gain is 1 at most, so leaving those
  // terms out (averaging fewer values) keeps the bound
  const env = new Float32Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += mins[i] ?? 1;
    if (i >= attack) sum -= mins[i - attack] ?? 1;
    env[i] = sum / Math.min(i + 1, attack);
  }
  return env;
}

export interface LimitedPlan {
  gainDb: number;
  envelope: Float32Array;
  /** Predicted integrated loudness after gain and limiting. */
  predicted: number;
}

/**
 * Finds the gain that reaches `target` after limiting: limiting lowers loudness, so the gain is
 * raised and the envelope recomputed until the predicted loudness (from the recorded sub-block
 * energies) is within 0.01 LU. The gain is capped at 12 dB above the plain gain.
 */
export function planLimited(opts: {
  blocks: SubBlocks;
  peaks: Float32Array;
  integrated: number;
  target: number;
  ceiling: number;
  limiter?: LimiterOptions;
}): LimitedPlan {
  const { blocks, peaks, integrated, target, ceiling, limiter } = opts;
  const subSeconds = blocks.frames / blocks.sampleRate;
  const base = target - integrated;
  const attempt = (gainDb: number): LimitedPlan => {
    const g = fromDb(gainDb);
    const envelope = limiterEnvelope(peaks, g, ceiling, subSeconds, limiter);
    const predicted = integratedLoudness(blocks, i => g * (envelope[i] ?? 1));
    return { gainDb, envelope, predicted };
  };
  let plan = attempt(base);
  for (let iter = 0; iter < 8; iter++) {
    const error = target - plan.predicted;
    if (Math.abs(error) < 0.01 || !Number.isFinite(error)) break;
    const next = Math.min(base + 12, plan.gainDb + error);
    if (next === plan.gainDb) break;
    plan = attempt(next);
  }
  return plan;
}

/**
 * Applies a constant gain times an optional limiter envelope to planar audio. Positions come from
 * timestamps (seconds × sub-blocks per second), so this still lines up if the encoder path resamples.
 * Within a sub-block the envelope ramps linearly between the lower of it and each neighbour, so
 * it never exceeds the sub-block's own value.
 */
export class GainCurve {
  private readonly gain: number;

  constructor(
    gainDb: number,
    private readonly envelope: Float32Array | null,
    /** Sub-blocks per second of the envelope. */
    private readonly envelopeRate: number,
  ) {
    this.gain = fromDb(gainDb);
  }

  /** Envelope value at a position in sub-blocks. */
  at(position: number): number {
    const env = this.envelope;
    if (!env || !env.length) return 1;
    const s = Math.min(env.length - 1, Math.max(0, Math.floor(position)));
    const here = env[s] ?? 1;
    const from = Math.min(env[s - 1] ?? here, here);
    const to = Math.min(env[s + 1] ?? here, here);
    const t = Math.min(1, Math.max(0, position - s));
    return from + (to - from) * t;
  }

  /** Scales `planes` in place; `seconds` is the chunk's offset from the stream start. */
  apply(planes: Float32Array[], seconds: number, sampleRate: number): void {
    const length = planes[0]?.length ?? 0;
    if (!this.envelope) {
      for (const plane of planes)
        for (let i = 0; i < plane.length; i++) plane[i] = (plane[i] ?? 0) * this.gain;
      return;
    }
    const perFrame = this.envelopeRate / sampleRate;
    const start = seconds * this.envelopeRate;
    for (let i = 0; i < length; i++) {
      const g = this.gain * this.at(start + i * perFrame);
      for (const plane of planes) plane[i] = (plane[i] ?? 0) * g;
    }
  }
}
