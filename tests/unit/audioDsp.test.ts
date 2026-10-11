import { describe, expect, it } from 'vitest';
import {
  GainCurve,
  limiterEnvelope,
  planGain,
  planLimited,
} from '../../src/modules/audiotools/limiter';
import {
  integratedLoudness,
  kWeighting,
  LoudnessMeter,
  subBlockFrames,
} from '../../src/modules/audiotools/loudness';
import { TruePeakMeter, fromDb, toDb } from '../../src/modules/audiotools/truePeak';

/** A sine segment: [dBFS amplitude (peak), seconds]. */
type Segment = [number, number];

function sine(rate: number, segments: Segment[], freq = 1000, phase = 0): Float32Array {
  const total = segments.reduce((n, [, s]) => n + Math.round(s * rate), 0);
  const out = new Float32Array(total);
  let i = 0;
  for (const [db, seconds] of segments) {
    const amp = Number.isFinite(db) ? fromDb(db) : 0;
    const end = i + Math.round(seconds * rate);
    for (; i < end; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / rate + phase);
  }
  return out;
}

/** Pushes in uneven chunks, to exercise the streaming state. */
function chunks(planes: Float32Array[], each: (p: Float32Array[]) => void) {
  const length = planes[0]?.length ?? 0;
  const sizes = [1000, 4096, 17, 333];
  for (let pos = 0, k = 0; pos < length; k++) {
    const n = Math.min(length - pos, sizes[k % sizes.length] ?? 1024);
    each(planes.map(p => p.subarray(pos, pos + n)));
    pos += n;
  }
}

function loudness(planes: Float32Array[], rate: number): number {
  const meter = new LoudnessMeter(rate, planes.length);
  chunks(planes, p => meter.push(p));
  return meter.integrated();
}

function truePeak(planes: Float32Array[]) {
  const meter = new TruePeakMeter(planes.length);
  chunks(planes, p => meter.push(p));
  meter.flush();
  return { truePeak: toDb(meter.truePeak), samplePeak: toDb(meter.samplePeakLinear) };
}

describe('K-weighting', () => {
  it('matches the BS.1770-4 coefficients at 48 kHz', () => {
    const [shelf, hp] = kWeighting(48000);
    expect(shelf.b0).toBeCloseTo(1.53512485958697, 6);
    expect(shelf.b1).toBeCloseTo(-2.69169618940638, 6);
    expect(shelf.b2).toBeCloseTo(1.19839281085285, 6);
    expect(shelf.a1).toBeCloseTo(-1.69065929318241, 6);
    expect(shelf.a2).toBeCloseTo(0.73248077421585, 6);
    expect(hp.a1).toBeCloseTo(-1.99004745483398, 6);
    expect(hp.a2).toBeCloseTo(0.99007225036621, 6);
  });

  it('picks sub-blocks that divide the 100 ms hop', () => {
    expect(subBlockFrames(48000)).toBe(64);
    expect(subBlockFrames(44100)).toBe(63);
    expect(4410 % subBlockFrames(44100)).toBe(0);
    expect(subBlockFrames(11025)).toBe(64);
  });
});

