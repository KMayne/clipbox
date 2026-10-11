/**
 * Integrated loudness per ITU-R BS.1770-4 / EBU R128: K-weighting, 400 ms blocks with 75% overlap,
 * an absolute gate at -70 LUFS and a relative gate 10 LU below the ungated mean.
 *
 * The meter streams: it keeps the K-weighted, channel-weighted energy of short sub-blocks (about
 * 1-2 ms, dividing the 100 ms hop exactly at common rates), which is all the gating needs, and which
 * the limiter reuses to predict loudness after gain changes without decoding again.
 */
import { FloatLog } from './floatLog';

export interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/**
 * The two K-weighting stages (high-shelf "pre-filter" and RLB high-pass) for any sample rate,
 * derived from the analogue prototypes as libebur128 does. At 48 kHz they match BS.1770's tables.
 */
export function kWeighting(sampleRate: number): [Biquad, Biquad] {
  let f0 = 1681.974450955533;
  const gainDb = 3.999843853973347;
  let q = 0.7071752369554196;
  let k = Math.tan((Math.PI * f0) / sampleRate);
  const vh = 10 ** (gainDb / 20);
  const vb = vh ** 0.4996667741545416;
  let a0 = 1 + k / q + k * k;
  const shelf: Biquad = {
    b0: (vh + (vb * k) / q + k * k) / a0,
    b1: (2 * (k * k - vh)) / a0,
    b2: (vh - (vb * k) / q + k * k) / a0,
    a1: (2 * (k * k - 1)) / a0,
    a2: (1 - k / q + k * k) / a0,
  };
  f0 = 38.13547087602444;
  q = 0.5003270373238773;
  k = Math.tan((Math.PI * f0) / sampleRate);
  a0 = 1 + k / q + k * k;
  const highpass: Biquad = {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (k * k - 1)) / a0,
    a2: (1 - k / q + k * k) / a0,
  };
  return [shelf, highpass];
}

/**
 * BS.1770 channel weights: 1.0 for front channels, 1.41 (+1.5 dB) for surrounds, LFE excluded.
 * 5 channels are taken as L R C Ls Rs and 6 as L R C LFE Ls Rs (the WebCodecs/WAV order).
 */
export function channelWeights(channels: number): number[] {
  if (channels === 5) return [1, 1, 1, 1.41, 1.41];
  if (channels === 6) return [1, 1, 1, 0, 1.41, 1.41];
  return Array.from({ length: channels }, () => 1);
}

/**
 * Frames per sub-block: the largest divisor of the 100 ms hop that's at most 64 frames, so gating
 * blocks are whole numbers of sub-blocks. Rates whose hop isn't a whole frame count (e.g. 11025 Hz)
 * get 64-frame sub-blocks and blocks rounded to the nearest sub-block.
 */
export function subBlockFrames(sampleRate: number): number {
  const hop = sampleRate / 10;
  if (!Number.isInteger(hop)) return 64;
  for (let d = Math.ceil(hop / 64); d <= hop; d++) if (hop % d === 0) return hop / d;
  return 1;
}

export const energyToLufs = (meanSquare: number) =>
  meanSquare > 0 ? -0.691 + 10 * Math.log10(meanSquare) : -Infinity;

export const ABSOLUTE_GATE = -70;
export const RELATIVE_GATE = -10;

export interface SubBlocks {
  sampleRate: number;
  /** Frames per sub-block. */
  frames: number;
  /** Per sub-block: Σ over frames and channels of weight × (K-weighted sample)². */
  energies: Float32Array;
}

/**
 * Gated integrated loudness from sub-block energies. `scale(i)`, if given, is a gain (linear
 * amplitude) applied to sub-block i, for predicting the effect of a gain envelope.
 */
