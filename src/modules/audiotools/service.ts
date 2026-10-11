/**
 * The audiotools module's service interface. No imports beyond guards: core action code imports
 * this to type and check the service without bundling the module.
 */
import { isRecord } from '../../core/guards';

export interface NormaliseOptions {
  /** Target integrated loudness, LUFS. */
  target: number;
  /** True-peak ceiling, dBTP. */
  ceiling: number;
  /** Use the lookahead limiter instead of capping the gain. */
  limit: boolean;
  signal?: AbortSignal;
}

export interface LoudnessReading {
  /** Integrated loudness, LUFS. */
  integrated: number;
  /** True peak, dBTP. */
  truePeak: number;
}

export interface NormaliseResult {
  bytes: Uint8Array<ArrayBuffer>;
  mime: string;
  /** File extension for the output, without the dot. */
  extension: string;
  /** Whether the output keeps the input's container. */
  sameContainer: boolean;
  /** Audio codec of the output, e.g. 'opus', 'pcm-s16'. */
  codec: string;
  hasVideo: boolean;
  before: LoudnessReading;
  /** Measured on the processed audio before encoding. */
  after: LoudnessReading;
  /** Constant gain applied, dB (before any limiting). */
  gainDb: number;
  /** The gain was lowered to stay under the ceiling, so the output is quieter than the target. */
  capped: boolean;
  /** The limiter reduced peaks. */
  limited: boolean;
}

export interface AudioTools {
  normalise(bytes: Uint8Array<ArrayBuffer>, options: NormaliseOptions): Promise<NormaliseResult>;
}

export const isAudioTools = (s: unknown): s is AudioTools =>
  isRecord(s) && typeof s.normalise === 'function';