describe('integrated loudness', () => {
  it('measures a 1 kHz sine at -20 dBFS as about -23 LUFS mono and -20 LUFS stereo', () => {
    for (const rate of [48000, 44100]) {
      const s = sine(rate, [[-20, 5]]);
      expect(loudness([s], rate)).toBeCloseTo(-23.0, 1);
      expect(loudness([s, s], rate)).toBeCloseTo(-20.0, 1);
    }
  });

  // EBU Tech 3341 (v4) minimum-requirement cases 1-6; expected -23.0 ±0.1 LUFS (case 2: -33.0)
  const stereo = (segments: Segment[]) => {
    const s = sine(48000, segments);
    return loudness([s, s], 48000);
  };

  it('EBU 3341 case 1: stereo 1 kHz at -23 dBFS for 20 s', () => {
    expect(Math.abs(stereo([[-23, 20]]) + 23)).toBeLessThanOrEqual(0.1);
  });

  it('EBU 3341 case 2: stereo 1 kHz at -33 dBFS for 20 s', () => {
    expect(Math.abs(stereo([[-33, 20]]) + 33)).toBeLessThanOrEqual(0.1);
  });

  it('EBU 3341 case 3: the relative gate drops the -36 dBFS parts', () => {
    const l = stereo([
      [-36, 10],
      [-23, 60],
      [-36, 10],
    ]);
    expect(Math.abs(l + 23)).toBeLessThanOrEqual(0.1);
  });

  it('EBU 3341 case 4: absolute and relative gates together', () => {
    const l = stereo([
      [-72, 10],
      [-36, 10],
      [-23, 60],
      [-36, 10],
      [-72, 10],
    ]);
    expect(Math.abs(l + 23)).toBeLessThanOrEqual(0.1);
  });

  it('EBU 3341 case 5: -26, -20, -26 dBFS', () => {
    const l = stereo([
      [-26, 20],
      [-20, 20.1],
      [-26, 20],
    ]);
    expect(Math.abs(l + 23)).toBeLessThanOrEqual(0.1);
  });

  it('EBU 3341 case 6: 5.0 channels with surround weighting', () => {
    const rate = 48000;
    const at = (db: number) => sine(rate, [[db, 20]]);
    // L, R, C, Ls, Rs
    const l = loudness([at(-28), at(-28), at(-24), at(-30), at(-30)], rate);
    expect(Math.abs(l + 23)).toBeLessThanOrEqual(0.1);
  });

  it('excludes LFE in 5.1', () => {
    const rate = 48000;
    const s = sine(rate, [[-23, 5]]);
    const silent = new Float32Array(s.length);
    const loud = sine(rate, [[0, 5]]);
    const withLfe = loudness([s, s, silent, loud, silent, silent], rate);
    const withoutLfe = loudness([s, s, silent, silent, silent, silent], rate);
    expect(withLfe).toBeCloseTo(withoutLfe, 5);
  });

  it('is -Infinity for silence, audio below the absolute gate, or under 400 ms', () => {
    const rate = 48000;
    expect(loudness([new Float32Array(rate * 2)], rate)).toBe(-Infinity);
    expect(loudness([sine(rate, [[-75, 3]])], rate)).toBe(-Infinity);
    expect(loudness([sine(rate, [[-20, 0.39]])], rate)).toBe(-Infinity);
    expect(loudness([sine(rate, [[-20, 0.41]])], rate)).toBeCloseTo(-23, 0);
  });

  it('applies a per-sub-block scale when predicting', () => {
    const rate = 48000;
    const meter = new LoudnessMeter(rate, 1);
    meter.push([sine(rate, [[-20, 5]])]);
    const blocks = meter.subBlocks();
    const half = fromDb(-6);
    expect(integratedLoudness(blocks, () => half)).toBeCloseTo(meter.integrated() - 6, 5);
  });
});

describe('true peak', () => {
  it('finds the inter-sample peak of an fs/4 sine sampled at ±45°', () => {
    // Samples land at ±0.707; the waveform peaks at 1.0 halfway between them
    const s = sine(48000, [[0, 1]], 12000, Math.PI / 4);
    const { truePeak: tp, samplePeak } = truePeak([s]);
    expect(samplePeak).toBeCloseTo(-3.01, 1);
    expect(tp).toBeGreaterThan(-0.2);
    expect(tp).toBeLessThan(0.2);
  });

  it('reads a 1 kHz sine at its amplitude, and never below the sample peak', () => {
    const s = sine(48000, [[-6, 1]], 997, 0.3);
    const { truePeak: tp, samplePeak } = truePeak([s, new Float32Array(s.length)]);
    expect(tp).toBeCloseTo(-6, 1);
    expect(tp).toBeGreaterThanOrEqual(samplePeak);
  });

  it('logs per-sub-block peaks, including the last samples', () => {
    const s = new Float32Array(1000);
    s[999] = 0.5;
    s[10] = 0.25;
    const meter = new TruePeakMeter(1, 100);
    meter.push([s.subarray(0, 600)]);
    meter.push([s.subarray(600)]);
    meter.flush();
    const peaks = meter.subBlockPeaks();
    expect(peaks.length).toBe(10);
    expect(peaks[0]).toBeCloseTo(0.25, 3);
    expect(peaks[9]).toBeCloseTo(0.5, 3);
    expect(peaks[5]).toBe(0);
  });
});

