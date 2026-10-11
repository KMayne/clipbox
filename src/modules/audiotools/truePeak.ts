/**
 * True peak per BS.1770-4 Annex 2: the signal is 4× oversampled with a 48-tap interpolating
 * low-pass (12 taps per phase), and the peak is the largest absolute value of the oversampled
 * signal. Phase 0 of the windowed-sinc filter is the sample itself, so true peak ≥ sample peak.
 */
import { FloatLog } from './floatLog';

export const OVERSAMPLE = 4;
/** Taps per phase; the filter spans this many input samples. */
export const TAPS = 12;
const HALF = TAPS / 2;

/** Zeroth-order modified Bessel function of the first kind, for the Kaiser window. */
function bessel0(x: number): number {
  let sum = 1;
  let term = 1;
  for (let k = 1; k < 50; k++) {
    term *= (x / (2 * k)) ** 2;
    sum += term;
    if (term < 1e-12 * sum) break;
  }
  return sum;
}

const BETA = 5.5;

/**
 * Coefficients for phases 1..3: entry [p-1][j] weights input sample m + j - HALF + 1 for the
 * output at m + p/4. Each phase is normalised to unit DC gain.
 */
export const PHASE_COEFFS: Float64Array[] = Array.from({ length: OVERSAMPLE - 1 }, (_, i) => {
  const frac = (i + 1) / OVERSAMPLE;
  const taps = new Float64Array(TAPS);
  for (let j = 0; j < TAPS; j++) {
    const u = j - HALF + 1 - frac; // distance from the output position, in input samples
    const sinc = Math.sin(Math.PI * u) / (Math.PI * u);
    const r = u / HALF;
    const window = Math.abs(r) <= 1 ? bessel0(BETA * Math.sqrt(1 - r * r)) / bessel0(BETA) : 0;
    taps[j] = sinc * window;
  }
  const sum = taps.reduce((a, b) => a + b, 0);
  return taps.map(t => t / sum);
});

export const toDb = (linear: number) => (linear > 0 ? 20 * Math.log10(linear) : -Infinity);
export const fromDb = (db: number) => 10 ** (db / 20);

/**
 * Streaming true-peak meter. Optionally logs the peak of each `subFrames`-frame span (across
 * channels), which the limiter uses. Call `flush()` after the last push.
 */
export class TruePeakMeter {
  /** Last TAPS - 1 input samples per channel. */
  private readonly history: Float32Array[];
  private readonly log: FloatLog | null;
  private frame = 0;
  private peak = 0;
  private samplePeak = 0;

  constructor(
    readonly channels: number,
    readonly subFrames?: number,
  ) {
    this.history = Array.from({ length: channels }, () => new Float32Array(TAPS - 1));
    this.log = subFrames ? new FloatLog() : null;
  }

  push(planes: Float32Array[]): void {
    const length = planes[0]?.length ?? 0;
    if (!length) return;
    for (let c = 0; c < this.channels; c++) {
      const hist = this.history[c];
      if (!hist) continue;
      const plane = planes[c] ?? new Float32Array(length);
      const work = new Float32Array(hist.length + length);
      work.set(hist);
      work.set(plane, hist.length);
      this.scan(work, this.frame - hist.length);
      hist.set(work.subarray(work.length - hist.length));
    }
    this.frame += length;
  }

  /** Feeds silence so the interpolation reaches the last real samples. */
  flush(): void {
    const frame = this.frame;
    this.push(Array.from({ length: this.channels }, () => new Float32Array(HALF)));
    this.frame = frame;
  }

  /** Linear true peak so far. */
  get truePeak(): number {
    return this.peak;
  }

  get samplePeakLinear(): number {
    return this.samplePeak;
  }

  /** Peak per sub-block (linear, max over channels). */
  subBlockPeaks(): Float32Array {
    return this.log?.toArray() ?? new Float32Array(0);
  }

  /**
   * `work[k]` is the sample at absolute frame `first + k`. Output positions m + p/4 need samples
   * m - HALF + 1 … m + HALF, so m runs from the HALF-1'th sample to the HALF'th from last.
   */
  private scan(work: Float32Array, first: number): void {
    const [c1, c2, c3] = PHASE_COEFFS;
    if (!c1 || !c2 || !c3) return;
    for (let k = HALF - 1; k + HALF < work.length; k++) {
      const m = first + k;
      if (m < 0) continue; // the zeros before the first sample
      const s = Math.abs(work[k] ?? 0);
      let p1 = 0;
      let p2 = 0;
      let p3 = 0;
      const base = k - HALF + 1;
      for (let j = 0; j < TAPS; j++) {
        const x = work[base + j] ?? 0;
        p1 += (c1[j] ?? 0) * x;
        p2 += (c2[j] ?? 0) * x;
        p3 += (c3[j] ?? 0) * x;
      }
      const v = Math.max(s, Math.abs(p1), Math.abs(p2), Math.abs(p3));
      if (s > this.samplePeak) this.samplePeak = s;
      if (v > this.peak) this.peak = v;
      if (this.log && this.subFrames) this.log.max(Math.floor(m / this.subFrames), v);
    }
  }
}