export function integratedLoudness(blocks: SubBlocks, scale?: (i: number) => number): number {
  const { energies, frames, sampleRate } = blocks;
  const perBlock = Math.max(1, Math.round((0.4 * sampleRate) / frames));
  const step = Math.max(1, Math.round((0.1 * sampleRate) / frames));
  const blockFrames = perBlock * frames;
  const powers: number[] = [];
  // Prefix sums keep this linear in the number of sub-blocks
  const prefix = new Float64Array(energies.length + 1);
  for (let i = 0; i < energies.length; i++) {
    const g = scale ? scale(i) : 1;
    prefix[i + 1] = (prefix[i] ?? 0) + (energies[i] ?? 0) * g * g;
  }
  for (let start = 0; start + perBlock <= energies.length; start += step) {
    powers.push(((prefix[start + perBlock] ?? 0) - (prefix[start] ?? 0)) / blockFrames);
  }
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const aboveAbsolute = powers.filter(z => energyToLufs(z) > ABSOLUTE_GATE);
  if (!aboveAbsolute.length) return -Infinity;
  const relative = energyToLufs(mean(aboveAbsolute)) + RELATIVE_GATE;
  const gated = aboveAbsolute.filter(z => energyToLufs(z) > relative);
  return gated.length ? energyToLufs(mean(gated)) : -Infinity;
}

/** Streaming K-weighted energy meter; push planar float32 channels in order. */
export class LoudnessMeter {
  readonly frames: number;
  private readonly weights: number[];
  private readonly filters: [Biquad, Biquad];
  /** Per channel: x1, x2, y1, y2 of stage 1, then y1, y2 of stage 2 (its input is stage 1's output). */
  private readonly state: Float64Array[];
  private readonly log = new FloatLog();
  private acc = 0;
  private inBlock = 0;

  constructor(
    readonly sampleRate: number,
    readonly channels: number,
  ) {
    this.frames = subBlockFrames(sampleRate);
    this.weights = channelWeights(channels);
    this.filters = kWeighting(sampleRate);
    this.state = Array.from({ length: channels }, () => new Float64Array(8));
  }

  push(planes: Float32Array[]): void {
    const length = planes[0]?.length ?? 0;
    const [s1, s2] = this.filters;
    let pos = 0;
    while (pos < length) {
      const n = Math.min(length - pos, this.frames - this.inBlock);
      for (let c = 0; c < this.channels; c++) {
        const w = this.weights[c] ?? 1;
        const plane = planes[c];
        const st = this.state[c];
        if (!plane || !st || w === 0) continue;
        let [x1, x2, y1, y2, z1, z2] = [
          st[0] ?? 0,
          st[1] ?? 0,
          st[2] ?? 0,
          st[3] ?? 0,
          st[4] ?? 0,
          st[5] ?? 0,
        ];
        let sum = 0;
        for (let i = pos; i < pos + n; i++) {
          const x = plane[i] ?? 0;
          const y = s1.b0 * x + s1.b1 * x1 + s1.b2 * x2 - s1.a1 * y1 - s1.a2 * y2;
          x2 = x1;
          x1 = x;
          // Stage 2's inputs are stage 1's outputs (y1, y2 before this update)
          const z = s2.b0 * y + s2.b1 * y1 + s2.b2 * y2 - s2.a1 * z1 - s2.a2 * z2;
          y2 = y1;
          y1 = y;
          z2 = z1;
          z1 = z;
          sum += z * z;
        }
        st.set([x1, x2, y1, y2, z1, z2]);
        this.acc += w * sum;
      }
      pos += n;
      this.inBlock += n;
      if (this.inBlock === this.frames) {
        this.log.push(this.acc);
        this.acc = 0;
        this.inBlock = 0;
      }
    }
  }

  /** Complete sub-blocks so far (a partial last one is dropped, as BS.1770 drops partial blocks). */
  subBlocks(): SubBlocks {
    return { sampleRate: this.sampleRate, frames: this.frames, energies: this.log.toArray() };
  }

  integrated(): number {
    return integratedLoudness(this.subBlocks());
  }
}