describe('gain planning', () => {
  it('reaches the target when there is headroom', () => {
    expect(
      planGain({ integrated: -23, truePeakDb: -20, target: -14, ceiling: -1, limit: false }),
    ).toEqual({ gainDb: 9, capped: false, wantedDb: 9 });
  });

  it('caps the gain at the true-peak ceiling without the limiter', () => {
    const plan = planGain({
      integrated: -23,
      truePeakDb: -6,
      target: -14,
      ceiling: -1,
      limit: false,
    });
    expect(plan).toEqual({ gainDb: 5, capped: true, wantedDb: 9 });
  });

  it('keeps the full gain with the limiter, and also turns quiet-down into plain gain', () => {
    expect(
      planGain({ integrated: -23, truePeakDb: -6, target: -14, ceiling: -1, limit: true }).gainDb,
    ).toBe(9);
    expect(
      planGain({ integrated: -8, truePeakDb: 0, target: -14, ceiling: -1, limit: false }),
    ).toEqual({ gainDb: -6, capped: false, wantedDb: -6 });
  });

  it('refuses silence', () => {
    expect(() =>
      planGain({
        integrated: -Infinity,
        truePeakDb: -Infinity,
        target: -14,
        ceiling: -1,
        limit: false,
      }),
    ).toThrow(/too quiet/i);
  });
});

describe('limiter', () => {
  /** Quiet music-like bed with loud transients: needs limiting to reach -14 LUFS. */
  function spiky(rate: number, seconds: number): Float32Array {
    const out = new Float32Array(rate * seconds);
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    for (let i = 0; i < out.length; i++) {
      const t = i / rate;
      const bed = 0.1 * Math.sin(2 * Math.PI * 220 * t) + 0.02 * rand();
      // A 5 ms burst every second, near full scale
      const burst = t % 1 < 0.005 ? 0.9 * Math.sin(2 * Math.PI * 3000 * t) : 0;
      out[i] = bed + burst;
    }
    return out;
  }

  it('never lets the envelope exceed what each sub-block needs', () => {
    const peaks = new Float32Array([0.1, 0.1, 0.9, 0.1, 0.1, 0.1, 1.0, 0.2, 0.1, 0.1]);
    const env = limiterEnvelope(peaks, 4, -1, 0.002, { attackMs: 6, marginDb: 0 });
    const ceiling = fromDb(-1);
    for (let i = 0; i < peaks.length; i++) {
      const p = Math.max(peaks[i - 1] ?? 0, peaks[i] ?? 0, peaks[i + 1] ?? 0);
      expect((env[i] ?? 1) * 4 * p).toBeLessThanOrEqual(ceiling + 1e-6);
      expect(env[i]).toBeLessThanOrEqual(1);
    }
    // It ramps down ahead of the first peak rather than jumping
    expect(env[0]).toBeLessThan(1);
  });

  it('reaches the target without the true peak going over the ceiling', () => {
    const rate = 48000;
    const signal = spiky(rate, 6);
    const planes = [signal, signal.slice()];
    const meter = new LoudnessMeter(rate, 2);
    const peaks = new TruePeakMeter(2, meter.frames);
    chunks(planes, p => {
      meter.push(p);
      peaks.push(p);
    });
    peaks.flush();
    const before = meter.integrated();
    const target = -14;
    const ceiling = -1;
    // Plain gain would clip by many dB
    expect(toDb(peaks.truePeak) + target - before).toBeGreaterThan(3);

    const plan = planLimited({
      blocks: meter.subBlocks(),
      peaks: peaks.subBlockPeaks(),
      integrated: before,
      target,
      ceiling,
    });
    const curve = new GainCurve(plan.gainDb, plan.envelope, rate / meter.frames);
    const out = planes.map(p => p.slice());
    let seconds = 0;
    chunks(out, p => {
      curve.apply(p, seconds, rate);
      seconds += (p[0]?.length ?? 0) / rate;
    });
    expect(Math.abs(loudness(out, rate) - target)).toBeLessThan(0.5);
    expect(truePeak(out).truePeak).toBeLessThanOrEqual(ceiling + 0.05);
  });

  it('applies a plain constant gain without an envelope', () => {
    const plane = new Float32Array([0.5, -0.25]);
    new GainCurve(6.0206, null, 1).apply([plane], 0, 48000);
    expect(plane[0]).toBeCloseTo(1, 3);
    expect(plane[1]).toBeCloseTo(-0.5, 3);
  });
});
