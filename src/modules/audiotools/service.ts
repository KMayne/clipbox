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
  /** Aborting stops at the next decoded chunk, rejecting with an AbortError. */
  signal?: AbortSignal;
  /** Per pass: decoded time over the duration (`TaskContext.progress`). */
  progress?(fraction: number | undefined, message?: string): void;
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

// --- Video frames ("Video frame as PNG") ---

export interface FrameOptions {
  /** Seconds from the start of the media, or a fraction (0–1) of the way through. */
  at: { seconds: number } | { fraction: number };
  signal?: AbortSignal;
  progress?(fraction: number | undefined, message?: string): void;
}

export interface FrameResult {
  /** PNG, at the video's display size. */
  bytes: Uint8Array<ArrayBuffer>;
  width: number;
  height: number;
  /** The decoded frame's presentation time, seconds. */
  timestamp: number;
}

export interface VideoFrameTool {
  videoFrame(bytes: Uint8Array<ArrayBuffer>, options: FrameOptions): Promise<FrameResult>;
}

export const isVideoFrameTool = (s: unknown): s is VideoFrameTool =>
  isRecord(s) && typeof s.videoFrame === 'function';

// --- Conversion ("Convert audio", "Extract audio track") ---

/** Output formats for "Convert audio": m4a is AAC in MP4, ogg and webm are Opus. */
export const CONVERT_FORMATS = ['mp3', 'm4a', 'ogg', 'webm', 'flac', 'wav'] as const;
export type ConvertFormat = (typeof CONVERT_FORMATS)[number];

/** Codecs an encoder module (`mp3encoder`, `aacencoder`) can add to Mediabunny. */
export type ExtensionCodec = 'mp3' | 'aac';

export interface ConvertOptions {
  format: ConvertFormat;
  /** Target bitrate for lossy formats, kbps; ignored for FLAC and WAV. */
  bitrate: number;
  /**
   * Registers an encoder for `codec` with Mediabunny when the browser has none (MP3 everywhere,
   * AAC on Linux). Resolves false when the encoder module can't load.
   */
  loadEncoder?(codec: ExtensionCodec): Promise<boolean>;
  /** Aborting cancels the conversion, rejecting with an AbortError. */
  signal?: AbortSignal;
  /** Encoded time over the duration (`TaskContext.progress`). */
  progress?(fraction: number | undefined, message?: string): void;
}

export interface ConvertResult {
  bytes: Uint8Array<ArrayBuffer>;
  mime: string;
  /** File extension for the output, without the dot. */
  extension: string;
  /** Audio codec of the output, e.g. 'mp3', 'pcm-s16'. */
  codec: string;
  /** The source already had this codec, so its packets were copied rather than re-encoded. */
  copied: boolean;
  /** What encoded the audio: WebCodecs, an encoder module, or nothing (copied). */
  encoder: 'native' | 'extension' | 'none';
}

export interface ExtractOptions {
  signal?: AbortSignal;
  progress?(fraction: number | undefined, message?: string): void;
}

export interface ExtractResult {
  bytes: Uint8Array<ArrayBuffer>;
  mime: string;
  /** File extension for the output, without the dot. */
  extension: string;
  /** The audio track's codec, copied as it is. */
  codec: string;
}

export interface AudioConverter {
  convert(bytes: Uint8Array<ArrayBuffer>, options: ConvertOptions): Promise<ConvertResult>;
  extractAudio(bytes: Uint8Array<ArrayBuffer>, options: ExtractOptions): Promise<ExtractResult>;
}

export const isAudioConverter = (s: unknown): s is AudioConverter =>
  isRecord(s) && typeof s.convert === 'function' && typeof s.extractAudio === 'function';

/** An encoder module's service: `register()` adds its encoder to the shared Mediabunny. */
export interface EncoderExtension {
  register(): void;
}

export const isEncoderExtension = (s: unknown): s is EncoderExtension =>
  isRecord(s) && typeof s.register === 'function';
